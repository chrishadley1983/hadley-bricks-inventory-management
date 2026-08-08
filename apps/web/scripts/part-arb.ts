/**
 * Part-first arbitrage CLI — anchors -> stores -> concentrated basket.
 *
 * The inverse of bl-basket: instead of picking a store and scoring it, screen the
 * UK price-guide cache for undervalued high-STR part/minifig tuples (anchors),
 * find which scraped stores hold those units cheaply (bl_store_lots), then score
 * each nominated store's whole cached inventory through the common bl-store-report
 * decision module. Findings persist to part_arb_candidates. Nothing is bought from
 * a cached scrape: the ground stage re-scrapes live before any wanted list / cart.
 *
 * Usage (from apps/web):
 *   npx tsx scripts/part-arb.ts                                  # discover
 *   npx tsx scripts/part-arb.ts --backfill-lots                  # flatten all scrapes
 *   npx tsx scripts/part-arb.ts --ground --store-slug=X --xml-only
 *   npx tsx scripts/part-arb.ts --ground --store-slug=X --cart
 *
 * Discover flags:
 *   --min-str-lots=<x>     Anchor house-STR gate (sold_lots/stock_lots). Default 1.0.
 *   --min-sold-qty=<n>     Anchor demand gate: UK sold units/6mo. Default 10.
 *                          Deliberately NO sold-value floor — a 50p part sold 10x counts.
 *   --min-ask=<gbp>        Ignore asks below this. Default 0.10.
 *   --min-margin=<pct>     Net margin threshold (net after 9.4% fees / list, ex-postage;
 *                          inbound postage is charged once to the basket, outbound is
 *                          buyer-paid). Default 0.30 (PART_ARB_MIN_MARGIN — tighter than
 *                          the 20% bl-basket floor by design, Chris 2026-08-08).
 *   --min-basket-str=<x>   Basket lot STR (qty) gate. Default 0 (ladder shows bands).
 *   --shipping=<gbp>       Inbound postage estimate. Default 3.00.
 *   --min-units=<n>        Anchor units buyable below ceiling. Default 1.
 *   --min-liquid-net=<gbp> Keep stores whose LIQUID net clears this. Default 15.
 *   --max-stores=<n>       Full reports rendered/persisted for top N stores. Default 10.
 *   --cache-ttl-days=<n>   Benchmark freshness for basket scoring. Default 90.
 *   --no-flatten           Skip the incremental bl_store_lots refresh check.
 *   --no-persist           Don't write part_arb_candidates.
 *
 * Ground flags (--ground --store-slug=<slug>):
 *   --xml-only             After live re-scrape + re-score, write the wanted-list XML
 *                          (buy manually via BL wanted list) and stop.
 *   --cart                 After live re-scrape, hand off to bl-basket (which reuses
 *                          the fresh inventory.json) for wanted upload + cart build.
 *   --wanted-min-str=<x>   STR floor for XML entries. Default 0.25 (LIQUID_STR_GATE).
 *   --cdp-port=<n>         Chrome CDP port. Default 9222.
 *   --max-pages=<n>        Scrape page cap per item type. Default 500.
 *   --page-delay-ms=<n>    Scrape page delay. Default 3000 (floor).
 *   --user-id=<uuid>       Supabase user for persisted rows (or STORE_ASSESSMENT_USER_ID).
 */

import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import * as fs from 'fs';
import * as path from 'path';
import { spawnSync } from 'child_process';
import { readPriceGuide, pgKey, type ItemRef } from '../src/lib/bricklink/price-guide/read';
import { LIQUID_STR_GATE, DEFAULT_INBOUND_POSTAGE_GBP, PART_ARB_MIN_MARGIN } from '../src/lib/bricklink/fees';
import { generateWantedXml } from '../src/lib/bricklink/wanted-list';
import {
  buildBasketDecisionReport, renderDecisionCli, renderDecisionMd,
} from '../src/lib/bl-store-report';
import type { DecisionReport } from '../src/lib/bl-store-report';
import {
  anchorsFromCacheRow, nominateStores, scoreStoreLots, wantedLotsFromScored,
  type PartArbScoredLot,
} from '../src/lib/bl-part-arb/engine';
import type { AnchorTuple, FlatStoreLot, PartArbInputs, StoreNomination } from '../src/lib/bl-part-arb/types';
import type { StoreLot } from '../src/lib/bl-store-assessment/types';
import { connectCdp, preflight, scrapeStoreInventory } from './lib/store-scrape';

