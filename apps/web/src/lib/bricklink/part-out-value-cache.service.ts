/**
 * Part Out Value cache service.
 *
 * Reads/writes the `bricklink_part_out_value_cache` table (keyed by set + full option-variant)
 * with staleness tracking, plus the single-row `bricklink_pov_config` defaults. Mirrors
 * PartPriceCacheService conventions (shared cache, direct Supabase client, idempotent upsert).
 *
 * UK retail (Brickset RRP) is read from the existing `brickset_sets` cache — no Brickset API
 * calls — and denormalised onto the row so the generated `partout_multiple` column computes.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type {
  BrickLinkPartOutValue,
  BrickLinkPartOutValueInsert,
  BrickLinkPovConfig,
} from '@hadley-bricks/database';
import {
  type PovOptions,
  type PovScrapeResult,
  toGbp,
  scrapePov,
  parseSetNumber,
  resolvePovOptions,
} from './part-out-value';

const DEFAULT_FRESHNESS_DAYS = 30;

function envFreshnessDays(): number {
  const v = process.env.POV_CACHE_FRESHNESS_DAYS;
  if (v) {
    const n = parseInt(v, 10);
    if (!isNaN(n) && n > 0) return n;
  }
  return DEFAULT_FRESHNESS_DAYS;
}

export function isFresh(fetchedAt: Date, freshnessDays: number): boolean {
  const ms = freshnessDays * 24 * 60 * 60 * 1000;
  return Date.now() - fetchedAt.getTime() < ms;
}

export interface CachedPov {
  row: BrickLinkPartOutValue;
  isFresh: boolean;
  ageMs: number;
}

/**
 * Build a cache insert row from a scrape result, applying USD→GBP conversion and retail.
 * The generated `partout_multiple` column is intentionally omitted.
 */
export function buildPovCacheRow(
  r: PovScrapeResult,
  extra: { usdToGbpRate?: number | null; ukRetailGbp?: number | null; retailSource?: string | null } = {},
): BrickLinkPartOutValueInsert {
  const o = r.options;
  const cur = r.nativeCurrency;
  const rate = cur === 'USD' ? extra.usdToGbpRate ?? null : null;
  const now = new Date().toISOString();
  return {
    set_number: o.setNumber,
    set_name: r.setName,
    item_seq: o.itemSeq,
    condition: o.condition,
    break_type: o.breakType,
    inc_instructions: o.incInstructions,
    inc_box: o.incBox,
    inc_extra: o.incExtra,
    inc_break: o.incBreak,
    native_currency: cur,
    sold_6mo_native: r.sold6mo?.amount ?? null,
    sold_6mo_items: r.sold6mo?.items ?? null,
    sold_6mo_lots: r.sold6mo?.lots ?? null,
    for_sale_native: r.forSale?.amount ?? null,
    for_sale_items: r.forSale?.items ?? null,
    for_sale_lots: r.forSale?.lots ?? null,
    my_inv_native: r.myInv?.amount ?? null,
    my_inv_items: r.myInv?.items ?? null,
    my_inv_lots: r.myInv?.lots ?? null,
    not_included_items: r.notIncluded?.items ?? null,
    not_included_lots: r.notIncluded?.lots ?? null,
    sold_6mo_avg_gbp: toGbp(r.sold6mo?.amount, cur, rate),
    for_sale_avg_gbp: toGbp(r.forSale?.amount, cur, rate),
    usd_to_gbp_rate: rate,
    uk_retail_gbp: extra.ukRetailGbp ?? null,
    retail_source: extra.retailSource ?? null,
    retail_fetched_at: extra.ukRetailGbp != null ? now : null,
    fetched_at: now,
    updated_at: now,
  };
}

export class PartOutValueCacheService {
  constructor(private supabase: SupabaseClient) {}

  /** Env-driven default freshness; callers may override per-lookup (e.g. config.freshness_days). */
  getFreshnessDays(): number {
    return envFreshnessDays();
  }

  async getConfig(): Promise<BrickLinkPovConfig | null> {
    const { data, error } = await this.supabase.from('bricklink_pov_config').select('*').eq('id', 1).maybeSingle();
    if (error) {
      console.error('[PartOutValueCacheService] getConfig error:', error);
      return null;
    }
    return data as BrickLinkPovConfig | null;
  }

  async updateConfig(patch: Partial<BrickLinkPovConfig>): Promise<BrickLinkPovConfig | null> {
    const { id: _ignore, ...rest } = patch;
    void _ignore;
    const { data, error } = await this.supabase
      .from('bricklink_pov_config')
      .update({ ...rest, updated_at: new Date().toISOString() })
      .eq('id', 1)
      .select('*')
      .maybeSingle();
    if (error) {
      console.error('[PartOutValueCacheService] updateConfig error:', error);
      return null;
    }
    return data as BrickLinkPovConfig | null;
  }

