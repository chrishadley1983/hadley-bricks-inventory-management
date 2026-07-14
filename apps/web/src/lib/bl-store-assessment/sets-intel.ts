/**
 * External intel for the SETS decision section: Amazon buy box (via the trusted
 * brickset ASIN mapping), eBay NEW listing floor (context), and part-out value.
 *
 * Keyed by the RAW scraped itemNo (bare "60303" or suffixed "6538-2") — normalization
 * to the brickset `NNNNN-V` PK happens internally. Complete CMFs (col*) are NOT sets
 * commercially and are excluded by the caller.
 */

import type { SupabaseClient } from '@supabase/supabase-js';

export interface SetIntel {
  setNumber: string; // normalized NNNNN-V
  setName: string | null;
  asin: string | null;
  asinConfidence: number | null;
  amazonBuyBox: number | null;
  amazonSalesRank: number | null;
  ebayNewMin: number | null;
  ebayNewListings: number | null;
  /** Part-out value (6mo sold basis, GBP) per condition. */
  povSoldGbp: { N: number | null; U: number | null };
}

/** ASIN mappings below this confidence are ignored — comparing against a fuzzy-title
 * guess is worse than no comparison (identity-consolidation provenance, 2026-07-13). */
export const ASIN_TRUST_MIN = 95;

const norm = (itemNo: string): string => (itemNo.includes('-') ? itemNo : `${itemNo}-1`);

function chunk<T>(arr: T[], n: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
}

export async function readSetsIntel(
  supabase: SupabaseClient,
  rawItemNos: string[],
): Promise<Map<string, SetIntel>> {
  const out = new Map<string, SetIntel>();
  if (!rawItemNos.length) return out;
  const byNorm = new Map<string, string[]>(); // norm -> raw[]
  for (const raw of new Set(rawItemNos)) {
    const n = norm(raw);
    byNorm.set(n, [...(byNorm.get(n) ?? []), raw]);
  }
  const norms = [...byNorm.keys()];

  // 1. Identity master: name + trusted ASIN.
  const identity = new Map<string, { setName: string | null; asin: string | null; conf: number | null }>();
  for (const c of chunk(norms, 400)) {
    const { data, error } = await supabase
      .from('brickset_sets')
      .select('set_number,set_name,amazon_asin,asin_confidence')
      .in('set_number', c);
    if (error) throw new Error(`brickset read failed: ${error.message}`);
    for (const r of data ?? []) {
      identity.set(r.set_number as string, {
        setName: (r.set_name as string) ?? null,
        asin: (r.amazon_asin as string) ?? null,
        conf: (r.asin_confidence as number) ?? null,
      });
    }
  }

  // 2. Amazon buy box — latest snapshot per trusted ASIN (last 7 days).
  const trustedAsins = [...identity.values()]
    .filter((v) => v.asin && (v.conf ?? 0) >= ASIN_TRUST_MIN)
    .map((v) => v.asin as string);
  const amazon = new Map<string, { buyBox: number | null; rank: number | null; date: string }>();
  const since = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString().slice(0, 10);
  for (const c of chunk([...new Set(trustedAsins)], 200)) {
    const { data, error } = await supabase
      .from('amazon_arbitrage_pricing')
      .select('asin,buy_box_price,sales_rank,snapshot_date')
      .in('asin', c)
      .gte('snapshot_date', since);
    if (error) throw new Error(`amazon pricing read failed: ${error.message}`);
    for (const r of data ?? []) {
      const prev = amazon.get(r.asin as string);
      if (!prev || (r.snapshot_date as string) > prev.date) {
        amazon.set(r.asin as string, {
          buyBox: r.buy_box_price == null ? null : Number(r.buy_box_price),
          rank: (r.sales_rank as number) ?? null,
          date: r.snapshot_date as string,
        });
      }
    }
  }

  // 3. eBay NEW listing floor (context only — listing asks, not solds).
  const ebay = new Map<string, { min: number | null; listings: number | null; date: string }>();
  for (const c of chunk(norms, 400)) {
    const { data, error } = await supabase
      .from('ebay_pricing')
      .select('set_number,min_price,total_listings,snapshot_date')
      .in('set_number', c)
      .eq('condition', 'NEW')
      .gte('snapshot_date', since);
    if (error) throw new Error(`ebay pricing read failed: ${error.message}`);
    for (const r of data ?? []) {
      const key = r.set_number as string;
      const prev = ebay.get(key);
      if (!prev || (r.snapshot_date as string) > prev.date) {
        ebay.set(key, {
          min: r.min_price == null ? null : Number(r.min_price),
          listings: (r.total_listings as number) ?? null,
          date: r.snapshot_date as string,
        });
      }
    }
  }

  // 4. Part-out value — most recent row per set+condition (6mo sold basis).
  const pov = new Map<string, { N: number | null; U: number | null }>();
  const povFetched = new Map<string, { N: string; U: string }>();
  for (const c of chunk(norms, 400)) {
    const { data, error } = await supabase
      .from('bricklink_part_out_value_cache')
      .select('set_number,condition,sold_6mo_avg_gbp,fetched_at')
      .in('set_number', c);
    if (error) throw new Error(`pov read failed: ${error.message}`);
    for (const r of data ?? []) {
      const key = r.set_number as string;
      const cond = (r.condition as string)?.trim() === 'U' ? 'U' : 'N';
      const entry = pov.get(key) ?? { N: null, U: null };
      const stamps = povFetched.get(key) ?? { N: '', U: '' };
      if ((r.fetched_at as string) > stamps[cond]) {
        entry[cond] = r.sold_6mo_avg_gbp == null ? null : Number(r.sold_6mo_avg_gbp);
        stamps[cond] = r.fetched_at as string;
        pov.set(key, entry);
        povFetched.set(key, stamps);
      }
    }
  }

  // Assemble, fanning back out to every raw itemNo.
  for (const [n, raws] of byNorm) {
    const id = identity.get(n);
    const trusted = id?.asin && (id.conf ?? 0) >= ASIN_TRUST_MIN ? amazon.get(id.asin) : undefined;
    const eb = ebay.get(n);
    const pv = pov.get(n);
    const intel: SetIntel = {
      setNumber: n,
      setName: id?.setName ?? null,
      asin: id?.asin ?? null,
      asinConfidence: id?.conf ?? null,
      amazonBuyBox: trusted?.buyBox ?? null,
      amazonSalesRank: trusted?.rank ?? null,
      ebayNewMin: eb?.min ?? null,
      ebayNewListings: eb?.listings ?? null,
      povSoldGbp: { N: pv?.N ?? null, U: pv?.U ?? null },
    };
    for (const raw of raws) out.set(raw, intel);
  }
  return out;
}