dotenv.config({ path: path.resolve(__dirname, '../.env.local') });

// ---------------------------------------------------------------------------
// CLI args
// ---------------------------------------------------------------------------

const argv = process.argv.slice(2).reduce<Record<string, string>>((acc, a) => {
  const [k, v] = a.replace(/^--/, '').split('=');
  acc[k] = v ?? 'true';
  return acc;
}, {});

const GROUND = argv['ground'] === 'true';
const BACKFILL = argv['backfill-lots'] === 'true';
const STORE_SLUG = argv['store-slug'] && argv['store-slug'] !== 'true' ? argv['store-slug'] : null;
const XML_ONLY = argv['xml-only'] === 'true';
const CART = argv['cart'] === 'true';
const NO_FLATTEN = argv['no-flatten'] === 'true';
const NO_PERSIST = argv['no-persist'] === 'true';

const INPUTS: PartArbInputs = {
  minStrLots: parseFloat(argv['min-str-lots'] ?? '1.0'),
  minSoldQty: parseInt(argv['min-sold-qty'] ?? '10', 10),
  minAsk: parseFloat(argv['min-ask'] ?? '0.10'),
  minMargin: parseFloat(argv['min-margin'] ?? String(PART_ARB_MIN_MARGIN)),
  minStr: parseFloat(argv['min-basket-str'] ?? '0'),
  shipping: parseFloat(argv['shipping'] ?? String(DEFAULT_INBOUND_POSTAGE_GBP)),
  minUnitsBuyable: parseInt(argv['min-units'] ?? '1', 10),
};
const MIN_LIQUID_NET = parseFloat(argv['min-liquid-net'] ?? '15');
const MAX_STORES = parseInt(argv['max-stores'] ?? '10', 10);
const CACHE_TTL_DAYS = parseInt(argv['cache-ttl-days'] ?? '90', 10);
const WANTED_MIN_STR = parseFloat(argv['wanted-min-str'] ?? String(LIQUID_STR_GATE));
const CDP_PORT = parseInt(argv['cdp-port'] ?? '9222', 10);
const MAX_PAGES = parseInt(argv['max-pages'] ?? '500', 10);
const PAGE_DELAY_MS = Math.max(3000, parseInt(argv['page-delay-ms'] ?? '3000', 10));
const USER_ID = (argv['user-id'] && argv['user-id'] !== 'true' ? argv['user-id'] : null)
  ?? process.env.STORE_ASSESSMENT_USER_ID ?? null;

const RUN_DATE = new Date().toISOString().slice(0, 10);
const OUT_DIR = path.resolve(__dirname, `../../../tmp/part-arb/${RUN_DATE}`);

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!supabaseUrl || !supabaseKey) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY in apps/web/.env.local');
  process.exit(1);
}
const supabase = createClient(supabaseUrl, supabaseKey);

const log = (msg: string) => console.log(msg);

// ---------------------------------------------------------------------------
// Flatten refresh (bl_store_scrapes.lots -> bl_store_lots)
// ---------------------------------------------------------------------------

async function refreshFlattenedLots(all: boolean): Promise<void> {
  // Which stores need (re-)flattening? The view compares scrape vs flattened timestamps.
  const slugs: string[] = [];
  let from = 0;
  for (;;) {
    const { data, error } = await supabase
      .from('bl_store_lots_freshness')
      .select('store_slug, needs_refresh')
      .order('store_slug')
      .range(from, from + 999);
    if (error) throw new Error(`bl_store_lots_freshness read failed: ${error.message}`);
    for (const r of data ?? []) if (all || r.needs_refresh) slugs.push(r.store_slug as string);
    if (!data || data.length < 1000) break;
    from += 1000;
  }
  if (slugs.length === 0) {
    log('[flatten] bl_store_lots up to date');
    return;
  }
  log(`[flatten] refreshing ${slugs.length} store(s)...`);
  let done = 0;
  let rows = 0;
  for (const slug of slugs) {
    const { data, error } = await supabase.rpc('refresh_bl_store_lots', { p_slug: slug });
    if (error) console.error(`[flatten] ${slug} failed: ${error.message}`);
    else rows += (data as number) ?? 0;
    done++;
    if (done % 50 === 0) log(`[flatten] ${done}/${slugs.length}`);
  }
  log(`[flatten] done — ${done} store(s), ${rows} lot rows`);
}

