/**
 * Vinted Sniper — Content Script
 *
 * Monitors Vinted catalog/search pages for new listings and sends Discord
 * alerts for arbitrage candidates.
 *
 * Accuracy guardrails (each tagged below at the relevant decision point):
 *   B — brand-or-title must look like LEGO before any lookup
 *   C — set-number regex requires "set/#/lego" prefix; bare 5-digit numbers ignored
 *   D — listing title must overlap with catalog set name OR vision features
 *   E — vision uses two-shot JSON prompt with confidence (in background.js)
 *   F — vision cache persists to chrome.storage.local across reloads
 *   I — vision-only set numbers must exist in the BrickSet catalog
 *
 * Every per-listing decision is logged to vinted_sniper_decisions so we can
 * retrospectively audit false negatives.
 */

(function () {
  'use strict';

  // Secrets live in chrome.storage (set via Options) — never hardcode them here;
  // this file is committed to a public repo. SUPABASE_KEY is the anon key, which
  // is public by design (same key ships in the web app's client bundle).
  const DEFAULT_WEBHOOK = '';

  const SUPABASE_URL = 'https://modjoikyuhqzouxvieua.supabase.co';
  const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1vZGpvaWt5dWhxem91eHZpZXVhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjYxNDE3MjksImV4cCI6MjA4MTcxNzcyOX0.EWGr0LOwFKFw3krrzZQZP_Gcew13s1Z9H3LxB0-JmPA';

  const VINTED_POSTAGE = 2.39;
  const VISION_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
  const VISION_CACHE_MAX = 2000;
  const PRICE_CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days for hits
  const PRICE_CACHE_MISS_TTL_MS = 6 * 60 * 60 * 1000;  // 6 hours for misses
  const PRICE_CACHE_MAX = 5000;
  const KEEPA_PAUSE_MS = 2 * 60 * 1000;                // 2 min after 429

  // ── Part-Out-Value (BrickLink) ─────────────────────────────────────
  // POV data comes from the get_pov_public RPC (anon-safe view of
  // bricklink_part_out_value_cache). The 6-month BL SOLD average is the
  // authoritative part-out value; we compare it to COG for the buy signal.
  const POV_CACHE_TTL_MS = 14 * 24 * 60 * 60 * 1000;  // 14 days for hits
  const POV_CACHE_MISS_TTL_MS = 24 * 60 * 60 * 1000;  // 1 day for misses
  const POV_CACHE_MAX = 5000;
  const POV_MULTIPLE_DEFAULT = 3;       // good buy: POV >= 3× COG
  const POV_GREAT_MULTIPLE_DEFAULT = 4; // great buy: POV >= 4× COG

  // Per-tab buy mode (persisted in sessionStorage so it survives the
  // auto-refresh, which is a same-tab reload):
  //   amazon  — current behaviour: judge new LEGO on Amazon resale margin
  //   hybrid  — judge new LEGO on Amazon margin OR New POV >= 3× COG
  //   used    — judge on Used POV >= 3× COG (Amazon ignored)
  const MODES = ['amazon', 'hybrid', 'used'];
  const MODE_LABELS = { amazon: 'Amazon', hybrid: 'Hybrid (New)', used: 'Used POV' };
  const MODE_EMOJI = { amazon: '🛒', hybrid: '🔀', used: '♻️' };

  // ── State ──────────────────────────────────────────────────────────
  const sentHashes = new Set();
  let config = {
    webhookUrl: DEFAULT_WEBHOOK,
    keepaKey: '',
    minDiscount: 0, interval: 45, maxPosts: 5,
    refreshMinSecs: 60, refreshMaxSecs: 240,
    quietStart: null, quietEnd: null,
    defaultMode: 'amazon',
    povMultiple: POV_MULTIPLE_DEFAULT,
    povGreatMultiple: POV_GREAT_MULTIPLE_DEFAULT,
  };
  let isRunning = false;
  let pollTimer = null;
  let refreshTimer = null;
  let firstScanDone = false;
  let scanCount = 0;
  let lastRefreshTime = new Date();
  let lastAlertTime = null;
  let priceCache = {};         // dbSetNum → { price, name, rrp, wasPrice90d, asin, source, fetched }
  let priceCacheDirty = false;
  let povCache = {};           // bareSetNum → { new:{...}|null, used:{...}|null, fetched }
  let povCacheDirty = false;
  let currentMode = 'amazon';  // per-tab buy mode (sessionStorage-backed)
  let visionCache = {};        // listing_id → { setNum, confidence, features, raw, cached_at }
  let visionCacheDirty = false;
  let catalog = { sets: {}, fetched_at: 0 };
  let keepaPausedUntil = 0;    // epoch ms; if > now, Keepa fallback is skipped
  let lastLookupDeferred = false;  // true if last lookupAmazonPrice() returned null because Keepa was paused
  const deferredIds = new Set();   // listings deferred during the current Keepa pause window
  let nextRefreshAt = Date.now() + 120000;

  // ── Init ───────────────────────────────────────────────────────────
  if (typeof chrome === 'undefined' || !chrome.storage || !chrome.storage.local) {
    console.log('[Vinted Sniper] Extension context not available. Please refresh.');
    return;
  }

  chrome.storage.local.get(
    ['webhookUrl', 'keepaKey', 'minDiscount', 'interval', 'maxPosts', 'refreshMinSecs', 'refreshMaxSecs',
     'quietStart', 'quietEnd', 'vintedSeenIds', 'visionCacheV2', 'priceCacheV3', 'keepaPausedUntil',
     'defaultMode', 'povMultiple', 'povGreatMultiple', 'povCacheV2'],
    async data => {
      config.webhookUrl = data.webhookUrl || DEFAULT_WEBHOOK;
      config.keepaKey = data.keepaKey || '';
      config.minDiscount = data.minDiscount || 0;
      config.interval = data.interval || 45;
      config.maxPosts = data.maxPosts || 5;
      config.refreshMinSecs = data.refreshMinSecs || 60;
      config.refreshMaxSecs = data.refreshMaxSecs || 240;
      config.quietStart = (data.quietStart !== undefined && data.quietStart !== null && data.quietStart !== '') ? parseInt(data.quietStart) : null;
      config.quietEnd = (data.quietEnd !== undefined && data.quietEnd !== null && data.quietEnd !== '') ? parseInt(data.quietEnd) : null;
      config.defaultMode = MODES.includes(data.defaultMode) ? data.defaultMode : 'amazon';
      config.povMultiple = data.povMultiple || POV_MULTIPLE_DEFAULT;
      config.povGreatMultiple = data.povGreatMultiple || POV_GREAT_MULTIPLE_DEFAULT;

      if (data.vintedSeenIds) data.vintedSeenIds.forEach(h => sentHashes.add(h));
      hydrateVisionCache(data.visionCacheV2 || {});
      hydratePriceCache(data.priceCacheV3 || {});
      hydratePovCache(data.povCacheV2 || {});
      currentMode = getStoredMode();
      keepaPausedUntil = data.keepaPausedUntil || 0;
      if (keepaPausedUntil > Date.now()) {
        const secs = Math.round((keepaPausedUntil - Date.now()) / 1000);
        console.log(`[Vinted Sniper] Keepa paused for another ${secs}s (rate-limited last session)`);
      }

      if (!config.webhookUrl) {
        console.log('[Vinted Sniper] No webhook URL configured.');
        showBanner('⚙️ Vinted Sniper: No webhook URL set. Right-click extension → Options.', 'warn');
        return;
      }

      console.log(`[Vinted Sniper] Active. Mode: ${MODE_LABELS[currentMode]}. Poll: ${config.interval}s. Refresh: ${config.refreshMinSecs}-${config.refreshMaxSecs}s.`);
      const quietStr = config.quietStart !== null ? ` | Quiet: ${config.quietStart}:00-${config.quietEnd}:00` : '';
      showBanner(`👗 Vinted Sniper active — ${MODE_EMOJI[currentMode]} ${MODE_LABELS[currentMode]} mode, poll ${config.interval}s${quietStr}`, 'ok');
      showStatusBar();

      // Wait for catalog before scanning so vision validation works on the first scan.
      try {
        const cat = await requestCatalog(false);
        catalog = cat || catalog;
        console.log(`[Vinted Sniper] Catalog ready: ${Object.keys(catalog.sets || {}).length} sets`);
      } catch (e) {
        console.warn('[Vinted Sniper] Catalog load failed, continuing with empty catalog:', e.message);
      }

      setTimeout(() => {
        startPolling();
        startAutoRefresh();
      }, 3000);
    }
  );

  if (chrome.storage?.onChanged) {
    chrome.storage.onChanged.addListener(changes => {
      if (changes.webhookUrl) config.webhookUrl = changes.webhookUrl.newValue || DEFAULT_WEBHOOK;
      if (changes.keepaKey !== undefined) config.keepaKey = changes.keepaKey?.newValue || '';
      if (changes.minDiscount) config.minDiscount = changes.minDiscount.newValue || 0;
      if (changes.interval) {
        config.interval = changes.interval.newValue || 45;
        if (isRunning) { stopPolling(); startPolling(); }
      }
      if (changes.maxPosts) config.maxPosts = changes.maxPosts.newValue || 5;
      if (changes.refreshMinSecs !== undefined) config.refreshMinSecs = changes.refreshMinSecs?.newValue || 60;
      if (changes.refreshMaxSecs !== undefined) config.refreshMaxSecs = changes.refreshMaxSecs?.newValue || 240;
      if (changes.quietStart !== undefined) {
        const v = changes.quietStart?.newValue;
        config.quietStart = (v !== undefined && v !== null && v !== '') ? parseInt(v) : null;
      }
      if (changes.quietEnd !== undefined) {
        const v = changes.quietEnd?.newValue;
        config.quietEnd = (v !== undefined && v !== null && v !== '') ? parseInt(v) : null;
      }
      if (changes.defaultMode !== undefined && MODES.includes(changes.defaultMode.newValue)) {
        config.defaultMode = changes.defaultMode.newValue;
      }
      if (changes.povMultiple !== undefined) config.povMultiple = changes.povMultiple.newValue || POV_MULTIPLE_DEFAULT;
      if (changes.povGreatMultiple !== undefined) config.povGreatMultiple = changes.povGreatMultiple.newValue || POV_GREAT_MULTIPLE_DEFAULT;
      startAutoRefresh();
    });
  }

  // ── Polling ────────────────────────────────────────────────────────
  function startPolling() {
    if (isRunning) return;
    isRunning = true;
    scan();
    schedulePoll();
  }

  function schedulePoll() {
    const jitter = (Math.random() - 0.5) * 30000;
    const ms = Math.max(15000, config.interval * 1000 + jitter);
    pollTimer = setTimeout(() => { scan(); schedulePoll(); }, ms);
  }

  function stopPolling() {
    isRunning = false;
    if (pollTimer) clearTimeout(pollTimer);
  }

  let pollCycle = 0;
  function maybeScroll() {
    pollCycle++;
    if (pollCycle % 3 === 0) {
      const y = window.scrollY;
      window.scrollBy(0, window.innerHeight * 2);
      setTimeout(() => window.scrollTo(0, y), 2000);
    }
  }

  // ── Quiet Time ───────────────────────────────────────────────────
  let isQuiet = false;

  function isInQuietTime() {
    if (config.quietStart === null || config.quietEnd === null) return false;
    const hour = new Date().getHours();
    if (config.quietStart < config.quietEnd) {
      return hour >= config.quietStart && hour < config.quietEnd;
    } else {
      return hour >= config.quietStart || hour < config.quietEnd;
    }
  }

  // ── Auto Refresh ───────────────────────────────────────────────────
  let quietCheckTimer = null;

  function startAutoRefresh() {
    if (refreshTimer) clearTimeout(refreshTimer);
    if (quietCheckTimer) clearInterval(quietCheckTimer);

    if (isInQuietTime()) {
      enterQuietMode();
    } else {
      exitQuietMode();
      scheduleNextRefresh();
    }
  }

  function enterQuietMode() {
    isQuiet = true;
    if (refreshTimer) clearTimeout(refreshTimer);
    nextRefreshAt = null;
    stopPolling();
    console.log(`[Vinted Sniper] 😴 Quiet time active (${config.quietStart}:00-${config.quietEnd}:00). Paused.`);
    quietCheckTimer = setInterval(() => {
      if (!isInQuietTime()) {
        console.log('[Vinted Sniper] ☀️ Quiet time ended — resuming!');
        clearInterval(quietCheckTimer);
        quietCheckTimer = null;
        exitQuietMode();
        startPolling();
        scheduleNextRefresh();
      }
    }, 60000);
  }

  function exitQuietMode() {
    isQuiet = false;
    if (quietCheckTimer) { clearInterval(quietCheckTimer); quietCheckTimer = null; }
  }

  function scheduleNextRefresh() {
    if (refreshTimer) clearTimeout(refreshTimer);

    if (isInQuietTime()) {
      enterQuietMode();
      return;
    }

    const minMs = config.refreshMinSecs * 1000;
    const maxMs = config.refreshMaxSecs * 1000;
    const ms = minMs + Math.random() * (maxMs - minMs);
    const secs = Math.round(ms / 1000);
    nextRefreshAt = Date.now() + ms;
    console.log(`[Vinted Sniper] Next refresh in ${secs}s`);
    refreshTimer = setTimeout(() => {
      if (isInQuietTime()) {
        enterQuietMode();
        return;
      }
      console.log('[Vinted Sniper] Auto-refreshing...');
      saveState(() => window.location.reload());
    }, ms);
  }

  function saveState(callback) {
    if (chrome.storage?.local) {
      const payload = { vintedSeenIds: [...sentHashes].slice(-500) };
      if (visionCacheDirty) {
        payload.visionCacheV2 = trimVisionCache();
        visionCacheDirty = false;
      }
      if (priceCacheDirty) {
        payload.priceCacheV3 = trimPriceCache();
        priceCacheDirty = false;
      }
      if (povCacheDirty) {
        payload.povCacheV2 = trimPovCache();
        povCacheDirty = false;
      }
      payload.keepaPausedUntil = keepaPausedUntil;
      chrome.storage.local.set(payload, callback);
    } else if (callback) callback();
  }

  // ── Scanning ───────────────────────────────────────────────────────
  async function scan() {
    scanCount++;
    maybeScroll();

    // Drop deferred-ids when Keepa pause has expired so they retry naturally.
    if (Date.now() >= keepaPausedUntil && deferredIds.size > 0) {
      console.log(`[Vinted Sniper] Keepa pause expired — releasing ${deferredIds.size} deferred listings for retry`);
      deferredIds.clear();
    }

    const listings = extractListings();
    const keepaPaused = Date.now() < keepaPausedUntil;

    const newListings = [];
    for (const listing of listings) {
      // Dedupe on listing.id directly. Vinted IDs are unique and immutable;
      // the previous title-or-price-inclusive hash was unstable and made the
      // same listing keep looking "new" across reloads.
      const contentHash = String(listing.id);
      if (sentHashes.has(contentHash)) continue;
      // Skip listings we've already deferred this Keepa pause window —
      // re-running the gates while Keepa is still down just produces
      // duplicate decision-log rows for no progress.
      if (keepaPaused && deferredIds.has(contentHash)) continue;
      listing.contentHash = contentHash;
      newListings.push(listing);
    }

    if (!firstScanDone) {
      firstScanDone = true;
      const preview = newListings.slice(0, 5);
      console.log(`[Vinted Sniper] First scan: ${listings.length} listings. Sending ${preview.length} as preview.`);
      for (const listing of preview) await enrichAndSend(listing);
      saveState();
      return;
    }

    if (newListings.length === 0) return;

    const toAlert = newListings.slice(0, config.maxPosts);
    console.log(`[Vinted Sniper] ${toAlert.length} new listing(s)!`);

    for (const listing of toAlert) await enrichAndSend(listing);
    saveState();
  }

  // ── Catalog (Option I) ─────────────────────────────────────────────
  function requestCatalog(force) {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage({ type: 'getCatalog', force: !!force }, response => {
        if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
        else if (response?.error) reject(new Error(response.error));
        else resolve(response);
      });
    });
  }

  // Hardcoded theme→keyword map. Only covers themes prone to misidentification
  // — generic themes like City/Creator are intentionally absent so a missing
  // entry doesn't trigger spurious mismatches.
  const THEME_KEYWORDS = {
    'Star Wars': ['star wars','jedi','sith','yoda','clone','rebel','empire','death star','mandalorian','ahsoka','grogu','vader','skywalker','obi-wan','obiwan','kenobi','tatooine','endor','wookiee','chewbacca','han solo','boba fett','first order','padme','anakin','ewok','tie fighter','x-wing','xwing','millennium falcon','at-at','at-st'],
    'Harry Potter': ['harry potter','hogwarts','weasley','dumbledore','voldemort','hermione','ron weasley','snape','gryffindor','slytherin','ravenclaw','hufflepuff','quidditch','dobby','hagrid','diagon alley'],
    'Friends': ['heartlake'],
    'Ninjago': ['ninjago','kai','jay','cole','zane','lloyd'],
    'Marvel Super Heroes': ['marvel','spider-man','spiderman','spidey','avengers','iron man','captain america','black widow','wakanda','x-men','xmen','wolverine','deadpool','venom','thanos','hulkbuster'],
    'DC Comics Super Heroes': ['dc comics','batman','batmobile','gotham','joker','arkham','wonder woman','aquaman'],
    'Disney': ['disney','frozen','toy story','mickey mouse','minnie mouse','elsa','ariel'],
    'The Lord of the Rings': ['lord of the rings','lotr','hobbit','gandalf','frodo','aragorn','sauron','rivendell','mordor','shire'],
    'Minecraft': ['minecraft','creeper','enderman','minecart','piglin'],
    // Note: "F1" / "formula 1" intentionally omitted — F1 / Lewis Hamilton sets
    // also exist in Technic and Collectible Minifigures. Marque names are safe.
    'Speed Champions': ['speed champions','ferrari','lamborghini','porsche','mclaren','aston martin','bugatti'],
    'Technic': ['technic'],
    'Architecture': ['architecture'],
    'Duplo': ['duplo'],
    'Icons': ['creator expert','modular building'],
  };

  function inferThemes(text) {
    const t = ' ' + (text || '').toLowerCase() + ' ';
    const matched = new Set();
    for (const [theme, keywords] of Object.entries(THEME_KEYWORDS)) {
      for (const kw of keywords) {
        if (t.includes(kw)) { matched.add(theme); break; }
      }
    }
    return matched;
  }

  /**
   * Fuzzy theme equivalence — two theme names are "the same theme" if they
   * share at least one distinctive (≥4-char, non-stopword) token.
   *
   * Catches BrickSet vs my own naming drift like:
   *   "Marvel Super Heroes" ↔ "Super Heroes Marvel"
   *   "The Lord of the Rings" ↔ "The Hobbit and Lord of the Rings"
   *   "DC Comics Super Heroes" ↔ "Super Heroes DC" (via "heroes")
   */
  function themesOverlap(a, b) {
    if (!a || !b) return false;
    if (a === b) return true;
    const aTokens = new Set(tokenize(a));
    const bTokens = tokenize(b);
    for (const t of bTokens) if (aTokens.has(t)) return true;
    return false;
  }

  // ── Vision cache (Option F) ────────────────────────────────────────
  function hydrateVisionCache(stored) {
    const now = Date.now();
    let kept = 0;
    for (const [k, v] of Object.entries(stored || {})) {
      if (v && (now - (v.cached_at || 0)) < VISION_CACHE_TTL_MS) {
        visionCache[k] = v;
        kept++;
      }
    }
    console.log(`[Vinted Sniper] Vision cache hydrated: ${kept} entries`);
  }

  function trimVisionCache() {
    const entries = Object.entries(visionCache)
      .sort((a, b) => (b[1].cached_at || 0) - (a[1].cached_at || 0))
      .slice(0, VISION_CACHE_MAX);
    return Object.fromEntries(entries);
  }

  // ── Price cache (persistent) ───────────────────────────────────────
  function hydratePriceCache(stored) {
    const now = Date.now();
    let kept = 0;
    for (const [k, v] of Object.entries(stored || {})) {
      if (!v) continue;
      const ttl = v.price ? PRICE_CACHE_TTL_MS : PRICE_CACHE_MISS_TTL_MS;
      if ((now - (v.fetched || 0)) < ttl) {
        priceCache[k] = v;
        kept++;
      }
    }
    console.log(`[Vinted Sniper] Price cache hydrated: ${kept} entries`);
  }

  function trimPriceCache() {
    const entries = Object.entries(priceCache)
      .sort((a, b) => (b[1].fetched || 0) - (a[1].fetched || 0))
      .slice(0, PRICE_CACHE_MAX);
    return Object.fromEntries(entries);
  }

  function pricePauseRemainingSec() {
    return Math.max(0, Math.round((keepaPausedUntil - Date.now()) / 1000));
  }

  function tripKeepaPause(reason) {
    keepaPausedUntil = Date.now() + KEEPA_PAUSE_MS;
    console.warn(`[Vinted Sniper] Keepa paused for ${KEEPA_PAUSE_MS / 1000}s — ${reason}`);
    // Persist immediately so the pause survives a refresh.
    if (chrome.storage?.local) chrome.storage.local.set({ keepaPausedUntil });
  }

  // ── Part-Out-Value cache + lookup ──────────────────────────────────
  function hydratePovCache(stored) {
    const now = Date.now();
    let kept = 0;
    for (const [k, v] of Object.entries(stored || {})) {
      if (!v) continue;
      const hit = !!(v.new || v.used);
      const ttl = hit ? POV_CACHE_TTL_MS : POV_CACHE_MISS_TTL_MS;
      if ((now - (v.fetched || 0)) < ttl) { povCache[k] = v; kept++; }
    }
    console.log(`[Vinted Sniper] POV cache hydrated: ${kept} entries`);
  }

  function trimPovCache() {
    const entries = Object.entries(povCache)
      .sort((a, b) => (b[1].fetched || 0) - (a[1].fetched || 0))
      .slice(0, POV_CACHE_MAX);
    return Object.fromEntries(entries);
  }

  /**
   * Look up BrickLink Part-Out-Value for a set via the anon-safe get_pov_public RPC.
   * Returns { new, used, fetched } where each condition is null or:
   *   { soldAvg, forSaleAvg, rrp, multiple, lots, noData, setName }
   * soldAvg = authoritative 6-month BL SOLD average (GBP). Cache-first.
   */
  async function lookupPov(setNum) {
    const bare = String(setNum).split('-')[0];
    const cached = povCache[bare];
    if (cached) {
      const hit = !!(cached.new || cached.used);
      const ttl = hit ? POV_CACHE_TTL_MS : POV_CACHE_MISS_TTL_MS;
      if ((Date.now() - cached.fetched) < ttl) return cached;
    }

    const pickCond = (rows, cond) => {
      const matches = rows.filter(r => r.condition === cond);
      if (matches.length === 0) return null;
      // Rows are item_seq-ordered; prefer the lowest seq with a sold avg. For a bare set number
      // reused across editions (~1% of sets, multiple item_seq) this returns the canonical
      // original (seq 1) — the safest default. The card shows the resolved set name + image +
      // Brickset link so the human can spot a reissue mismatch.
      const withData = matches.filter(r => r.sold_6mo_avg_gbp != null);
      const r = withData[0] || matches[0];
      const num = v => (v == null ? null : Number(v));
      return {
        soldAvg: num(r.sold_6mo_avg_gbp),
        forSaleAvg: num(r.for_sale_avg_gbp),
        rrp: num(r.uk_retail_gbp),
        multiple: num(r.partout_multiple),
        lots: num(r.sold_6mo_lots),
        noData: r.no_data_reason || null,
        setName: r.set_name || null,
      };
    };

    try {
      const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/get_pov_public`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          apikey: SUPABASE_KEY,
          Authorization: `Bearer ${SUPABASE_KEY}`,
        },
        body: JSON.stringify({ p_set_number: bare }),
      });
      if (res.ok) {
        const rows = await res.json();
        const result = { new: pickCond(rows, 'N'), used: pickCond(rows, 'U'), fetched: Date.now() };
        povCache[bare] = result;
        povCacheDirty = true;
        const ns = result.new?.soldAvg, us = result.used?.soldAvg;
        console.log(`  🧩 POV ${bare}: new £${ns != null ? ns.toFixed(2) : 'n/a'} | used £${us != null ? us.toFixed(2) : 'n/a'}`);
        return result;
      }
      console.log(`  🧩 POV: RPC ${res.status} for ${bare}`);
    } catch (e) {
      console.log(`  🧩 POV lookup error: ${e.message}`);
    }

    const miss = { new: null, used: null, fetched: Date.now() };
    povCache[bare] = miss;
    povCacheDirty = true;
    return miss;
  }

  // ── Condition + buy-signal helpers ─────────────────────────────────
  /**
   * Classify a Vinted listing as 'new' | 'used' | 'unknown' from its condition
   * label and title. Drives which POV is shown on the card (condition-matched).
   */
  function classifyCondition(listing) {
    const hay = ((listing.condition || '') + ' ' + (listing.title || '')).toLowerCase();
    if (/\bnew with tags?\b|\bnew without tags?\b|\bbnib\b|\bnisb\b|\bbrand new\b|\bsealed\b/.test(hay)) return 'new';
    if (/\bvery good\b|\bgood\b|\bsatisfactory\b|\bused\b|\bpre[\s-]?owned\b|\bopen(ed)? box\b|\bincomplete\b/.test(hay)) return 'used';
    return 'unknown';
  }

  /** POV multiple → tier (null below the buy threshold). */
  function povTier(multiple, mult, greatMult) {
    if (multiple == null) return null;
    if (multiple >= greatMult) return 'green';
    if (multiple >= mult) return 'amber';
    return null;
  }

  /** Best of an Amazon-margin tier and a POV multiple (used by hybrid mode). */
  function bestTier(amazonTier, povMultiple, mult, greatMult) {
    const pt = povTier(povMultiple, mult, greatMult);
    if (amazonTier === 'green' || pt === 'green') return 'green';
    if (amazonTier === 'amber' || pt === 'amber') return 'amber';
    return null;
  }

  // ── Per-tab mode (sessionStorage survives the same-tab auto-refresh) ─
  function getStoredMode() {
    try {
      const m = sessionStorage.getItem('vintedSniperMode');
      if (m && MODES.includes(m)) return m;
    } catch (e) { /* sessionStorage may be unavailable */ }
    return config.defaultMode || 'amazon';
  }

  function setMode(m) {
    if (!MODES.includes(m)) return;
    currentMode = m;
    try { sessionStorage.setItem('vintedSniperMode', m); } catch (e) { /* ignore */ }
    console.log(`[Vinted Sniper] Mode → ${MODE_LABELS[m]} (this tab)`);
    showBanner(`${MODE_EMOJI[m]} Mode: ${MODE_LABELS[m]} — applies to new listings on this tab`, 'ok');
    updateStatusBar();
  }

  function cycleMode() {
    const idx = MODES.indexOf(currentMode);
    setMode(MODES[(idx + 1) % MODES.length]);
  }

  async function identifySetFromImage(imageUrl, listingId) {
    if (visionCache[listingId] !== undefined) {
      const c = visionCache[listingId];
      console.log(`  👁️ Vision (cache): ${c.setNum || 'null'} confidence=${c.confidence || '?'}`);
      return c;
    }

    if (!imageUrl || !imageUrl.startsWith('https')) {
      const miss = { setNum: null, confidence: 'low', features: [], raw: '', cached_at: Date.now() };
      visionCache[listingId] = miss;
      visionCacheDirty = true;
      return miss;
    }

    try {
      const result = await new Promise((resolve, reject) => {
        chrome.runtime.sendMessage(
          { type: 'identifyImage', imageUrl, listingId },
          response => {
            if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
            else resolve(response);
          }
        );
      });

      if (result.error) {
        console.log(`  👁️ Vision: error — ${result.error}`);
        // Don't cache errors — could be transient (rate limit, network).
        return { setNum: null, confidence: 'low', features: [], raw: '', cached_at: Date.now() };
      }

      const cached = {
        setNum: result.setNum || null,
        confidence: result.confidence || 'low',
        features: result.features || [],
        raw: result.raw || '',
        cached_at: Date.now(),
      };
      visionCache[listingId] = cached;
      visionCacheDirty = true;

      if (cached.setNum) {
        console.log(`  👁️ Vision: identified ${cached.setNum} (confidence ${cached.confidence}; features: ${(cached.features || []).join(', ') || 'none'})`);
      } else {
        console.log(`  👁️ Vision: no set found (confidence ${cached.confidence}; features: ${(cached.features || []).join(', ') || 'none'})`);
      }
      return cached;
    } catch (e) {
      console.log(`  👁️ Vision: error — ${e.message}`);
      return { setNum: null, confidence: 'low', features: [], raw: '', cached_at: Date.now() };
    }
  }

  // ── Decision logging ───────────────────────────────────────────────
  function logDecision(payload) {
    fetch(`${SUPABASE_URL}/rest/v1/vinted_sniper_decisions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: SUPABASE_KEY,
        Authorization: `Bearer ${SUPABASE_KEY}`,
        Prefer: 'return=minimal',
      },
      body: JSON.stringify(payload),
    }).catch(() => {});
  }

  function buildBaseDecision(listing) {
    return {
      listing_id: listing.id,
      listing_url: listing.url || null,
      image_url: listing.imageUrl || null,
      raw_title: listing.title || null,
      brand: listing.brand || null,
      condition_text: listing.condition || null,
      price_num: listing.priceNum || null,
      price_incl_num: listing.priceInclNum || null,
    };
  }

  // ── Name / theme match (Option D) ──────────────────────────────────
  const STOPWORDS = new Set([
    'lego','set','sets','the','and','with','of','for','new','box','sealed',
    'complete','pieces','minifigure','minifigures','minifig','minifigs',
    'figure','figures','build','model','small','medium','large','retired',
    'rare','used','boxed','bnib','nisb','vintage','toy','toys','years','year',
  ]);

  function tokenize(s) {
    return (s || '')
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter(t => t.length >= 4 && !STOPWORDS.has(t));
  }

  /**
   * Validate a vision-identified set against the catalog, using vision features
   * as the primary signal (Vinted titles are notoriously unreliable, which is
   * why vision exists). Title overlap is a tiebreaker, never a gate.
   *
   * Caller decides what to do: text-source listings should bypass this entirely
   * — the seller / URL slug already wrote the digits, catalog hit confirmed.
   *
   * Returns:
   *   { match: bool, themeMismatch: bool, reason: string }
   */
  function nameMatch({ source, rawTitle, setNum, catalogEntry, visionFeatures, visionConfidence }) {
    // Text source: seller wrote the digits; catalog hit elsewhere has confirmed
    // it's a real set. No further validation needed.
    if (source === 'text') {
      return { match: true, themeMismatch: false, reason: 'text_source' };
    }

    const features = visionFeatures || [];
    const featureText = features.join(' ');
    const featureTokens = new Set(tokenize(featureText));
    const catalogName = catalogEntry?.name || '';
    const catalogTheme = catalogEntry?.theme || null;

    // PRIMARY: do vision features describe the catalog set's name?
    for (const t of tokenize(catalogName)) {
      if (featureTokens.has(t)) {
        return { match: true, themeMismatch: false, reason: `features_describe:${t}` };
      }
    }

    // SECONDARY: do features imply the catalog's theme? Use fuzzy matching
    // because BrickSet's theme names and our inference keys often diverge
    // cosmetically (e.g. "Super Heroes Marvel" vs "Marvel Super Heroes").
    const featureThemes = inferThemes(featureText);
    if (catalogTheme) {
      for (const ft of featureThemes) {
        if (themesOverlap(ft, catalogTheme)) {
          return { match: true, themeMismatch: false, reason: `theme_match:${ft}` };
        }
      }
    }

    // NEGATIVE: features clearly imply a *different* theme than the catalog.
    if (catalogTheme && featureThemes.size > 0) {
      // Already established no overlap in the loop above — if we'd found any,
      // we'd have returned. Safe to reject as contradiction.
      return {
        match: false,
        themeMismatch: true,
        reason: `theme_contradicts:got=${[...featureThemes].join('|')}_expected=${catalogTheme}`,
      };
    }

    // TIEBREAKER: title overlap (only when title is meaningful).
    const title = (rawTitle || '').toLowerCase();
    const titleTokens = new Set(tokenize(title));
    if (titleTokens.size > 0 && !titleTokens.has('untitled')) {
      if (setNum && title.includes(setNum)) {
        return { match: true, themeMismatch: false, reason: 'set_number_in_title' };
      }
      for (const t of tokenize(catalogName)) {
        if (titleTokens.has(t)) {
          return { match: true, themeMismatch: false, reason: `title_name_overlap:${t}` };
        }
      }
      for (const f of features) {
        for (const t of tokenize(f)) {
          if (titleTokens.has(t)) {
            return { match: true, themeMismatch: false, reason: `title_feature_overlap:${t}` };
          }
        }
      }
    }

    // LAST RESORT: high-confidence vision with non-empty features and no
    // contradiction. Accept with a soft signal so it shows up in the embed.
    if (visionConfidence === 'high' && features.length > 0) {
      return { match: true, themeMismatch: false, reason: 'high_confidence_no_contradiction' };
    }

    return { match: false, themeMismatch: false, reason: 'no_positive_signal' };
  }

  // ── Enrich with Supabase price data and send ──────────────────────
  const TITLE_EXCLUSIONS = [
    /button.?block.?dinosaur/i,
  ];

  async function enrichAndSend(listing) {
    const ctx = buildBaseDecision(listing);

    console.log(`[Vinted] ── ${listing.id} ──`);
    console.log(`  Title: "${listing.title}"`);
    console.log(`  URL: ${listing.url}`);
    console.log(`  Brand: ${listing.brand || 'n/a'} | Price: ${listing.price || 'n/a'} | Incl: ${listing.priceWithFees || 'n/a'}`);

    // 0. Title exclusions
    const textToCheck = (listing.title || '') + ' ' + (listing.url || '');
    for (const pattern of TITLE_EXCLUSIONS) {
      if (pattern.test(textToCheck)) {
        console.log(`  → ❌ EXCLUDED by pattern ${pattern}`);
        sentHashes.add(listing.contentHash);
        logDecision({ ...ctx, decision: 'skipped_excluded_pattern', decision_reason: String(pattern) });
        return;
      }
    }

    // 1. Brand gate (Option B): require brand=LEGO OR title contains "lego"
    const brand = (listing.brand || '').toLowerCase();
    const titleLower = (listing.title || '').toLowerCase();
    const looksLikeLego = brand.includes('lego') || titleLower.includes('lego');
    if (!looksLikeLego) {
      console.log(`  → ❌ SKIP — brand "${listing.brand || '?'}" / title doesn't indicate LEGO`);
      sentHashes.add(listing.contentHash);
      logDecision({ ...ctx, decision: 'skipped_brand_not_lego', decision_reason: `brand="${listing.brand || ''}" title-no-lego` });
      return;
    }

    // 2. Extract from text/slug (Option C — tighter regex, with a loose
    //    fallback when title clearly mentions "lego").
    let setNumsText = extractSetNumbers(listing.title);
    if (setNumsText.length === 0 && listing.slugSetNums) setNumsText = listing.slugSetNums;
    if (setNumsText.length === 0 && listing.url) setNumsText = extractSetNumbers(listing.url);
    // Loose fallback: titles like "30301 Lego DC Super Heroes" or "Lego
    // Spider-Man 76321" have the set number but not in a "set/#/lego"-adjacent
    // form. If the title contains "lego" as a standalone word, treat any
    // 4-6 digit number as a candidate. Brand gate above already confirmed
    // LEGO context; the catalog/price lookup remains the safety net.
    if (setNumsText.length === 0 && listing.title && /\blego\b/i.test(listing.title)) {
      const bare = (listing.title.match(/\b[1-9]\d{3,5}\b/g) || []).slice(0, 3);
      if (bare.length > 0) setNumsText = bare;
    }
    ctx.set_num_text = setNumsText[0] || null;

    // 3. Vision fallback if text didn't yield anything
    let visionResult = null;
    if (setNumsText.length === 0 && listing.imageUrl) {
      console.log(`  👁️ Vision: attempting…`);
      visionResult = await identifySetFromImage(listing.imageUrl, listing.id);
      if (visionResult) {
        ctx.set_num_vision = visionResult.setNum || null;
        ctx.vision_raw = visionResult.raw || null;
        ctx.vision_features = visionResult.features || [];
        ctx.vision_confidence = visionResult.confidence || null;
      }
    }

    const visionSetNum = visionResult?.setNum || null;
    const candidates = setNumsText.length > 0 ? setNumsText : (visionSetNum ? [visionSetNum] : []);

    if (candidates.length === 0) {
      console.log(`  → ❌ SKIP — no set number from text or vision`);
      sentHashes.add(listing.contentHash);
      logDecision({ ...ctx, decision: 'skipped_no_set_number' });
      return;
    }

    const setNum = candidates[0];
    const source = setNumsText.length > 0 ? 'text' : 'vision';
    ctx.set_num_used = setNum;
    console.log(`  Set #: ${setNum} (source: ${source})`);

    // 4. Catalog lookup (Option I)
    const catalogEntry = catalog.sets[setNum] || null;
    ctx.catalog_hit = !!catalogEntry;
    ctx.catalog_theme = catalogEntry?.theme || null;
    ctx.catalog_name = catalogEntry?.name || null;
    if (catalogEntry) {
      console.log(`  📚 Catalog: ${setNum} → "${catalogEntry.name}" (${catalogEntry.theme})`);
    } else {
      console.log(`  📚 Catalog: ${setNum} not in catalog`);
    }

    // 5. Vision-only must be in catalog (kills hallucinations).
    //    Skipped if the catalog itself failed to load — no point gating on a
    //    catalog we can't read; we'd reject every vision-only listing. Once
    //    catalog is loaded (>1k entries), absence means likely hallucination.
    const catalogLoaded = Object.keys(catalog.sets || {}).length >= 1000;
    if (source === 'vision' && !catalogEntry && catalogLoaded) {
      console.log(`  → ❌ SKIP — vision-only set ${setNum} not in BrickSet catalog (likely hallucination)`);
      sentHashes.add(listing.contentHash);
      logDecision({ ...ctx, decision: 'skipped_vision_unverified', decision_reason: `vision-only setNum=${setNum} confidence=${visionResult?.confidence}` });
      return;
    }

    // 6. Name / theme match — features↔catalog for vision; auto-pass for text.
    const nm = nameMatch({
      source,
      rawTitle: listing.title,
      setNum,
      catalogEntry,
      visionFeatures: visionResult?.features,
      visionConfidence: visionResult?.confidence,
    });
    ctx.name_match = nm.match;
    ctx.theme_mismatch = nm.themeMismatch;
    console.log(`  🔎 Name match: ${nm.match} (${nm.reason}); theme mismatch: ${nm.themeMismatch}`);

    // 7. Reject mismatches BEFORE hitting pricing APIs (saves Keepa tokens).
    if (nm.themeMismatch) {
      console.log(`  → ❌ SKIP — features imply different theme than catalog "${catalogEntry?.theme}"`);
      sentHashes.add(listing.contentHash);
      logDecision({ ...ctx, decision: 'skipped_name_mismatch', decision_reason: `theme contradicts (catalog=${catalogEntry?.theme}, ${nm.reason})` });
      return;
    }
    if (!nm.match) {
      // Only vision source can fail name-match (text source short-circuits to true).
      console.log(`  → ❌ SKIP — vision features don't validate set ${setNum} (${nm.reason})`);
      sentHashes.add(listing.contentHash);
      logDecision({ ...ctx, decision: 'skipped_name_mismatch', decision_reason: nm.reason });
      return;
    }

    // 8. Condition + Part-Out-Value (always looked up — drives the card + buy signals)
    const condClass = classifyCondition(listing);
    ctx.condition_class = condClass;
    ctx.mode = currentMode;
    const pov = await lookupPov(setNum);
    const newPov = pov.new;
    const usedPov = pov.used;
    ctx.pov_new_sold_gbp = newPov?.soldAvg ?? null;
    ctx.pov_used_sold_gbp = usedPov?.soldAvg ?? null;

    // Used-POV guards (2026-07-02, from the 77254 post-mortem):
    //  - Cap: a used part-out above the same set's NEW part-out is single-sale
    //    noise (new moulds barely trade used), so cap used at new.
    //  - Thin history: sets released in the last ~2 years have next to no
    //    used-parts sale history — the used average can rest on 0-1 fluke sales.
    let usedPovCapped = false;
    let usedSoldEff = usedPov?.soldAvg ?? null;
    if (usedSoldEff != null && newPov?.soldAvg != null && usedSoldEff > newPov.soldAvg) {
      usedSoldEff = newPov.soldAvg;
      usedPovCapped = true;
    }
    const setYear = catalogEntry?.year ?? null;
    const thinUsedHistory = setYear != null && setYear >= new Date().getFullYear() - 2;

    // 9. COG (Vinted price incl. buyer protection where shown + postage)
    const basePrice = listing.priceInclNum || listing.priceNum;
    const cog = basePrice ? basePrice + VINTED_POSTAGE : null;
    if (!cog) {
      console.log(`  → ❌ SKIP — no usable price`);
      sentHashes.add(listing.contentHash);
      logDecision({ ...ctx, decision: 'skipped_no_set_number', decision_reason: 'price unparseable' });
      return;
    }
    ctx.cog = +cog.toFixed(2);

    const mult = config.povMultiple || POV_MULTIPLE_DEFAULT;
    const greatMult = config.povGreatMultiple || POV_GREAT_MULTIPLE_DEFAULT;
    const newPovMultiple = newPov?.soldAvg ? newPov.soldAvg / cog : null;
    const usedPovMultiple = usedSoldEff ? usedSoldEff / cog : null;
    ctx.pov_multiple_new = newPovMultiple != null ? +newPovMultiple.toFixed(2) : null;
    ctx.pov_multiple_used = usedPovMultiple != null ? +usedPovMultiple.toFixed(2) : null;

    // 10. Amazon pricing — only needed for amazon/hybrid modes (used mode skips it
    //     entirely to save Keepa tokens and avoid Keepa-pause deferrals).
    let lookup = null;
    let marginPct = null;
    let amazonTier = null;
    if (currentMode === 'amazon' || currentMode === 'hybrid') {
      lookup = await lookupAmazonPrice(setNum);
      if (lookup) {
        ctx.set_name = lookup.name || null;
        ctx.amazon_price = lookup.price || null;
        ctx.was_price_90d = lookup.wasPrice90d || null;
        ctx.rrp = lookup.rrp || null;
        ctx.asin = lookup.asin || null;
      }
      if (lookup?.price) {
        const fees = lookup.price * 0.1836;
        const shipping = lookup.price < 20 ? 3 : 4;
        const profit = lookup.price - fees - shipping - cog;
        marginPct = (profit / lookup.price) * 100;
        ctx.margin_pct = +marginPct.toFixed(2);
        ctx.profit = +profit.toFixed(2);
        if (marginPct >= 25) amazonTier = 'green';
        else if (marginPct >= 15) amazonTier = 'amber';
        console.log(`  💰 COG £${cog.toFixed(2)} | Amazon £${lookup.price.toFixed(2)} | Margin ${marginPct.toFixed(1)}%`);
      }
    }

    // 11. Buy signals per mode
    const amazonSignal = amazonTier != null;
    const newPovSignal = newPovMultiple != null && newPovMultiple >= mult;
    const usedPovSignal = usedPovMultiple != null && usedPovMultiple >= mult;
    const reasons = [];
    let dealTier = null;

    if (currentMode === 'used') {
      console.log(`  ♻️ Used POV ${usedPovMultiple != null ? usedPovMultiple.toFixed(1) + '×' : 'n/a'} (need ${mult}×) | COG £${cog.toFixed(2)}`);
      if (usedPovSignal) {
        reasons.push(`used POV ${usedPovMultiple.toFixed(1)}× COG${usedPovCapped ? ' (capped to New)' : ''}`);
        if (thinUsedHistory) reasons.push(`⚠️ ${setYear} set — thin used-parts history`);
        dealTier = povTier(usedPovMultiple, mult, greatMult);
      }
    } else if (currentMode === 'hybrid') {
      console.log(`  🔀 Hybrid — Amazon ${amazonSignal ? marginPct.toFixed(1) + '%' : 'n/a'} | new POV ${newPovMultiple != null ? newPovMultiple.toFixed(1) + '×' : 'n/a'} (need ${mult}×)`);
      if (amazonSignal) reasons.push(`Amazon ${marginPct.toFixed(1)}%`);
      if (newPovSignal) reasons.push(`new POV ${newPovMultiple.toFixed(1)}× COG`);
      if (amazonSignal || newPovSignal) dealTier = bestTier(amazonTier, newPovSignal ? newPovMultiple : null, mult, greatMult);
    } else { // amazon
      if (amazonSignal) { reasons.push(`Amazon ${marginPct.toFixed(1)}%`); dealTier = amazonTier; }
    }

    // 12. No buy → defer (amazon/hybrid when Keepa-paused and no POV rescue) or skip
    if (!dealTier) {
      const amazonDeferred = (currentMode === 'amazon' || currentMode === 'hybrid') && lastLookupDeferred;
      if (amazonDeferred && !newPovSignal && !usedPovSignal) {
        console.log(`  → ⏸️  DEFER — Amazon price unavailable (Keepa paused), no POV rescue`);
        deferredIds.add(listing.contentHash);
        logDecision({ ...ctx, decision: 'skipped_no_amazon_price', decision_reason: `[${currentMode}] keepa paused — deferred for retry` });
        return;
      }
      sentHashes.add(listing.contentHash);
      let reason, decision;
      if (currentMode === 'used') {
        decision = 'skipped_low_margin';
        reason = usedPov?.soldAvg ? `used POV ${usedPovMultiple.toFixed(2)}× < ${mult}× COG` : 'no used POV data';
      } else if (currentMode === 'hybrid') {
        decision = lookup?.price ? 'skipped_low_margin' : 'skipped_no_amazon_price';
        reason = `Amazon ${lookup?.price ? marginPct.toFixed(1) + '%' : 'n/a'} & new POV ${newPovMultiple != null ? newPovMultiple.toFixed(2) + '×' : 'n/a'} below bar (need ${mult}×)`;
      } else {
        decision = lookup?.price ? 'skipped_low_margin' : 'skipped_no_amazon_price';
        reason = lookup?.price ? `margin ${marginPct.toFixed(1)}% < 15%` : 'no amazon price';
      }
      console.log(`  → ❌ SKIP — ${reason}`);
      logDecision({ ...ctx, decision, decision_reason: `[${currentMode}] ${reason}` });
      return;
    }

    // 13. Buy — send to Discord
    sentHashes.add(listing.contentHash);
    ctx.pov_signal = reasons.join(' + ');
    // Last-resort high-confidence vision matches (no name/theme overlap, just
    // confidence) get a soft warn so they're easy to review in Discord.
    const softWarn = source === 'vision' && nm.reason === 'high_confidence_no_contradiction';
    await sendToDiscord(listing, [setNum], {
      mode: currentMode,
      dealTier,
      cog,
      condClass,
      reasons,
      lookup,
      marginPct,
      pov: { new: newPov, used: usedPov, newMultiple: newPovMultiple, usedMultiple: usedPovMultiple },
      povNote: [
        usedPovCapped ? 'used avg capped to New part-out' : null,
        thinUsedHistory ? `⚠️ ${setYear} release — used averages may rest on 0-1 sales` : null,
      ].filter(Boolean).join(' · ') || null,
      softWarn,
      source,
      matchReason: nm.reason,
      visionFeatures: visionResult?.features || [],
      visionConfidence: visionResult?.confidence || null,
      catalogEntry,
    });

    logDecision({
      ...ctx,
      decision: dealTier === 'green' ? 'sent_green' : 'sent_amber',
      decision_reason: `[${currentMode}] ${reasons.join(' + ')} · ${nm.reason}`,
    });
  }

  function extractSetNumbers(text) {
    if (!text) return [];
    const sets = new Set();

    // Option C: tightened patterns — must have set/#/lego context, OR be in a
    // /lego-…-12345/ slug segment. Bare 5-digit numbers are no longer accepted.
    const patterns = [
      /(?:^|[^a-z0-9])(?:set|#|lego)[\s#-]*(\d{4,6})\b/gi,
      /\/lego[a-z0-9-]*?(\d{4,6})(?:[^a-z0-9]|$)/gi,
    ];

    for (const pattern of patterns) {
      let m;
      while ((m = pattern.exec(text)) !== null) {
        const num = m[1];
        if (num.length >= 4 && num.length <= 6) sets.add(num);
      }
    }

    return [...sets].slice(0, 3);
  }

  async function lookupAmazonPrice(setNum) {
    lastLookupDeferred = false;
    const dbSetNum = setNum.includes('-') ? setNum : setNum + '-1';

    // Persistent cache — TTL is longer for hits than misses.
    const cached = priceCache[dbSetNum];
    if (cached) {
      const ttl = cached.price ? PRICE_CACHE_TTL_MS : PRICE_CACHE_MISS_TTL_MS;
      if ((Date.now() - cached.fetched) < ttl) {
        return cached.price ? cached : null;
      }
    }

    try {
      // Anon-safe RPC: Buy Box + 90d + BSR in one call (sales_rank lives in a
      // user-scoped table the anon key cannot read directly).
      const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/get_amazon_pricing_public`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          apikey: SUPABASE_KEY,
          Authorization: `Bearer ${SUPABASE_KEY}`,
        },
        body: JSON.stringify({ p_set_number: dbSetNum }),
      });

      if (res.ok) {
        const data = await res.json();
        if (data.length > 0 && data[0].amazon_price) {
          const result = {
            price: data[0].amazon_price,
            name: data[0].set_name,
            rrp: data[0].uk_retail_price,
            wasPrice90d: data[0].was_price_90d || null,
            asin: data[0].asin || null,
            salesRank: data[0].sales_rank || null,
            source: 'supabase',
            fetched: Date.now(),
          };

          if (!result.wasPrice90d && Date.now() >= keepaPausedUntil) {
            try {
              const stats = await fetchKeepaStats(setNum);
              if (stats) {
                if (stats.avg90) result.wasPrice90d = stats.avg90;
                if (!result.asin && stats.asin) result.asin = stats.asin;
              }
            } catch (e) {
              console.log(`  🔍 Keepa stats supplement error: ${e.message}`);
            }
          }

          priceCache[dbSetNum] = result;
          priceCacheDirty = true;
          console.log(`  💾 Supabase: ${dbSetNum} "${result.name}" → £${result.price} | RRP £${result.rrp || 'n/a'} | 90d £${result.wasPrice90d?.toFixed(2) || 'n/a'}`);
          return result;
        }
      }
    } catch (e) {
      console.log(`  💾 Supabase error: ${e.message}`);
    }

    // Supabase missed — fall back to Keepa unless we're paused due to 429.
    if (Date.now() < keepaPausedUntil) {
      console.log(`  💾 Supabase: no result for ${dbSetNum} — Keepa paused for ${pricePauseRemainingSec()}s, deferring`);
      // Don't cache; this is transient. Next call after pause expires retries.
      lastLookupDeferred = true;
      return null;
    }

    console.log(`  💾 Supabase: no result for ${dbSetNum} — trying Keepa…`);
    try {
      const keepaResult = await lookupKeepa(setNum);
      if (keepaResult) {
        priceCache[dbSetNum] = keepaResult;
        priceCacheDirty = true;
        return keepaResult;
      }
    } catch (e) {
      console.log(`  🔍 Keepa error: ${e.message}`);
    }

    priceCache[dbSetNum] = { price: null, name: null, rrp: null, source: 'miss', fetched: Date.now() };
    priceCacheDirty = true;
    return null;
  }

  // ── Keepa helpers ──────────────────────────────────────────────────
  async function lookupKeepa(setNum) {
    const product = await searchKeepaProduct(setNum);
    if (!product) return null;

    const stats = product.stats;
    let priceInPence = null;
    if (stats) {
      if (stats.buyBoxPrice && stats.buyBoxPrice > 0) priceInPence = stats.buyBoxPrice;
      else if (stats.current && stats.current[0] > 0) priceInPence = stats.current[0];
      else if (stats.current && stats.current[1] > 0) priceInPence = stats.current[1];
    }

    if (!priceInPence || priceInPence < 0) {
      console.log(`  🔍 Keepa: found "${product.title}" but no current price`);
      return null;
    }

    const price = priceInPence / 100;
    const wasPrice90d = extract90dAvg(stats);
    console.log(`  🔍 Keepa: "${product.title}" → £${price.toFixed(2)} | 90d £${wasPrice90d?.toFixed(2) || 'n/a'} (${product.asin})`);

    return {
      price,
      name: product.title || null,
      rrp: null,
      wasPrice90d,
      source: 'keepa',
      asin: product.asin,
      fetched: Date.now(),
    };
  }

  async function fetchKeepaStats(setNum) {
    const product = await searchKeepaProduct(setNum);
    if (!product) return null;
    const avg90 = extract90dAvg(product.stats);
    return { avg90, asin: product.asin };
  }

  async function searchKeepaProduct(setNum) {
    if (Date.now() < keepaPausedUntil) return null;
    if (!config.keepaKey) {
      console.log('  🔍 Keepa: no API key configured (Options) — skipping fallback');
      return null;
    }

    const term = encodeURIComponent(`LEGO ${setNum}`);
    const url = `https://api.keepa.com/search?key=${config.keepaKey}&domain=2&type=product&term=${term}&stats=1&page=0`;
    const res = await fetch(url);
    if (!res.ok) {
      if (res.status === 429) {
        tripKeepaPause('rate-limited (429)');
      } else {
        console.log(`  🔍 Keepa: API error ${res.status}`);
      }
      return null;
    }
    const data = await res.json();
    if (!data.products || data.products.length === 0) return null;

    let product = null;
    for (const p of data.products) {
      if (p.title && p.title.includes(setNum)) { product = p; break; }
    }
    return product || data.products[0];
  }

  function extract90dAvg(stats) {
    if (!stats || !stats.avg90) return null;
    const avg = stats.avg90[0] > 0 ? stats.avg90[0] : stats.avg90[1];
    return avg > 0 ? avg / 100 : null;
  }

  // ── Listing Extraction ─────────────────────────────────────────────
  function extractListings() {
    const listings = [];
    const seen = new Set();
    const itemLinks = document.querySelectorAll('a[href*="/items/"]');

    for (const link of itemLinks) {
      const href = link.getAttribute('href') || '';
      const idMatch = href.match(/\/items\/(\d+)/);
      if (!idMatch) continue;
      const id = idMatch[1];
      if (seen.has(id)) continue;
      seen.add(id);

      const card = findVintedCard(link);
      if (!card) continue;

      const info = extractVintedCardInfo(card);
      const url = href.startsWith('http') ? href : 'https://www.vinted.co.uk' + href;
      const slugSetNums = extractSetNumbers(href);

      listings.push({ id, url, slugSetNums: slugSetNums.length > 0 ? slugSetNums : null, ...info });
      if (listings.length >= 40) break;
    }
    return listings;
  }

  function findVintedCard(link) {
    let el = link;
    for (let i = 0; i < 8; i++) {
      el = el.parentElement;
      if (!el) return null;
      const hasPrice = el.querySelector('.title-content p, p');
      const hasLink = el.querySelector('a[href*="/items/"]');
      if (hasPrice && hasLink) {
        const priceText = hasPrice.textContent.trim();
        if (/^£[\d,.]+$/.test(priceText)) return el;
      }
    }
    el = link;
    for (let i = 0; i < 4; i++) { if (el.parentElement) el = el.parentElement; }
    return el;
  }

  function extractVintedCardInfo(card) {
    const info = {
      title: '(untitled)', price: null, priceNum: null,
      condition: null, brand: null, imageUrl: null,
      priceWithFees: null, priceInclNum: null,
    };

    const allP = card.querySelectorAll('p');
    for (const p of allP) {
      const t = p.textContent.trim();
      const m = t.match(/^£([\d,.]+)$/);
      if (m) {
        info.price = t;
        info.priceNum = parseFloat(m[1].replace(/,/g, ''));
        break;
      }
    }

    const spans = card.querySelectorAll('span');
    for (const span of spans) {
      const t = span.textContent.trim();
      const m = t.match(/^£([\d,.]+)$/);
      if (m && span.parentElement?.textContent?.includes('incl.')) {
        info.priceWithFees = t;
        info.priceInclNum = parseFloat(m[1].replace(/,/g, ''));
        break;
      }
    }

    if (!info.priceInclNum) {
      const allEls = card.querySelectorAll('span, p, div');
      for (const el of allEls) {
        if (el.children.length > 2) continue;
        const t = el.textContent.trim();
        if (t.includes('incl.') && t.includes('£')) {
          const m = t.match(/£([\d,.]+)/);
          if (m) {
            info.priceWithFees = '£' + m[1];
            info.priceInclNum = parseFloat(m[1].replace(/,/g, ''));
            break;
          }
        }
      }
    }

    const textEls = card.querySelectorAll('p, span, a');
    const allText = [];
    for (const el of textEls) {
      const t = el.textContent.trim();
      if (t && t.length > 0 && t.length < 200 && !t.startsWith('£') && !t.includes('incl.')) {
        allText.push(t);
      }
    }

    for (const t of allText) {
      if (/^(LEGO|Lego)\b/.test(t) && t.length < 30 && !info.brand) info.brand = t.trim();
      if (/\b(New with tags|New without tags|Very good|Good|Satisfactory)\b/i.test(t) && !info.condition) info.condition = t.trim();
    }

    let bestTitle = '';
    for (const t of allText) {
      if (t === info.brand || t === info.condition) continue;
      if (/^(LEGO|Bumped|Removed|Pro)$/i.test(t)) continue;
      if (t.length > bestTitle.length && t.length >= 3 && t.length <= 150) bestTitle = t;
    }
    if (bestTitle) info.title = bestTitle;

    // Image (also harvest fallback titles from <img alt> and link title attr).
    let imgAlt = null;
    let firstImg = null;
    for (const img of card.querySelectorAll('img')) {
      const src = img.src || img.getAttribute('data-src') || '';
      if (src && src.startsWith('http') && !info.imageUrl) {
        info.imageUrl = src;
        firstImg = img;
      }
      const alt = img.getAttribute('alt');
      if (!imgAlt && alt && alt.length >= 3 && alt.length <= 200) imgAlt = alt.trim();
    }

    // Title fallbacks — Vinted card layouts vary and the title text node is
    // sometimes missing entirely (we still see brand + price + image). Try:
    //   1. <a title="…"> attribute
    //   2. <img alt="…"> attribute
    //   3. de-slugged URL path (last resort, low quality)
    if (!info.title || info.title === '(untitled)') {
      const linkWithTitle = card.querySelector('a[title]');
      const linkTitle = linkWithTitle?.getAttribute('title')?.trim();
      const ariaLabel = card.querySelector('[aria-label]')?.getAttribute('aria-label')?.trim();
      if (linkTitle && linkTitle.length >= 3) {
        info.title = linkTitle;
      } else if (imgAlt) {
        info.title = imgAlt;
      } else if (ariaLabel && ariaLabel.length >= 3 && !/^£/.test(ariaLabel)) {
        info.title = ariaLabel;
      } else {
        const link = card.querySelector('a[href*="/items/"]');
        const href = link?.getAttribute('href') || '';
        const slug = href.match(/\/items\/\d+-([a-z0-9-]+)/i)?.[1];
        if (slug) {
          info.title = slug.replace(/-/g, ' ').replace(/\s+/g, ' ').trim();
        }
      }
    }

    return info;
  }

  // ── Discord Webhook (Option A: seller title shown, set name in field) ──
  async function sendToDiscord(listing, setNums, opts) {
    if (!config.webhookUrl) return;
    const {
      mode = 'amazon',
      dealTier = 'amber',
      cog,
      condClass = 'unknown',
      reasons = [],
      lookup = null,
      pov = { new: null, used: null, newMultiple: null, usedMultiple: null },
      povNote = null,
      softWarn = false,
      source = 'unknown',
      matchReason = null,
      visionFeatures = [],
      visionConfidence = null,
      catalogEntry = null,
    } = opts || {};

    // A: seller's title is the embed title; canonical set name moves to a field.
    const sellerTitle = (listing.title || '(untitled)').replace(/\0/g, '').substring(0, 200);
    const tierEmoji = dealTier === 'green' ? '🟢' : '🟠';
    const warnPrefix = softWarn ? '⚠️ ' : '';
    const embedTitle = `${tierEmoji} ${MODE_EMOJI[mode]} ${warnPrefix}${sellerTitle}`.substring(0, 256);

    const fields = [];

    // ▶️ THE PLAY — one glance: what this is, where the value is, what to do.
    // Vinted is first-come-first-served, so this must read in ~2 seconds.
    {
      const setLabel = catalogEntry?.name ? `${setNums[0]} ${catalogEntry.name}` : `set ${setNums[0]}`;
      const playLines = [];
      const amazonFired = reasons.some(r => r.startsWith('Amazon'));
      const usedFired = reasons.some(r => r.startsWith('used POV'));
      const newPovFired = reasons.some(r => r.startsWith('new POV'));
      if (usedFired && pov.used?.soldAvg != null) {
        playLines.push(`→ **Buy used ${setLabel} → break it for parts on BrickLink.**`);
        playLines.push(`Parts sold **£${pov.used.soldAvg.toFixed(2)}** over 6mo vs **£${cog.toFixed(2)}** COG = **${pov.usedMultiple != null ? pov.usedMultiple.toFixed(1) : '?'}× cost**.`);
      }
      if (amazonFired && lookup?.price) {
        const fees = lookup.price * 0.1836;
        const ship = lookup.price < 20 ? 3 : 4;
        const profit = lookup.price - fees - ship - cog;
        playLines.push(`→ **Buy ${setLabel} → resell${condClass === 'new' ? ' sealed' : ''} on Amazon** at £${lookup.price.toFixed(2)} → **£${profit.toFixed(2)} profit (${((profit / lookup.price) * 100).toFixed(1)}%)** after fees.`);
      }
      if (newPovFired && pov.new?.soldAvg != null) {
        playLines.push(`${amazonFired ? 'Second exit — part out' : '→ **Buy to part out on BrickLink**'}: New parts sold **£${pov.new.soldAvg.toFixed(2)}** over 6mo = **${pov.newMultiple != null ? pov.newMultiple.toFixed(1) : '?'}× COG**.`);
      }
      if (playLines.length === 0) playLines.push(`**${setLabel}** flagged by ${MODE_LABELS[mode]} mode.`);
      fields.push({ name: '▶️ The play', value: playLines.join('\n'), inline: false });
      fields.push({
        name: '👉 Do',
        value: `⚡ **Vinted is first-come — buy now** if the photos match${condClass === 'unknown' ? ' (condition unstated — check!)' : ''}.${povNote ? `\n⚠️ ${povNote}` : ''}`,
        inline: false,
      });
    }

    // Vinted COG
    if (listing.price) {
      let priceText = listing.price;
      if (listing.priceWithFees) priceText += ` (${listing.priceWithFees} incl.)`;
      priceText += ` + £${VINTED_POSTAGE.toFixed(2)} post`;
      priceText += `\n**COG: £${cog.toFixed(2)}**`;
      fields.push({ name: '👗 Vinted (COG)', value: priceText, inline: true });
    }

    // Amazon (only present in amazon/hybrid modes when a price was found)
    if (lookup?.price) {
      let amazonText = `£${lookup.price.toFixed(2)}`;
      if (lookup.asin) amazonText += `\n[Keepa](https://keepa.com/#!product/2-${lookup.asin})`;
      fields.push({ name: '🛒 Amazon', value: amazonText, inline: true });
      if (lookup.rrp) fields.push({ name: '🏷️ UK RRP', value: `£${lookup.rrp.toFixed(2)}`, inline: true });
      if (lookup.wasPrice90d) fields.push({ name: '📊 90d Avg', value: `£${lookup.wasPrice90d.toFixed(2)}`, inline: true });
      if (lookup.salesRank) fields.push({ name: '📈 BSR', value: lookup.salesRank.toLocaleString(), inline: true });

      const salePrice = lookup.price;
      const fees = salePrice * 0.1836;
      const shipping = salePrice < 20 ? 3 : 4;
      const profit = salePrice - fees - shipping - cog;
      const marginPct = ((profit / salePrice) * 100).toFixed(1);
      const cogPctOfSale = ((cog / salePrice) * 100).toFixed(1);
      const profitEmoji = profit >= 0 ? '💰' : '🔻';
      fields.push({
        name: `${profitEmoji} Amazon Profit / Margin`,
        value: `Profit: **£${profit.toFixed(2)}** (${marginPct}%)\nCOG: ${cogPctOfSale}% | Fees: £${fees.toFixed(2)} | Ship: £${shipping}`,
        inline: false,
      });
    }

    // Part-Out-Value — condition-matched (req 1). New listing → New POV; otherwise Used POV.
    const displayCond = condClass === 'new' ? 'new' : 'used';
    const dispPov = displayCond === 'new' ? pov.new : pov.used;
    const dispMultiple = displayCond === 'new' ? pov.newMultiple : pov.usedMultiple;
    const povLabel = displayCond === 'new' ? 'Part-Out (New)' : (condClass === 'used' ? 'Part-Out (Used)' : 'Part-Out (Used?)');
    if (dispPov?.soldAvg != null) {
      const lines = [`6mo sold: **£${dispPov.soldAvg.toFixed(2)}**${dispPov.forSaleAvg != null ? ` · for-sale: £${dispPov.forSaleAvg.toFixed(2)}` : ''}`];
      const meta = [];
      if (dispMultiple != null) meta.push(`**${dispMultiple.toFixed(1)}× COG**`);
      if (dispPov.lots != null) meta.push(`${dispPov.lots} lots`);
      if (displayCond === 'new' && dispPov.multiple != null) meta.push(`${dispPov.multiple.toFixed(2)}× RRP`);
      if (meta.length) lines.push(meta.join(' · '));
      if (displayCond === 'used' && povNote) lines.push(povNote);
      fields.push({ name: `🧩 ${povLabel}`, value: lines.join('\n'), inline: false });
    } else {
      fields.push({ name: `🧩 ${povLabel}`, value: dispPov?.noData ? `no part-out data (${dispPov.noData})` : 'no BL part-out data', inline: false });
    }

    // Set numbers
    if (setNums.length > 0) {
      const links = setNums.map(n => `[${n}](https://brickset.com/sets/${n})`);
      fields.push({ name: '🧱 Set #', value: links.join(', '), inline: true });
    }

    // Set name + theme — split into two inline fields so the theme sits
    // alongside the canonical name and is easy to glance at when reviewing.
    const canonicalName = catalogEntry?.name || lookup?.name || dispPov?.setName;
    if (canonicalName) {
      fields.push({ name: '📚 Set', value: String(canonicalName).substring(0, 1024), inline: true });
    }
    if (catalogEntry?.theme) {
      fields.push({ name: '🎭 Theme', value: String(catalogEntry.theme).substring(0, 1024), inline: true });
    }

    if (listing.condition) {
      // Vinted now ships size info inside the same string ("S · New with tags").
      // Strip any leading "X · " prefix so we don't double it up in the embed.
      const conditionClean = listing.condition.replace(/^[A-Z0-9]+\s*[·•]\s*/, '').trim();
      fields.push({ name: 'Condition', value: `S · ${conditionClean}`, inline: true });
    }

    const color = dealTier === 'green' ? 3066993 : 15844367;
    const embed = {
      title: embedTitle,
      url: listing.url,
      color,
      timestamp: new Date().toISOString(),
      footer: { text: `Vinted Sniper · ${MODE_LABELS[mode]}` },
      fields,
    };
    if (listing.imageUrl?.startsWith('https') && listing.imageUrl.length < 2000) {
      embed.thumbnail = { url: listing.imageUrl };
    }

    try {
      const res = await fetch(config.webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ embeds: [embed] }),
      });
      if (!res.ok) {
        const err = await res.text().catch(() => '');
        console.error(`[Vinted Sniper] Discord ${res.status}: ${err}`);
        if (embed.thumbnail) {
          delete embed.thumbnail;
          await fetch(config.webhookUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ embeds: [embed] }),
          });
        }
      } else {
        lastAlertTime = new Date();
        console.log(`[Vinted Sniper] → Discord: ${listing.id} | ${sellerTitle} | COG £${cog.toFixed(2)} | [${mode}] ${reasons.join(' · ')} | ${tierLabel}${softWarn ? ' (⚠️)' : ''}`);
      }
    } catch (e) {
      console.error('[Vinted Sniper] Discord error:', e);
    }
  }

  // ── Status Bar ─────────────────────────────────────────────────────
  function showStatusBar() {
    let bar = document.getElementById('vinted-sniper-status');
    if (!bar) {
      bar = document.createElement('div');
      bar.id = 'vinted-sniper-status';
      Object.assign(bar.style, {
        position: 'fixed', bottom: '0', left: '0', right: '0', zIndex: '999999',
        padding: '6px 16px', fontSize: '12px', fontWeight: '500',
        fontFamily: '-apple-system, BlinkMacSystemFont, sans-serif',
        background: 'rgba(22, 33, 62, 0.95)', color: '#a0aec0',
        borderTop: '1px solid #2d3748', display: 'flex',
        justifyContent: 'space-between', alignItems: 'center',
      });
      document.body.appendChild(bar);
      // Delegated click: the mode chip cycles the per-tab buy mode. Attached once
      // (innerHTML is rebuilt every 5s, which would drop a direct listener).
      bar.addEventListener('click', e => {
        if (e.target.closest('#vinted-sniper-mode')) cycleMode();
      });
    }
    updateStatusBar();
  }

  function updateStatusBar() {
    let bar = document.getElementById('vinted-sniper-status');
    if (!bar) {
      showStatusBar();
      bar = document.getElementById('vinted-sniper-status');
      if (!bar) return;
    }

    const lastStr = lastAlertTime ? lastAlertTime.toLocaleTimeString() : 'never';
    const cacheSize = Object.keys(priceCache).length;
    const visionSize = Object.keys(visionCache).length;
    const povSize = Object.keys(povCache).length;
    const catalogSize = Object.keys(catalog.sets || {}).length;

    let refreshDisplay;
    if (isQuiet) {
      refreshDisplay = `<strong style="color:#a78bfa">😴 QUIET (${config.quietStart}:00-${config.quietEnd}:00)</strong>`;
    } else if (nextRefreshAt) {
      const nextRefresh = Math.max(0, Math.round((nextRefreshAt - Date.now()) / 1000));
      const nextStr = nextRefresh > 60
        ? `${Math.floor(nextRefresh / 60)}m ${nextRefresh % 60}s`
        : `${nextRefresh}s`;
      refreshDisplay = `<strong style="color:#f6e05e">${nextStr}</strong> <span style="color:#718096">(${config.refreshMinSecs}-${config.refreshMaxSecs}s)</span>`;
    } else {
      refreshDisplay = '<strong>—</strong>';
    }

    const keepaSecs = pricePauseRemainingSec();
    const keepaStatus = keepaSecs > 0
      ? `<strong style="color:#fbbf24">Keepa pause ${keepaSecs}s</strong> | `
      : '';

    const modeChip = `<span id="vinted-sniper-mode" title="Click to switch buy mode (this tab): Amazon → Hybrid (New) → Used POV"
        style="cursor:pointer; padding:2px 9px; border-radius:6px; background:#0f3460; border:1px solid #1a4a7a; color:#e2e8f0; user-select:none;">${MODE_EMOJI[currentMode]} ${MODE_LABELS[currentMode]} ▾</span>`;

    bar.innerHTML = `
      <span>👗 <strong style="color:#00b894">Vinted Sniper${isQuiet ? ' (Paused)' : ' Active'}</strong> —
        Mode: ${modeChip} |
        Scans: <strong>${scanCount}</strong> |
        Catalog: <strong>${catalogSize}</strong> |
        Vision: <strong>${visionSize}</strong> |
        Price: <strong>${cacheSize}</strong> |
        POV: <strong>${povSize}</strong></span>
      <span>${keepaStatus}Last alert: <strong>${lastStr}</strong> |
        Next refresh: ${refreshDisplay}</span>
    `;
  }

  setInterval(updateStatusBar, 5000);

  // ── UI Banner ──────────────────────────────────────────────────────
  function showBanner(message, type) {
    const el = document.getElementById('vinted-sniper-banner');
    if (el) el.remove();
    const banner = document.createElement('div');
    banner.id = 'vinted-sniper-banner';
    banner.textContent = message;
    Object.assign(banner.style, {
      position: 'fixed', top: '8px', right: '8px', zIndex: '999999',
      padding: '10px 18px', borderRadius: '8px', fontSize: '13px',
      fontWeight: '600', fontFamily: '-apple-system, BlinkMacSystemFont, sans-serif',
      boxShadow: '0 4px 12px rgba(0,0,0,0.3)', transition: 'opacity 0.5s',
      background: type === 'ok' ? '#00b894' : '#7f4f24', color: '#fff',
    });
    document.body.appendChild(banner);
    setTimeout(() => { banner.style.opacity = '0'; setTimeout(() => banner.remove(), 600); }, 5000);
  }

})();
