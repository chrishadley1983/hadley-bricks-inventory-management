/**
 * Shared BrickLink store scraping over Chrome CDP.
 *
 * Extracted so both the arbitrage basket (bl-basket) and the store-assessment CLI
 * can drive the same proven scrape. Node-only (uses `ws` + node fetch) — imported
 * by scripts, never by the Next.js app bundle.
 */
import WebSocket from 'ws';
import type { StoreLot, StoreProfile } from '../../src/lib/bl-store-assessment/types';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export class CDPClient {
  private ws: WebSocket | null = null;
  private msgId = 0;
  private pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();

  async connect(wsUrl: string): Promise<void> {
    this.ws = new WebSocket(wsUrl);
    await new Promise<void>((resolve, reject) => {
      this.ws!.once('open', () => resolve());
      this.ws!.once('error', (err) => reject(err));
    });
    this.ws.on('message', (data) => {
      const msg = JSON.parse(data.toString()) as { id?: number; result?: unknown; error?: { message: string } };
      if (msg.id && this.pending.has(msg.id)) {
        const handler = this.pending.get(msg.id)!;
        this.pending.delete(msg.id);
        if (msg.error) handler.reject(new Error(msg.error.message));
        else handler.resolve(msg.result);
      }
    });
  }
  send<T = unknown>(method: string, params: Record<string, unknown> = {}): Promise<T> {
    return new Promise((resolve, reject) => {
      const id = ++this.msgId;
      this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject });
      this.ws!.send(JSON.stringify({ id, method, params }));
    });
  }
  async evaluate<T>(expression: string, awaitPromise = false): Promise<T> {
    const res = await this.send<{ result?: { value?: T }; exceptionDetails?: { text: string } }>('Runtime.evaluate', { expression, awaitPromise, returnByValue: true });
    if (res.exceptionDetails) throw new Error(`CDP eval failed: ${res.exceptionDetails.text}`);
    return res.result?.value as T;
  }
  async navigate(url: string, waitMs = 4000) {
    await this.send('Page.navigate', { url });
    for (let i = 0; i < 40; i++) {
      await sleep(500);
      const state = await this.evaluate<string>('document.readyState');
      if (state === 'complete') break;
    }
    await sleep(waitMs);
  }
  /** Tab created by connectCdp for this client — closed on close() so we never leak tabs. */
  ownedTabId: string | null = null;
  ownedTabPort: number | null = null;
  close() {
    this.ws?.close();
    if (this.ownedTabId && this.ownedTabPort) {
      // Best-effort, fire-and-forget: leaked tabs degrade the shared Chrome over time.
      fetch(`http://127.0.0.1:${this.ownedTabPort}/json/close/${this.ownedTabId}`).catch(() => {});
    }
  }
}

export async function connectCdp(port: number, storeSlug: string): Promise<CDPClient> {
  const version = (await fetch(`http://127.0.0.1:${port}/json/version`).then((r) => r.json()).catch(() => null)) as { Browser?: string } | null;
  if (!version?.Browser) {
    throw new Error(`Chrome CDP not reachable on :${port}. Start C:\\chrome-cdp\\launch-cdp-chrome.bat, log in to BrickLink, then re-run.`);
  }
  // Own tab (2026-07-14 audit): reusing whatever tab matched the slug meant two concurrent
  // jobs could drive the SAME tab and corrupt each other's navigation. Create a dedicated
  // tab (PUT /json/new — Chrome 111+ requires PUT) and close it on exit.
  const created = (await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' })
    .then((r) => (r.ok ? r.json() : null))
    .catch(() => null)) as { id?: string; webSocketDebuggerUrl?: string } | null;
  let wsUrl = created?.webSocketDebuggerUrl;
  if (!wsUrl) {
    // Fallback to the legacy tab-reuse path (older Chrome / endpoint disabled).
    const tabs = (await fetch(`http://127.0.0.1:${port}/json`).then((r) => r.json())) as Array<{ type: string; url: string; webSocketDebuggerUrl: string }>;
    const existing = tabs.find((t) => t.type === 'page' && t.url.includes(storeSlug));
    const blank = tabs.find((t) => t.type === 'page');
    wsUrl = (existing ?? blank)?.webSocketDebuggerUrl;
  }
  if (!wsUrl) throw new Error('[cdp] No page tab available');
  const cdp = new CDPClient();
  if (created?.id) { cdp.ownedTabId = created.id; cdp.ownedTabPort = port; }
  await cdp.connect(wsUrl);
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  return cdp;
}

export interface StoreMeta { storeId: number; storeName: string; country: string; isUK: boolean }

/** Load the store page and read identity + country from the StoreFront object.
 * POLLS up to ~20s for the SPA to populate — a fixed sleep raced the async render on
 * cold tabs and mis-read healthy UK stores as country "unknown" (5/25 stores in the
 * 2026-07-14 nightly sweep; also seen on fresh post-port-split tabs). */