// ---------------------------------------------------------------------------
// Discover phase 1: anchor screen over the UK price-guide cache
// ---------------------------------------------------------------------------

async function screenAnchors(): Promise<AnchorTuple[]> {
  const COLS = 'id,item_type,item_no,colour_id,item_name,uk_detail,' +
    ['new', 'used'].flatMap((c) => [
      `uk_sold_avg_${c}`, `uk_sold_qty_avg_${c}`, `uk_sold_median_${c}`, `uk_sold_lots_${c}`,
      `uk_sold_qty_${c}`, `uk_sold_last2mo_qty_${c}`, `uk_stock_qty_${c}`, `uk_stock_lots_${c}`, `uk_stock_min_${c}`,
    ]).join(',');
  const anchors: AnchorTuple[] = [];
  let scanned = 0;
  let lastId: string | null = null; // id is a uuid — keyset cursor is a string
  for (;;) {
    // Keyset pagination on id (offset pagination over ~100k rows degrades).
    let q = supabase
      .from('bricklink_price_guide_cache')
      .select(COLS)
      .in('item_type', ['P', 'M'])
      .or(`uk_sold_qty_new.gte.${INPUTS.minSoldQty},uk_sold_qty_used.gte.${INPUTS.minSoldQty}`)
      .order('id')
      .limit(1000);
    if (lastId != null) q = q.gt('id', lastId);
    const { data, error } = await q;
    if (error) throw new Error(`anchor screen read failed: ${error.message}`);
    const rows = (data ?? []) as unknown as Record<string, unknown>[];
    if (rows.length === 0) break;
    for (const row of rows) anchors.push(...anchorsFromCacheRow(row, INPUTS));
    scanned += rows.length;
    lastId = String(rows[rows.length - 1].id);
    if (scanned % 10000 === 0) log(`[anchors] scanned ${scanned} cache rows, ${anchors.length} anchors so far`);
    if (rows.length < 1000) break;
  }
  log(`[anchors] ${anchors.length} anchor(s) from ${scanned} demand-prefiltered cache rows ` +
    `(STRlots >= ${INPUTS.minStrLots}, soldQty >= ${INPUTS.minSoldQty}, units-below-ceiling >= ${INPUTS.minUnitsBuyable})`);
  return anchors;
}

// ---------------------------------------------------------------------------
// Discover phase 2: nominate stores holding anchor units below the ceiling
// ---------------------------------------------------------------------------

