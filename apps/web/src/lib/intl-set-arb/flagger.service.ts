/**
 * Intl set-arb candidate flagger (F3, done-criteria.md).
 *
 * Joins Tier-1 stock_offers (unified price cache) × bl_catalog_items weights ×
 * bl_import_zone_costs × sell-channel valuers (Amazon now; eBay slots in via
 * ChannelValuer) and persists bl_set_arb_candidates.
 *
 * Rules:
 *  - NEW condition offers only (Amazon sell side is new-sets).
 *  - Intl offers must ship to us (`ships`), UK offers kept as the domestic
 *    comparator (uk_cheapest_gbp) — never as intl candidates.
 *  - Landed unit cost needs weight: sets without catalogue weight are flagged,
 *    not silently priced.
 *  - Consignment floor: intl only viable in the >£135 border regime; candidate
 *    kept only when its seller-consignment could plausibly clear it (any single
 *    unit ≥ £135/4 — the builder verifies for real baskets); below → flag.
 *  - ASIN trust: identity below ASIN_TRUST_MIN is quoted null (no sell side).
 *  - Excluded/bought statuses are preserved across refreshes; stale actives
 *    for sets no longer flagged are marked 'stale'.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  landedUnitGbp, zoneForCountry, makeAmazonValuer,
  type ChannelValuer, type ZoneCosts,
} from './landed-cost';

const ASIN_TRUST_MIN = 95; // sets-intel provenance rule (2026-07-13)
const CONSIGNMENT_FLOOR_GBP = 135;
const MIN_NET_MARGIN_GBP = 5; // don't flag noise

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
  const amazonByAsin = new Map<string, { buyBox: number | null; drops90: number | null; date: string }>();
  const sinceSnap = new Date(Date.now() - 7 * 864e5).toISOString().slice(0, 10);
  for (let i = 0; i < asins.length; i += 200) {
    const { data, error } = await supabase.from('amazon_arbitrage_pricing')
      .select('asin,buy_box_price,sales_rank_drops_90d,snapshot_date')
      .in('asin', asins.slice(i, i + 200)).gte('snapshot_date', sinceSnap);
    if (error) throw new Error(error.message);
    for (const r of (data ?? []) as { asin: string; buy_box_price: number | null; sales_rank_drops_90d: number | null; snapshot_date: string }[]) {
      const prev = amazonByAsin.get(r.asin);
      if (!prev || r.snapshot_date > prev.date) {
        amazonByAsin.set(r.asin, { buyBox: r.buy_box_price == null ? null : Number(r.buy_box_price), drops90: r.sales_rank_drops_90d, date: r.snapshot_date });
      }
    }
  }
  const amazonBySet = new Map<string, { asin: string; buyBox: number | null; drops90: number | null; asinConfidence: number | null }>();
  for (const [setNorm, id] of identity) {
    const a = amazonByAsin.get(id.asin);
    amazonBySet.set(setNorm, { asin: id.asin, buyBox: a?.buyBox ?? null, drops90: a?.drops90 ?? null, asinConfidence: id.conf });
  }
  const valuers: ChannelValuer[] = [makeAmazonValuer(amazonBySet)];

  // 2. compute
  let skippedNoWeight = 0, skippedNoSellSide = 0;
  const rows: Record<string, unknown>[] = [];
  for (const o of offers) {
    const setNorm = norm(o.item_no);
    const weightG = weights.get(setNorm) ?? null;
    const news = (o.stock_offers?.new ?? []).filter((x) => x.price > 0);
    if (news.length === 0) continue;
    const ukCheapest = news.filter((x) => !x.intl).reduce<number | null>((m, x) => (m == null || x.price < m ? x.price : m), null);
    const intlShips = news.filter((x) => x.intl && x.ships);
    if (intlShips.length === 0) continue;

    for (const valuer of valuers) {
      const quote = valuer.quote(setNorm);
      if (!quote) { skippedNoSellSide++; continue; }
      for (const off of intlShips) {
        const zone = zoneForCountry(off.cc, zones);
        if (zone.zone === 'UK') continue;
        if (weightG == null) { skippedNoWeight++; continue; }
        const landed = landedUnitGbp(zone, off.price, weightG);
        if (!landed) continue;
        const netMargin = +(quote.sellNetGbp - landed.landedGbp).toFixed(2);
        if (netMargin < MIN_NET_MARGIN_GBP) continue;
        const flags: Record<string, boolean> = {};
        if (zone.calibrated_at == null) flags.uncalibrated = true;
        if (off.price < CONSIGNMENT_FLOOR_GBP / 4) flags.below_consignment_floor = true;
        rows.push({
          item_no: o.item_no,
          condition: 'N',
          sell_channel: valuer.channel,
          source_zone: zone.zone,
          source_country: off.cc ?? null,
          source_store_id: off.storeId,
          source_store_name: off.storeName,
          buy_price_gbp: off.price,
          buy_qty: off.qty,
          weight_g: weightG,
          landed_unit_gbp: landed.landedGbp,
          sell_price_gbp: quote.sellPriceGbp,
          sell_net_gbp: quote.sellNetGbp,
          net_margin_gbp: netMargin,
          net_margin_pct: +(netMargin / landed.landedGbp).toFixed(4),
          velocity_drops90: quote.velocityDrops90,
          amazon_asin: (quote.meta.asin as string) ?? null,
          uk_cheapest_gbp: ukCheapest,
          flags,
          status: 'active',
          computed_at: new Date().toISOString(),
        });
      }
    }
  }

  // 3. persist — preserve excluded/bought rows verbatim (a re-flagged excluded
  // candidate must NOT resurrect as active), refresh actives, stale the rest.
  const { data: manual, error: mErr } = await supabase.from('bl_set_arb_candidates')
    .select('item_no,condition,sell_channel,source_store_id').in('status', ['excluded', 'bought']);
  if (mErr) throw new Error(mErr.message);
  const manualKeys = new Set(
    ((manual ?? []) as { item_no: string; condition: string; sell_channel: string; source_store_id: number }[])
      .map((m) => `${m.item_no}|${m.condition}|${m.sell_channel}|${m.source_store_id}`),
  );
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
  };
}