export async function preflight(cdp: CDPClient, storeSlug: string): Promise<StoreMeta> {
  await cdp.navigate(`https://store.bricklink.com/${storeSlug}#/shop`);
  const probe = `(() => {
    const sf = window.StoreFront;
    const bodyText = (document.body.innerText || '').slice(0, 2000);
    const isUK = /United Kingdom/i.test(bodyText);
    const countryMatch = bodyText.match(/\\bBy\\s+\\S+[^\\n]*?in\\s+([^\\n]+?)\\s{2,}/);
    const sfCountry = sf?.store?.country;
    const country = isUK
      ? 'United Kingdom'
      : (countryMatch ? countryMatch[1]
        : (sfCountry === 'GB' || sfCountry === 'UK' ? 'United Kingdom' : (sfCountry ?? 'unknown')));
    return JSON.stringify({ storeId: sf?.store?.id, storeName: sf?.store?.name, country });
  })()`;
  const deadline = Date.now() + 20000;
  let parsed: { storeId: number; storeName: string; country: string };
  for (;;) {
    parsed = JSON.parse(await cdp.evaluate<string>(probe)) as typeof parsed;
    if ((parsed.country && parsed.country !== 'unknown' && parsed.storeId != null) || Date.now() > deadline) break;
    await sleep(1500);
  }
  return { storeId: parsed.storeId, storeName: parsed.storeName, country: parsed.country, isUK: parsed.country === 'United Kingdom' };
}

export interface StoreScrapeResult {
  lots: StoreLot[];
  /**
   * True when any item type hit the page cap with results still coming, or a scan
   * stopped early on a page of duplicates (inventory shifting mid-scrape). Totals
   * built from a truncated scrape understate the store — surface this, never hide it.
   */
  truncated: boolean;
}

/** Scrape all P/S/M inventory lots from the store via the searchitems AJAX endpoint. */
export async function scrapeStoreInventory(
  cdp: CDPClient,
  storeId: number,
  opts: { maxPages?: number; pageDelayMs?: number; onProgress?: (msg: string) => void } = {},
): Promise<StoreScrapeResult> {
  const maxPages = opts.maxPages ?? 500; // raised 50->500 (2026-07-13) — no truncation on realistic stores
  const pageDelay = Math.max(3000, opts.pageDelayMs ?? 3000);
  const log = opts.onProgress ?? (() => {});
  const all: StoreLot[] = [];
  const seen = new Set<number>();
  let truncated = false;

  for (const type of ['P', 'S', 'M'] as StoreLot['itemType'][]) {
    for (let pg = 1; pg <= maxPages; pg++) {
      const url = `https://store.bricklink.com/ajax/clone/store/searchitems.ajax?sort=1&itemType=${type}&showHomeItems=0&pgSize=100&rpp=100&pg=${pg}&sid=${storeId}`;
      const raw = await cdp.evaluate<string>(`(async () => {
        try {
          const res = await fetch(${JSON.stringify(url)}, { headers: { 'X-Requested-With':'XMLHttpRequest', 'Accept':'application/json' }, credentials:'include' });
          if (!res.ok) return JSON.stringify({ err: 'HTTP ' + res.status });
          const text = await res.text();
          if (text.trim().startsWith('<')) return JSON.stringify({ err: 'HTML response (login/captcha?)' });
          return text;
        } catch (e) { return JSON.stringify({ err: e.message }); }
      })()`, true);
      let parsed: { result?: { groups?: Array<{ items?: Array<Record<string, unknown>> }> }; err?: string };
      try { parsed = JSON.parse(raw); } catch { log(`[scrape] ${type} pg=${pg}: non-JSON, stopping`); break; }
      if (parsed.err) { log(`[scrape] ${type} pg=${pg}: ${parsed.err}`); break; }
      const items = parsed.result?.groups?.[0]?.items ?? [];
      if (items.length === 0) break;
      let added = 0;
      for (const it of items) {
        const invID = Number((it as { invID: unknown }).invID);
        if (seen.has(invID)) continue;
        seen.add(invID);
        const nativePrice = Number((it as { nativePrice: unknown }).nativePrice);
        const rawConv = Number((it as { rawConvertedPrice: unknown }).rawConvertedPrice);
        const unitPriceGBP = nativePrice > 0 ? nativePrice : (Number.isFinite(rawConv) ? rawConv : 0);
        // Collectible minifigs are catalogued PER FIGURE as `${base}-${seq}` (e.g. col10-6
        // = Skydiver). The store AJAX returns only the bare series base in `itemNo` and the
        // figure index in `itemSeq`. Bare `col10` resolves to figure -1 in the price guide,
        // so without the suffix all 16 figures inherit ONE (wrong) price. Reconstruct the
        // real figure number for col* items. Regular sets/parts price on their bare number
        // (variant is implicitly -1), so they are left untouched.
        const rawNo = String((it as { itemNo: unknown }).itemNo);
        const itemSeq = Number((it as { itemSeq?: unknown }).itemSeq ?? 0);
        const itemNo = /^col/i.test(rawNo) && itemSeq > 0 ? `${rawNo}-${itemSeq}` : rawNo;
        all.push({
          invID,
          itemType: type,
          itemNo,
          colourId: Number((it as { colorID: unknown }).colorID ?? 0),
          colourName: ((it as { colorName?: string }).colorName) ?? null,
          itemName: String((it as { itemName: unknown }).itemName),
          invNew: String((it as { invNew: unknown }).invNew),
          invComplete: (it as { invComplete?: string }).invComplete ?? null,
          invQty: Number((it as { invQty: unknown }).invQty),
          unitPriceGBP,
          description: (it as { invDescription?: string }).invDescription ?? null,
        });
        added++;
      }
      log(`  [${type}] pg=${pg} +${added} (total ${all.length})`);
      if (added === 0) {
        // A full page of already-seen invIDs means the store's paging shifted under
        // us — we can't tell what we missed, so treat the scan as incomplete.
        log(`  [${type}] pg=${pg}: page was all duplicates (inventory shifted?) — marking scan truncated`);
        truncated = true;
        break;
      }
      if (pg === maxPages && items.length >= 100) {
        // Full page at the cap → almost certainly more pages behind it.
        log(`  [${type}] hit the ${maxPages}-page cap with results still coming — scan truncated (raise --max-pages)`);
        truncated = true;
      }
      if (pg < maxPages) await sleep(pageDelay);
    }
  }
  return { lots: all, truncated };
}