async function fetchAnchorStoreLots(anchors: AnchorTuple[]): Promise<FlatStoreLot[]> {
  const out: FlatStoreLot[] = [];
  const itemNos = [...new Set(anchors.map((a) => a.itemNo))];
  const CHUNK = 200;
  for (let i = 0; i < itemNos.length; i += CHUNK) {
    const chunk = itemNos.slice(i, i + CHUNK);
    // Server-side ask window: [minAsk, max ceiling of the chunk's anchors] — cuts the
    // popular-part row flood; the exact per-anchor ceiling is applied in nominateStores.
    const chunkAnchors = anchors.filter((a) => chunk.includes(a.itemNo));
    const maxCeil = Math.max(...chunkAnchors.map((a) => a.maxViableAsk));
    let from = 0;
    for (;;) {
      const { data, error } = await supabase
        .from('bl_store_lots')
        .select('store_slug, inv_id, item_type, item_no, colour_id, condition, inv_qty, unit_price_gbp, scanned_at')
        .in('item_type', ['P', 'M'])
        .in('item_no', chunk)
        .gte('unit_price_gbp', INPUTS.minAsk)
        .lte('unit_price_gbp', maxCeil)
        // Stable page order: inv_id alone is not schema-unique (PK is slug+inv_id).
        .order('store_slug')
        .order('inv_id')
        .range(from, from + 999);
      if (error) throw new Error(`bl_store_lots read failed: ${error.message}`);
      out.push(...((data ?? []) as unknown as FlatStoreLot[]));
      if (!data || data.length < 1000) break;
      from += 1000;
    }
    if ((i / CHUNK) % 5 === 4) log(`[nominate] fetched lots for ${Math.min(i + CHUNK, itemNos.length)}/${itemNos.length} item numbers`);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Basket scoring for one store (cached scrape or fresh lots)
// ---------------------------------------------------------------------------

interface StoreBasket {
  slug: string;
  storeName: string | null;
  country: string | null;
  scannedAt: string | null;
  truncated: boolean;
  items: PartArbScoredLot[];
  report: DecisionReport;
}

async function scoreStore(
  slug: string,
  lots: StoreLot[],
  meta: { storeName: string | null; country: string | null; scannedAt: string | null; truncated: boolean },
): Promise<StoreBasket> {
  const refs: ItemRef[] = [];
  const seen = new Set<string>();
  for (const l of lots) {
    if (l.itemType === 'S') continue;
    const colour = l.itemType === 'P' ? l.colourId : 0;
    const k = pgKey(l.itemType, l.itemNo, colour);
    if (seen.has(k)) continue;
    seen.add(k);
    refs.push({ itemType: l.itemType, itemNo: l.itemNo, colourId: colour });
  }
  const views = await readPriceGuide(supabase, refs, { ttlDays: CACHE_TTL_DAYS, allowWorldFallback: false });
  const items = scoreStoreLots(lots, views, INPUTS);
  const report = buildBasketDecisionReport(items, {
    slug,
    storeName: meta.storeName,
    country: meta.country,
    inputs: { minMargin: INPUTS.minMargin, minStr: INPUTS.minStr, shipping: INPUTS.shipping },
  });
  return { slug, storeName: meta.storeName, country: meta.country, scannedAt: meta.scannedAt, truncated: meta.truncated, items, report };
}

async function loadCachedScrape(slug: string): Promise<{ lots: StoreLot[]; scannedAt: string | null; truncated: boolean } | null> {
  const { data, error } = await supabase
    .from('bl_store_scrapes')
    .select('lots, scanned_at, truncated')
    .eq('store_slug', slug)
    .maybeSingle();
  if (error) throw new Error(`bl_store_scrapes read failed for ${slug}: ${error.message}`);
  if (!data) return null;
  return { lots: data.lots as StoreLot[], scannedAt: data.scanned_at as string | null, truncated: Boolean(data.truncated) };
}

/** Latest known store display name/country per slug (from the nightly assessments).
 * store_assessments is append-per-run, so a busy slug could crowd others out of any
 * single page — paginate each chunk until every slug has meta or rows run out. */
async function loadStoreMeta(slugs: string[]): Promise<Map<string, { storeName: string | null; country: string | null }>> {
  const out = new Map<string, { storeName: string | null; country: string | null }>();
  for (let i = 0; i < slugs.length; i += 200) {
    const chunk = slugs.slice(i, i + 200);
    let from = 0;
    for (;;) {
      const { data, error } = await supabase
        .from('store_assessments')
        .select('store_slug, store_name, store_country, scanned_at')
        .in('store_slug', chunk)
        .order('scanned_at', { ascending: false })
        .range(from, from + 999);
      if (error) throw new Error(`store_assessments read failed: ${error.message}`);
      for (const r of data ?? []) {
        if (!out.has(r.store_slug as string)) {
          out.set(r.store_slug as string, { storeName: (r.store_name as string) ?? null, country: (r.store_country as string) ?? null });
        }
      }
      const allFound = chunk.every((s) => out.has(s));
      if (allFound || !data || data.length < 1000) break;
      from += 1000;
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Persist
// ---------------------------------------------------------------------------

function anchorHitsJson(nom: StoreNomination) {
  return nom.hits.map((h) => ({
    itemType: h.anchor.itemType,
    itemNo: h.anchor.itemNo,
    colourId: h.anchor.colourId,
    itemName: h.anchor.itemName,
    condition: h.anchor.condition,
    invId: h.invId,
    ask: h.ask,
    qty: h.qty,
    listPrice: h.anchor.listPrice,
    maxViableAsk: h.anchor.maxViableAsk,
    strLots: h.anchor.strLots,
    strQty: h.anchor.strQty,
    soldQty: h.anchor.soldQty,
    unitsBuyable: h.anchor.unitsBuyable,
    netPerUnit: h.netPerUnit,
  }));
}

async function persistCandidate(nom: StoreNomination, basket: StoreBasket, reportMd: string): Promise<void> {
  const s = basket.report.summary;
  const { error } = await supabase.from('part_arb_candidates').insert({
    user_id: USER_ID,
    store_slug: basket.slug,
    store_name: basket.storeName,
    anchor_count: nom.hits.length,
    anchors: anchorHitsJson(nom),
    basket_lots: s.lots,
    basket_outlay_gbp: s.outlay,
    basket_raw_net_gbp: s.rawNet,
    basket_capped_net_gbp: s.cappedNet,
    basket_liquid_net_gbp: s.liquidNet,
    inbound_postage_gbp: s.inboundPostage,
    scanned_at: basket.scannedAt,
    inputs: { ...INPUTS, minLiquidNet: MIN_LIQUID_NET, cacheTtlDays: CACHE_TTL_DAYS },
    report_md: reportMd,
  });
  if (error) console.error(`[persist] ${basket.slug} failed (non-fatal): ${error.message}`);
}

// ---------------------------------------------------------------------------
// Discover mode
// ---------------------------------------------------------------------------

async function discover(): Promise<void> {
  if (!NO_FLATTEN) await refreshFlattenedLots(false);

  const anchors = await screenAnchors();
  if (anchors.length === 0) {
    log('No anchors found — loosen --min-str-lots / --min-sold-qty.');
    return;
  }

  const storeLots = await fetchAnchorStoreLots(anchors);
  const nominations = nominateStores(anchors, storeLots, INPUTS);
  log(`[nominate] ${nominations.length} store(s) hold anchor units below the viable ceiling`);
  if (nominations.length === 0) return;

  // Score more than we keep — anchor net is only the nomination signal; the real
  // ranking is the common report's LIQUID net.
  const toScore = nominations.slice(0, Math.max(MAX_STORES * 3, 15));
  const metaBySlug = await loadStoreMeta(toScore.map((n) => n.storeSlug));
  const baskets: Array<{ nom: StoreNomination; basket: StoreBasket }> = [];
  for (const nom of toScore) {
    const cached = await loadCachedScrape(nom.storeSlug);
    if (!cached) continue;
    const meta = metaBySlug.get(nom.storeSlug) ?? { storeName: null, country: null };
    const basket = await scoreStore(nom.storeSlug, cached.lots, { ...meta, scannedAt: cached.scannedAt, truncated: cached.truncated });
    baskets.push({ nom, basket });
    log(`[score] ${nom.storeSlug}: ${nom.hits.length} anchor(s), liquid net £${basket.report.summary.liquidNet.toFixed(2)} ` +
      `(capped £${basket.report.summary.cappedNet.toFixed(2)}, ${basket.report.summary.lots} lots)`);
  }

  const kept = baskets
    .filter((b) => b.basket.report.summary.liquidNet >= MIN_LIQUID_NET)
    .sort((a, b) => b.basket.report.summary.liquidNet - a.basket.report.summary.liquidNet)
    .slice(0, MAX_STORES);

  // League table — every figure lifted straight from the common DecisionSummary.
  log('\n=== PART-FIRST ARBITRAGE — nominated stores (headline = LIQUID net: STR>=' +
    `${LIQUID_STR_GATE}, demand-capped, full standalone postage £${INPUTS.shipping.toFixed(2)}) ===`);
  if (kept.length === 0) {
    const best = baskets.reduce<StoreBasket | null>(
      (b, cur) => (b == null || cur.basket.report.summary.liquidNet > b.report.summary.liquidNet ? cur.basket : b),
      null,
    );
    log(`No store cleared --min-liquid-net £${MIN_LIQUID_NET.toFixed(2)}. ` +
      `Best was ${best ? `${best.slug} at £${best.report.summary.liquidNet.toFixed(2)}` : 'n/a'}.`);
    return;
  }
  for (let i = 0; i < kept.length; i++) {
    const { nom, basket } = kept[i];
    const s = basket.report.summary;
    const ageDays = basket.scannedAt ? Math.round((Date.now() - new Date(basket.scannedAt).getTime()) / 86400000) : null;
    log(
      `${String(i + 1).padStart(2)}. ${basket.slug.padEnd(24)} anchors ${String(nom.hits.length).padStart(3)}  ` +
      `LIQUID £${s.liquidNet.toFixed(2).padStart(8)}  capped £${s.cappedNet.toFixed(2).padStart(8)}  ` +
      `raw £${s.rawNet.toFixed(2).padStart(8)}  outlay £${s.outlay.toFixed(2).padStart(8)}  ` +
      `lots ${String(s.lots).padStart(4)}  scan ${ageDays != null ? `${ageDays}d` : '?'}${basket.truncated ? ' ⚠trunc' : ''}`
    );
  }

  fs.mkdirSync(OUT_DIR, { recursive: true });
  for (const { nom, basket } of kept) {
    const md = renderDecisionMd(basket.report);
    const anchorLines = nom.hits.slice(0, 30).map((h) =>
      `- ${h.anchor.itemType} ${h.anchor.itemNo} c${h.anchor.colourId} ${h.anchor.condition} ` +
      `ask £${h.ask.toFixed(2)} x${h.qty} vs list £${h.anchor.listPrice.toFixed(2)} ` +
      `(ceiling £${h.anchor.maxViableAsk.toFixed(2)}, STRlots ${h.anchor.strLots.toFixed(2)}, sold6mo ${h.anchor.soldQty})`);
    const full = `# ${basket.slug} — part-first nomination (${RUN_DATE})\n\n` +
      `Nominated by ${nom.hits.length} anchor hit(s):\n\n${anchorLines.join('\n')}\n` +
      (nom.hits.length > 30 ? `\n…and ${nom.hits.length - 30} more\n` : '') + `\n---\n\n${md}`;
    const file = path.join(OUT_DIR, `${basket.slug}.md`);
    fs.writeFileSync(file, full);
    if (!NO_PERSIST) await persistCandidate(nom, basket, full);
  }
  log(`\nReports written to ${OUT_DIR}${NO_PERSIST ? '' : ' and persisted to part_arb_candidates'}.`);
  log(`Next: ground a store before buying —`);
  log(`  npx tsx scripts/part-arb.ts --ground --store-slug=${kept[0].basket.slug} --xml-only   (wanted-list XML)`);
  log(`  npx tsx scripts/part-arb.ts --ground --store-slug=${kept[0].basket.slug} --cart       (bl-basket cart build)`);
}

// ---------------------------------------------------------------------------
// Ground mode — live re-scrape, re-score, then XML or bl-basket handoff
// ---------------------------------------------------------------------------

async function ground(slug: string): Promise<void> {
  log(`[ground] live re-scrape of ${slug} (CDP :${CDP_PORT})...`);
  const cdp = await connectCdp(CDP_PORT, slug);
  let lots: StoreLot[];
  let truncated: boolean;
  let meta: { storeId: number; storeName: string; country: string; isUK: boolean };
  try {
    meta = await preflight(cdp, slug);
    if (!meta.isUK) log(`[ground] ⚠ store country is "${meta.country}" — not UK; postage/customs assumptions may not hold`);
    const res = await scrapeStoreInventory(cdp, meta.storeId, {
      maxPages: MAX_PAGES, pageDelayMs: PAGE_DELAY_MS, onProgress: log,
    });
    lots = res.lots;
    truncated = res.truncated;
  } finally {
    cdp.close();
  }
  const scannedAt = new Date().toISOString();
  log(`[ground] scraped ${lots.length} lots${truncated ? ' (⚠ truncated)' : ''}`);

  // Persist the fresh scrape (same write path as the nightly sweep) + re-flatten,
  // and drop a bl-basket-compatible inventory.json so --cart never re-scrapes.
  const { error: upErr } = await supabase.from('bl_store_scrapes').upsert({
    store_slug: slug, user_id: USER_ID, store_id: meta.storeId,
    scanned_at: scannedAt, lot_count: lots.length, truncated, lots,
  }, { onConflict: 'store_slug' });
  if (upErr) console.error(`[ground] bl_store_scrapes upsert failed (non-fatal): ${upErr.message}`);
  const { error: flatErr } = await supabase.rpc('refresh_bl_store_lots', { p_slug: slug });
  if (flatErr) console.error(`[ground] flatten refresh failed (non-fatal): ${flatErr.message}`);
  const invDir = path.resolve(__dirname, `../../../tmp/stores/${slug}`);
  fs.mkdirSync(invDir, { recursive: true });
  fs.writeFileSync(path.join(invDir, 'inventory.json'), JSON.stringify(lots, null, 2));

  const basket = await scoreStore(slug, lots, {
    storeName: meta.storeName, country: meta.country, scannedAt, truncated,
  });
  console.log('\n' + renderDecisionCli(basket.report));

  fs.mkdirSync(OUT_DIR, { recursive: true });
  const mdFile = path.join(OUT_DIR, `${slug}-grounded.md`);
  fs.writeFileSync(mdFile, renderDecisionMd(basket.report));
  log(`[ground] grounded report -> ${mdFile}`);

  // Advance the latest candidate row for this store, if one exists.
  if (!NO_PERSIST) {
    const { data: cand } = await supabase
      .from('part_arb_candidates')
      .select('id')
      .eq('store_slug', slug)
      .order('run_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (cand) {
      // Only advance candidate -> grounded; never regress a bought/dismissed row.
      const { error } = await supabase.from('part_arb_candidates')
        .update({ status: 'grounded' })
        .eq('id', cand.id)
        .eq('status', 'candidate');
      if (error) console.error(`[ground] candidate status update failed (non-fatal): ${error.message}`);
    }
  }

  if (XML_ONLY) {
    const wantedLots = wantedLotsFromScored(basket.items, WANTED_MIN_STR);
    if (wantedLots.length === 0) {
      log(`[xml] no lots passed at STR >= ${WANTED_MIN_STR} — nothing to upload`);
      return;
    }
    const result = generateWantedXml(wantedLots);
    const xmlFile = path.join(OUT_DIR, `${slug}-wanted.xml`);
    fs.writeFileSync(xmlFile, result.xml);
    log(`[xml] ${result.entries} entries (${wantedLots.length} lots, STR >= ${WANTED_MIN_STR}` +
      `${result.mergedTuples ? `, ${result.mergedTuples} merged tuple(s)` : ''}` +
      `${result.skipped.length ? `, skipped un-uploadable: ${result.skipped.join(', ')}` : ''})`);
    log(`[xml] wanted-list XML -> ${xmlFile}`);
    log('[xml] upload at https://www.bricklink.com/v2/wanted/upload.page then buy from the store via the wanted list.');
    return;
  }

  if (CART) {
    log(`[cart] handing off to bl-basket (fresh inventory.json will be reused — no re-scrape)...`);
    const res = spawnSync(
      process.platform === 'win32' ? 'npx.cmd' : 'npx',
      // Forward the CDP port: part-arb grounds on :9222 while bl-basket defaults to
      // :9225 — without this the cart build would target a different Chrome.
      ['tsx', 'scripts/bl-basket.ts', `--store-slug=${slug}`, `--shipping=${INPUTS.shipping}`,
        `--min-margin=${INPUTS.minMargin}`, `--min-str=${INPUTS.minStr}`,
        `--min-ask=${INPUTS.minAsk}`, `--cdp-port=${CDP_PORT}`],
      { cwd: path.resolve(__dirname, '..'), stdio: 'inherit', shell: process.platform === 'win32' },
    );
    if (res.status !== 0) log(`[cart] bl-basket exited with status ${res.status}`);
    return;
  }

  log('\nGrounded. Re-run with --xml-only (wanted-list XML) or --cart (bl-basket cart build) to buy.');
}

// ---------------------------------------------------------------------------
// Entry
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  if (BACKFILL) {
    await refreshFlattenedLots(true);
    return;
  }
  if (GROUND) {
    if (!STORE_SLUG) {
      console.error('--ground requires --store-slug=<slug>');
      process.exit(1);
    }
    // Slug feeds file paths and a shell-spawned handoff — keep it to BL-legal chars.
    if (!/^[A-Za-z0-9._-]+$/.test(STORE_SLUG)) {
      console.error(`--store-slug "${STORE_SLUG}" contains characters outside [A-Za-z0-9._-]`);
      process.exit(1);
    }
    if (XML_ONLY && CART) {
      console.error('--xml-only and --cart are mutually exclusive');
      process.exit(1);
    }
    await ground(STORE_SLUG);
    return;
  }
  await discover();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