  /** Look up the cached row for an exact option-variant. */
  async getCached(opts: PovOptions, freshnessDaysOverride?: number): Promise<CachedPov | null> {
    const { data, error } = await this.supabase
      .from('bricklink_part_out_value_cache')
      .select('*')
      .eq('set_number', opts.setNumber)
      .eq('item_seq', opts.itemSeq)
      .eq('condition', opts.condition)
      .eq('break_type', opts.breakType)
      .eq('inc_instructions', opts.incInstructions)
      .eq('inc_box', opts.incBox)
      .eq('inc_extra', opts.incExtra)
      .eq('inc_break', opts.incBreak)
      .maybeSingle();

    if (error) {
      console.error('[PartOutValueCacheService] getCached error:', error);
      return null;
    }
    if (!data) return null;

    const row = data as BrickLinkPartOutValue;
    const fetchedAt = new Date(row.fetched_at);
    const freshnessDays = freshnessDaysOverride ?? this.getFreshnessDays();
    return { row, isFresh: isFresh(fetchedAt, freshnessDays), ageMs: Date.now() - fetchedAt.getTime() };
  }

  /** Idempotent upsert on the option-variant unique key. Returns the stored row. */
  async upsert(row: BrickLinkPartOutValueInsert): Promise<BrickLinkPartOutValue | null> {
    const { data, error } = await this.supabase
      .from('bricklink_part_out_value_cache')
      .upsert(row, {
        onConflict: 'set_number,item_seq,condition,break_type,inc_instructions,inc_box,inc_extra,inc_break',
        ignoreDuplicates: false,
      })
      .select('*')
      .maybeSingle();
    if (error) {
      console.error('[PartOutValueCacheService] upsert error:', error);
      return null;
    }
    return data as BrickLinkPartOutValue | null;
  }

  /**
   * Resolve UK retail (RRP) in GBP from the existing brickset_sets cache (no Brickset API call).
   * Tries the exact "<itemNo>-<seq>" key, then any variant of the itemNo.
   */
  async getUkRetailGbp(itemNo: string, itemSeq = 1): Promise<{ value: number; source: string } | null> {
    const exact = `${itemNo}-${itemSeq}`;
    type Row = { set_number: string; uk_retail_price: number | string | null };

    // Exact "<itemNo>-<seq>" first (set_number is the brickset_sets PK).
    const exactRes = await this.supabase
      .from('brickset_sets')
      .select('set_number, uk_retail_price')
      .eq('set_number', exact)
      .not('uk_retail_price', 'is', null)
      .maybeSingle();
    let chosen = (exactRes.data as Row | null) ?? null;

    // Fall back to any variant of the itemNo that has a price. Guard the LIKE term: only run when
    // itemNo is plain alphanumeric (no `%`/`_` metacharacters that could match unrelated rows), and
    // order deterministically so the chosen RRP is stable.
    if (!chosen && /^[A-Za-z0-9]+$/.test(itemNo)) {
      const likeRes = await this.supabase
        .from('brickset_sets')
        .select('set_number, uk_retail_price')
        .like('set_number', `${itemNo}-%`)
        .not('uk_retail_price', 'is', null)
        .order('set_number', { ascending: true })
        .limit(1);
      chosen = (likeRes.data?.[0] as Row | undefined) ?? null;
    }

    if (!chosen || chosen.uk_retail_price == null) return null;
    const value =
      typeof chosen.uk_retail_price === 'string' ? parseFloat(chosen.uk_retail_price) : chosen.uk_retail_price;
    if (!isFinite(value) || value <= 0) return null;
    return { value, source: 'brickset_sets' };
  }
}

/**
 * One-call POV lookup: cache-first, scrape if missing/stale, attach UK RRP, upsert, return the row.
 *
 * This is the shared reuse path for the pov-fetch CLI, the API route, the bl-part-out-value skill,
 * and the **Vinted scraper extension point** — when the Vinted sniper detects a set, it can call
 * `getPovForSet(supabase, setNumber)` to get the part-out multiple for buy/skip decisions.
 *
 * Scraping needs a reachable Chrome (CDP). Logged-in → GBP; loggedOut → USD (pass usdToGbpRate).
 * Throws the engine's typed errors (Login/Captcha/NotFound/EmptyResponse) on scrape failure.
 */
export async function getPovForSet(
  supabase: SupabaseClient,
  rawSet: string,
  opts: Partial<PovOptions> = {},
  runOpts: {
    force?: boolean;
    loggedOut?: boolean;
    cdpPort?: number;
    usdToGbpRate?: number | null;
    freshnessDays?: number;
  } = {},
): Promise<{ row: BrickLinkPartOutValue | null; fromCache: boolean; scraped: boolean }> {
  const service = new PartOutValueCacheService(supabase);
  const { itemNo, itemSeq } = parseSetNumber(rawSet);
  const resolved = resolvePovOptions({ setNumber: itemNo, itemSeq, ...opts });

  if (!runOpts.force) {
    const cached = await service.getCached(resolved, runOpts.freshnessDays);
    if (cached?.isFresh) return { row: cached.row, fromCache: true, scraped: false };
  }

  const result = await scrapePov(resolved, { loggedOut: runOpts.loggedOut, cdpPort: runOpts.cdpPort });
  const retail = await service.getUkRetailGbp(itemNo, itemSeq);
  const row = buildPovCacheRow(result, {
    usdToGbpRate: runOpts.usdToGbpRate ?? null,
    ukRetailGbp: retail?.value ?? null,
    retailSource: retail?.source ?? null,
  });
  const stored = await service.upsert(row);
  return { row: stored, fromCache: false, scraped: true };
}