/**
 * Best-effort store-profile scrape: feedback score, positive %, member-since, and an
 * order-rate proxy (praise received in the last 6 months). Reads the StoreFront object
 * first, then falls back to parsing feedback.asp for the seller's username. Every field
 * degrades to null rather than throwing — feedback is a bonus section, not a gate.
 */
export async function scrapeStoreProfile(cdp: CDPClient, storeSlug: string, meta: StoreMeta): Promise<StoreProfile> {
  const base: StoreProfile = {
    storeId: meta.storeId, storeName: meta.storeName, country: meta.country,
    feedbackScore: null, positivePct: null, feedbackLast6mo: null, ordersPerMonth: null,
    memberSince: null, scrapedAt: new Date().toISOString(),
  };
  try {
    // 1. StoreFront (already loaded on the store page after preflight) gives the reliable fields:
    //    feedbackScore (all-time praise), userSince (member since), username.
    const sfRaw = await cdp.evaluate<string>(`(() => {
      const s = (window.StoreFront && window.StoreFront.store) || {};
      return JSON.stringify({
        username: s.username || null,
        feedbackScore: (typeof s.feedbackScore === 'number') ? s.feedbackScore : null,
        memberSince: s.userSince || s.date || null,
      });
    })()`);
    const sf = JSON.parse(sfRaw) as { username: string | null; feedbackScore: number | null; memberSince: string | null };
    if (typeof sf.feedbackScore === 'number') base.feedbackScore = sf.feedbackScore;
    if (sf.memberSince) base.memberSince = String(sf.memberSince);

    // 2. feedback.asp carries the Praise/Neutral/Complaint summary in 4 columns
    //    [last week, last month, last 6 months, all time]. The 6-month praise count is
    //    our order-rate proxy; all-time counts give the positive %.
    //    Only the StoreFront username is trusted here — the store DISPLAY name is not a
    //    username, and querying feedback.asp with it could silently return some other
    //    member's stats. No username → leave the feedback fields null.
    const user = sf.username;
    if (user) {
      await cdp.navigate(`https://www.bricklink.com/feedback.asp?u=${encodeURIComponent(user)}`, 3500);
      const txt = await cdp.evaluate<string>('document.body.innerText || ""');
      // Belt-and-braces: make sure the page is actually about this member before parsing.
      if (!txt.toLowerCase().includes(user.toLowerCase())) return base;
      const row = (label: string): number[] | null => {
        const m = txt.match(new RegExp(`${label}:\\s*([\\d,]+)\\s+([\\d,]+)\\s+([\\d,]+)\\s+([\\d,]+)`, 'i'));
        return m ? m.slice(1, 5).map((x) => parseInt(x.replace(/,/g, ''), 10)) : null;
      };
      const praise = row('Praise');
      const neutral = row('Neutral');
      const complaint = row('Complaint');
      if (praise) {
        base.feedbackLast6mo = praise[2];
        base.ordersPerMonth = Math.round((praise[2] / 6) * 10) / 10;
        if (base.feedbackScore == null) base.feedbackScore = praise[3];
        const pAll = praise[3], nAll = neutral?.[3] ?? 0, cAll = complaint?.[3] ?? 0;
        const denom = pAll + nAll + cAll;
        if (denom > 0) base.positivePct = Math.round((pAll / denom) * 1000) / 10;
      }
    }
  } catch {
    /* best-effort — return whatever we have */
  }
  return base;
}
