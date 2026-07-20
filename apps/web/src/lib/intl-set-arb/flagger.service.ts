/**
 * Intl set-arb candidate flagger (F3, done-criteria.md).
 *
 * Joins Tier-1 stock_offers (unified price cache) × bl_catalog_items weights ×
 * bl_import_zone_costs × sell-channel valuers (Amazon now; eBay slots in via
 * ChannelValuer) and persists bl_set_arb_candidates.
 *
 * Rules (decision contract ratified 2026-07-20):
 *  - NEW condition offers only (Amazon sell side is new-sets).
 *  - Intl offers must ship to us (`ships`), UK offers kept as the domestic
 *    comparator (uk_cheapest_gbp) — never as intl candidates.
 *  - Landed unit cost needs weight: sets without catalogue weight are flagged,
 *    not silently priced.
 *  - Consignment floor: intl only viable in the >£135 border regime; candidate
 *    kept only when its seller-consignment could plausibly clear it (any single
 *    unit ≥ £135/4 — the builder verifies for real baskets); below → flag.
 *  - ASIN trust: identity below ASIN_TRUST_MIN is quoted null (no sell side).
 *  - Margin: HOUSE convention — NET margin ÷ SALE (fees + £4 ship off first);
 *    flag floor = amber band (15%) on the CONSERVATIVE basis (worse of current
 *    buy box vs 90-day avg). Bands come from investment/max-buy.ts only.
 *  - Velocity/BSR are INFORMATION (displayed), never a gate.
 *  - Amazon snapshots: per-field latest-non-null fold over a 30-day window
 *    (a null drops90 on the newest snapshot must not erase older truth), and
 *    ASINs with live BL offers whose snapshot is older than 7 days are topped
 *    up via Keepa BEFORE flagging (capped per run) — candidates drive the
 *    refresh queue, not the other way round. Aged quotes are stamped with
 *    amazon_snapshot_date so the page can badge them instead of hiding rows.
 *  - Excluded/bought statuses are preserved across refreshes; stale actives
 *    for sets no longer flagged are marked 'stale'.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  landedUnitGbp, zoneForCountry, makeAmazonValuer, amazonNetGbp,
  type AmazonSetIntel, type ChannelValuer, type ZoneCosts,
} from './landed-cost';
import { MAX_BUY_AMBER_MARGIN } from '../investment/max-buy';
import { KeepaClient } from '../keepa/keepa-client';

const ASIN_TRUST_MIN = 95; // sets-intel provenance rule (2026-07-13)
const CONSIGNMENT_FLOOR_GBP = 135;
const SNAPSHOT_WINDOW_DAYS = 30;   // fold window — beyond this a quote is unusable
const SNAPSHOT_FRESH_DAYS = 7;     // older than this → Keepa top-up wanted
const KEEPA_TOPUP_MAX_ASINS = 400; // ~120 tokens/run at 3 per 10-ASIN batch

interface OfferRow {
  item_no: string;
  stock_offers: { new?: RawOffer[]; used?: RawOffer[] } | null;
  fetched_at: string;
}
interface RawOffer {
  cc?: string; qty: number; intl: boolean; price: number; ships: boolean;
  storeId: number; storeName: string;
}

function norm(setNo: string): string {
  return setNo.includes('-') ? setNo : `${setNo}-1`;
}

async function pageAll<T>(q: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await q(from, from + 999);
    if (error) throw new Error(error.message);
    out.push(...(data ?? []));
    if (!data || data.length < 1000) break;
  }
  return out;
}

export interface FlaggerResult {
  setsScanned: number;
  candidatesWritten: number;
  staleMarked: number;
  skippedNoWeight: number;
  skippedNoSellSide: number;
  skippedBelowAmber: number;
  keepaToppedUp: number;
}

/** Per-field latest-non-null fold of an ASIN's snapshots (date-ascending). */
interface FoldedSnapshot {
  buyBox: number | null;
  was90: number | null;
  drops90: number | null;
  salesRank: number | null;
  /** Date of the newest snapshot contributing the buy box (quote age). */
  snapshotDate: string | null;
}

export async function refreshCandidates(supabase: SupabaseClient, opts: { offersMaxAgeDays?: number } = {}): Promise<FlaggerResult> {
  const maxAge = opts.offersMaxAgeDays ?? 10;
  const sinceIso = new Date(Date.now() - maxAge * 864e5).toISOString();

  // 1. inputs
  const offers = await pageAll<OfferRow>((a, b) => supabase
    .from('bricklink_price_guide_cache')
    .select('item_no,stock_offers,fetched_at')
    .eq('item_type', 'S').not('stock_offers', 'is', null).gte('fetched_at', sinceIso)
    .order('id').range(a, b));

  const { data: zonesData, error: zErr } = await supabase.from('bl_import_zone_costs').select('*');
  if (zErr) throw new Error(zErr.message);
  const zones = (zonesData ?? []) as ZoneCosts[];

  const norms = [...new Set(offers.map((o) => norm(o.item_no)))];
  const weights = new Map<string, number | null>();
  for (let i = 0; i < norms.length; i += 300) {
    const batch = norms.slice(i, i + 300);
    const { data, error } = await supabase.from('bl_catalog_items')
      .select('item_no,weight_g').eq('item_type', 'S').in('item_no', batch);
    if (error) throw new Error(error.message);
    for (const r of (data ?? []) as { item_no: string; weight_g: number | null }[]) weights.set(r.item_no, r.weight_g);
  }

  // identity + Amazon pricing (sets-intel pattern)
  const identity = new Map<string, { asin: string; conf: number | null }>();
  for (let i = 0; i < norms.length; i += 300) {
    const { data, error } = await supabase.from('brickset_sets')
      .select('set_number,amazon_asin,asin_confidence').in('set_number', norms.slice(i, i + 300));
    if (error) throw new Error(error.message);
    for (const r of (data ?? []) as { set_number: string; amazon_asin: string | null; asin_confidence: number | null }[]) {
      if (r.amazon_asin && (r.asin_confidence ?? 0) >= ASIN_TRUST_MIN) identity.set(r.set_number, { asin: r.amazon_asin, conf: r.asin_confidence });
    }
  }
  const asins = [...new Set([...identity.values()].map((v) => v.asin))];

  const loadFolded = async (targets: string[]): Promise<Map<string, FoldedSnapshot>> => {
    const sinceSnap = new Date(Date.now() - SNAPSHOT_WINDOW_DAYS * 864e5).toISOString().slice(0, 10);
    const folded = new Map<string, FoldedSnapshot>();
    type SnapRow = { asin: string; buy_box_price: number | null; was_price_90d: number | null; sales_rank: number | null; sales_rank_drops_90d: number | null; snapshot_date: string };
    for (let i = 0; i < targets.length; i += 200) {
      const batch = targets.slice(i, i + 200);
      // Paginated (PostgREST 1,000-row cap): 200 ASINs × 30 days can exceed it,
      // and date-ascending truncation would silently keep only the OLDEST rows.
      const data = await pageAll<SnapRow>((a, b) => supabase.from('amazon_arbitrage_pricing')
        .select('asin,buy_box_price,was_price_90d,sales_rank,sales_rank_drops_90d,snapshot_date')
        .in('asin', batch).gte('snapshot_date', sinceSnap)
        .order('snapshot_date', { ascending: true }).order('asin').range(a, b));
      for (const r of data) {
        const f = folded.get(r.asin) ?? { buyBox: null, was90: null, drops90: null, salesRank: null, snapshotDate: null };
        if (r.buy_box_price != null) { f.buyBox = Number(r.buy_box_price); f.snapshotDate = r.snapshot_date; }
        if (r.was_price_90d != null) f.was90 = Number(r.was_price_90d);
        if (r.sales_rank != null) f.salesRank = r.sales_rank;
        if (r.sales_rank_drops_90d != null) f.drops90 = r.sales_rank_drops_90d;
        folded.set(r.asin, f);
      }
    }
    return folded;
  };

  let amazonByAsin = await loadFolded(asins);

  // Keepa top-up: candidates drive the refresh queue. Any ASIN a live BL offer
  // needs whose quote is missing or older than SNAPSHOT_FRESH_DAYS gets a fresh
  // snapshot now (capped) — a deal must never vanish for want of a Keepa row.
  let keepaToppedUp = 0;
  const freshCutoff = new Date(Date.now() - SNAPSHOT_FRESH_DAYS * 864e5).toISOString().slice(0, 10);
  const staleAsins = asins.filter((a) => {
    const f = amazonByAsin.get(a);
    return !f?.snapshotDate || f.snapshotDate < freshCutoff;
  }).slice(0, KEEPA_TOPUP_MAX_ASINS);
  if (staleAsins.length > 0) {
    try {
      const keepa = new KeepaClient();
      if (keepa.isConfigured()) {
        const { data: uidRow } = await supabase.from('amazon_arbitrage_pricing').select('user_id').limit(1).single();
        const userId = (uidRow as { user_id: string } | null)?.user_id;
        if (userId) {
          const today = new Date().toISOString().split('T')[0];
          for (let i = 0; i < staleAsins.length; i += 10) {
            const products = await keepa.fetchProducts(staleAsins.slice(i, i + 10));
            for (const p of products) {
              const cur = keepa.extractCurrentPricing(p);
              const { error } = await supabase.from('amazon_arbitrage_pricing').upsert({
                user_id: userId, asin: p.asin, snapshot_date: today,
                buy_box_price: cur.buyBoxPrice, offer_count: cur.offerCount,
                sales_rank: cur.salesRank, was_price_90d: cur.was90dAvg,
                sales_rank_drops_90d: cur.salesRankDrops90,
              }, { onConflict: 'asin,snapshot_date' });
              if (!error) keepaToppedUp++;
            }
          }
          if (keepaToppedUp > 0) amazonByAsin = await loadFolded(asins);
        }
      }
    } catch (e) {
      // Top-up is best-effort: flag from what we hold rather than fail the run.
      console.error('[flagger] Keepa top-up failed, continuing with cached snapshots:', e);
    }
  }

  const amazonBySet = new Map<string, AmazonSetIntel>();
  for (const [setNorm, id] of identity) {
    const a = amazonByAsin.get(id.asin);
    amazonBySet.set(setNorm, {
      asin: id.asin, buyBox: a?.buyBox ?? null, was90: a?.was90 ?? null,
      drops90: a?.drops90 ?? null, salesRank: a?.salesRank ?? null,
      snapshotDate: a?.snapshotDate ?? null, asinConfidence: id.conf,
    });
  }
  const valuers: ChannelValuer[] = [makeAmazonValuer(amazonBySet)];

  // 2. compute
  let skippedNoWeight = 0, skippedNoSellSide = 0, skippedBelowAmber = 0;
  const rows: Record<string, unknown>[] = [];
  for (const o of offers) {
    const setNorm = norm(o.item_no);
    const weightG = weights.get(setNorm) ?? null;
    const news = (o.stock_offers?.new ?? []).filter((x) => x.price > 0);
    if (news.length === 0) continue;
    const isUkOffer = (x: RawOffer) =>
      x.cc ? ['UK', 'GB'].includes(x.cc.toUpperCase()) : !x.intl;
    const ukCheapest = news.filter(isUkOffer).reduce<number | null>((m, x) => (m == null || x.price < m ? x.price : m), null);
    // Buy-side pool: international offers that ship to us, PLUS domestic UK offers
    // (Chris 2026-07-18: UK re-enters as a first-class source zone — postage-only
    // landed cost, no import legs; the old page's domestic view folds in here).
    const ukZone = zones.find((z) => z.zone === 'UK');
    const buyable = [
      ...news.filter((x) => x.intl && x.ships),
      ...news.filter((x) => !x.intl),
    ];
    if (buyable.length === 0) continue;

    for (const valuer of valuers) {
      const quote = valuer.quote(setNorm);
      if (!quote) { skippedNoSellSide++; continue; }
      for (const off of buyable) {
        // Country flag beats the tilde heuristic: an intl store listing natively in
        // GBP has no tilde (intl:false) but its cc is still foreign — route by cc
        // whenever we have one (validation catch 2026-07-18: FunToGet cc=TH,
        // intl:false — would otherwise be priced without import legs).
        const zone = off.cc
          ? zoneForCountry(off.cc, zones)
          : off.intl ? zoneForCountry(null, zones) : ukZone;
        if (!zone) continue;
        if (weightG == null) { skippedNoWeight++; continue; }
        const landed = landedUnitGbp(zone, off.price, weightG);
        if (!landed) continue;
        // HOUSE margin: NET (fees + ship already off in sellNet) ÷ SALE, graded
        // on the conservative of current buy box vs 90-day average.
        const netNow = +(quote.sellNetGbp - landed.landedGbp).toFixed(2);
        const pctNow = netNow / quote.sellPriceGbp;
        const pctWas = quote.was90Gbp != null
          ? (amazonNetGbp(quote.was90Gbp) - landed.landedGbp) / quote.was90Gbp
          : null;
        const pctConservative = pctWas == null ? pctNow : Math.min(pctNow, pctWas);
        if (pctConservative < MAX_BUY_AMBER_MARGIN) { skippedBelowAmber++; continue; }
        const flags: Record<string, boolean> = {};
        if (zone.calibrated_at == null) flags.uncalibrated = true;
        // £135 border floor is meaningless for domestic buys
        if (zone.zone !== 'UK' && off.price < CONSIGNMENT_FLOOR_GBP / 4) flags.below_consignment_floor = true;
        rows.push({
          item_no: o.item_no,
          condition: 'N',
          sell_channel: valuer.channel,
          source_zone: zone.zone,
          source_country: off.cc ?? (zone.zone === 'UK' ? 'UK' : null),
          source_store_id: off.storeId,
          source_store_name: off.storeName,
          buy_price_gbp: off.price,
          buy_qty: off.qty,
          weight_g: weightG,
          landed_unit_gbp: landed.landedGbp,
          sell_price_gbp: quote.sellPriceGbp,
          sell_net_gbp: quote.sellNetGbp,
          net_margin_gbp: netNow,
          net_margin_pct: +pctConservative.toFixed(4),
          velocity_drops90: quote.velocityDrops90,
          amazon_asin: (quote.meta.asin as string) ?? null,
          uk_cheapest_gbp: ukCheapest,
          was_price_90d: quote.was90Gbp,
          sales_rank: quote.salesRank,
          amazon_snapshot_date: quote.snapshotDate,
          flags,
          status: 'active',
          computed_at: new Date().toISOString(),
        });
      }
    }
  }

  // 3. persist — preserve excluded/bought rows verbatim (a re-flagged excluded
  // candidate must NOT resurrect as active), refresh actives, stale the rest.
  // Paginated (PostgREST 1,000-row cap): an overflowing unpaginated read here
  // would silently drop manual keys and resurrect excluded candidates.
  const manual = await pageAll<{ item_no: string; condition: string; sell_channel: string; source_store_id: number }>(
    (a, b) => supabase.from('bl_set_arb_candidates')
      .select('item_no,condition,sell_channel,source_store_id')
      .in('status', ['excluded', 'bought']).order('id').range(a, b),
  );
  const manualKeys = new Set(manual.map((m) => `${m.item_no}|${m.condition}|${m.sell_channel}|${m.source_store_id}`));
  // A store can hold several lots of one set inside the cheapest-10 — keep the
  // cheapest per conflict key or the upsert hits the same row twice.
  const byKey = new Map<string, Record<string, unknown>>();
  for (const r of rows) {
    const k = `${r.item_no}|${r.condition}|${r.sell_channel}|${r.source_store_id}`;
    const prev = byKey.get(k);
    if (!prev || (r.buy_price_gbp as number) < (prev.buy_price_gbp as number)) byKey.set(k, r);
  }
  const writable = [...byKey.values()].filter((r) => !manualKeys.has(`${r.item_no}|${r.condition}|${r.sell_channel}|${r.source_store_id}`));

  const { error: staleErr } = await supabase.from('bl_set_arb_candidates')
    .update({ status: 'stale' }).eq('status', 'active');
  if (staleErr) throw new Error(staleErr.message);
  for (let i = 0; i < writable.length; i += 500) {
    const { error } = await supabase.from('bl_set_arb_candidates')
      .upsert(writable.slice(i, i + 500), { onConflict: 'item_no,condition,sell_channel,source_store_id', ignoreDuplicates: false });
    if (error) throw new Error(`candidates upsert failed: ${error.message}`);
  }

  const { count: staleCount } = await supabase.from('bl_set_arb_candidates')
    .select('*', { count: 'exact', head: true }).eq('status', 'stale');

  return {
    setsScanned: offers.length,
    candidatesWritten: rows.length,
    staleMarked: staleCount ?? 0,
    skippedNoWeight,
    skippedNoSellSide,
    skippedBelowAmber,
    keepaToppedUp,
  };
}
