/**
 * Historical Appreciation Service
 *
 * Calculates actual 1-year and 3-year appreciation for retired LEGO sets
 * by comparing RRP to post-retirement Amazon buy box prices from price_snapshots.
 *
 * Populates the investment_historical table with results.
 *
 * Label computation (median_window_v2):
 * - A window price is the MEDIAN of valid snapshots in the window, never a
 *   single closest point — one bad snapshot cannot become the label.
 * - Snapshots are junk-filtered against RRP (0.05x–15x band) before use.
 * - A window needs at least MIN_CORROBORATING_SNAPSHOTS valid points or its
 *   label is null.
 * - retired_date_estimated is set when the retirement date fell back to
 *   expected_retirement_date (frequently a Dec-31 placeholder) instead of a
 *   real Brickset exit_date.
 *
 * Uses batch-fetching to avoid N+1 query patterns - all price snapshots for
 * retired sets are loaded upfront and processed in memory.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { fetchAllRecords } from '@/lib/supabase/pagination';

export interface HistoricalAppreciationResult {
  total_retired_sets: number;
  calculated: number;
  insufficient_data: number;
  errors: number;
  duration_ms: number;
}

interface RetiredSet {
  set_number: string;
  uk_retail_price: number | null;
  retired_date: string | null; // COALESCE(exit_date, expected_retirement_date)
  retired_date_estimated: boolean; // true when exit_date was missing
  has_amazon_listing: boolean | null;
}

export interface PriceSnapshot {
  set_num: string;
  date: string;
  price_gbp: number | null;
  sales_rank: number | null;
}

export interface WindowPrice {
  price: number | null;
  snapshots: number;
}

export const LABEL_METHOD = 'median_window_v2';

/** Minimum valid snapshots in a window before its median becomes a label. */
export const MIN_CORROBORATING_SNAPSHOTS = 3;

/** Junk filter: plausible price band relative to RRP. */
export const MAX_PRICE_RRP_MULTIPLE = 15;
export const MIN_PRICE_RRP_MULTIPLE = 0.05;

/** Window half-widths in days — wider further out, where prices drift slowly. */
const WINDOW_DAYS_AT_RETIREMENT = 30;
const WINDOW_DAYS_1YR = 45;
const WINDOW_DAYS_3YR = 60;

/**
 * Median price of valid snapshots within +/- windowDays of the target date.
 * Snapshots outside the plausible price band relative to RRP are junk and
 * excluded. Returns null price unless MIN_CORROBORATING_SNAPSHOTS valid
 * points corroborate the window.
 */
export function computeWindowMedianPrice(
  snapshots: PriceSnapshot[],
  targetDate: string,
  windowDays: number,
  rrp: number
): WindowPrice {
  const windowMs = windowDays * 24 * 60 * 60 * 1000;
  const targetTime = new Date(targetDate).getTime();
  const minPrice = rrp * MIN_PRICE_RRP_MULTIPLE;
  const maxPrice = rrp * MAX_PRICE_RRP_MULTIPLE;

  const prices: number[] = [];
  for (const s of snapshots) {
    if (s.price_gbp == null || s.price_gbp <= 0) continue;
    if (s.price_gbp < minPrice || s.price_gbp > maxPrice) continue;
    const diff = Math.abs(new Date(s.date).getTime() - targetTime);
    if (diff <= windowMs) prices.push(s.price_gbp);
  }

  if (prices.length < MIN_CORROBORATING_SNAPSHOTS) {
    return { price: null, snapshots: prices.length };
  }

  prices.sort((a, b) => a - b);
  const mid = Math.floor(prices.length / 2);
  const median = prices.length % 2 === 0 ? (prices[mid - 1] + prices[mid]) / 2 : prices[mid];

  return { price: Math.round(median * 100) / 100, snapshots: prices.length };
}

export class HistoricalAppreciationService {
  private supabase: SupabaseClient;

  constructor(supabase: SupabaseClient) {
    this.supabase = supabase;
  }

  /**
   * Calculate and store historical appreciation for all retired sets.
   * Batch-fetches all price snapshots to avoid N+1 queries.
   */
  async calculateAll(): Promise<HistoricalAppreciationResult> {
    const startTime = Date.now();
    let calculated = 0;
    let insufficientData = 0;
    let errors = 0;

    // Fetch all retired sets
    const retiredSets = await this.fetchRetiredSets();

    if (retiredSets.length === 0) {
      return {
        total_retired_sets: 0,
        calculated: 0,
        insufficient_data: 0,
        errors: 0,
        duration_ms: Date.now() - startTime,
      };
    }

    // Batch-fetch all price snapshots for retired sets
    const setNums = retiredSets.map((s) => s.set_number);
    const snapshotsBySet = await this.batchFetchSnapshots(setNums);

    for (const set of retiredSets) {
      try {
        const snapshots = snapshotsBySet.get(set.set_number) ?? [];
        const success = await this.upsertResult(set, snapshots);
        if (success) {
          calculated++;
        } else {
          insufficientData++;
        }
      } catch (err) {
        console.error(
          `[HistoricalAppreciation] Error for ${set.set_number}:`,
          err instanceof Error ? err.message : err
        );
        errors++;
      }
    }

    console.log(
      `[HistoricalAppreciation] Complete: ${calculated} calculated, ${insufficientData} insufficient data, ${errors} errors`
    );

    return {
      total_retired_sets: retiredSets.length,
      calculated,
      insufficient_data: insufficientData,
      errors,
      duration_ms: Date.now() - startTime,
    };
  }

  /**
   * Fetch all retired sets from brickset_sets.
   */
  private async fetchRetiredSets(): Promise<RetiredSet[]> {
    const sets: RetiredSet[] = [];

    let rows: Record<string, unknown>[] = [];
    try {
      rows = (await fetchAllRecords(this.supabase, 'brickset_sets', {
        select:
          'set_number, uk_retail_price, exit_date, expected_retirement_date, has_amazon_listing',
        eq: { retirement_status: 'retired' },
      })) as unknown as Record<string, unknown>[];
    } catch (err) {
      console.error(
        '[HistoricalAppreciation] Error fetching retired sets:',
        err instanceof Error ? err.message : err
      );
      rows = [];
    }

    for (const record of rows) {
      // Prefer exit_date (backfilled from Brickset CSV + us_date_removed), fall back to expected_retirement_date
      const exitDate = record.exit_date as string | null;
      const retiredDate = exitDate ?? (record.expected_retirement_date as string | null);
      sets.push({
        set_number: record.set_number as string,
        uk_retail_price: record.uk_retail_price as number | null,
        retired_date: retiredDate,
        retired_date_estimated: exitDate == null,
        has_amazon_listing: record.has_amazon_listing as boolean | null,
      });
    }

    return sets;
  }

  /**
   * Batch-fetch all price snapshots for the given set numbers.
   * Returns a map of set_num -> sorted snapshots.
   */
  private async batchFetchSnapshots(setNums: string[]): Promise<Map<string, PriceSnapshot[]>> {
    const snapshotsBySet = new Map<string, PriceSnapshot[]>();

    // Fetch in chunks of set numbers to avoid query size limits
    for (let chunkStart = 0; chunkStart < setNums.length; chunkStart += 100) {
      const setNumChunk = setNums.slice(chunkStart, chunkStart + 100);

      let rows: Record<string, unknown>[] = [];
      try {
        rows = (await fetchAllRecords(this.supabase, 'price_snapshots', {
          select: 'set_num, date, price_gbp, sales_rank',
          in: { set_num: setNumChunk, source: ['keepa_amazon_buybox', 'amazon_buybox'] },
          orderBy: { column: 'date', ascending: true },
        })) as unknown as Record<string, unknown>[];
      } catch (err) {
        console.error(
          '[HistoricalAppreciation] Error fetching snapshots:',
          err instanceof Error ? err.message : err
        );
        continue;
      }

      for (const r of rows) {
        const setNum = r.set_num as string;
        const existing = snapshotsBySet.get(setNum) ?? [];
        existing.push({
          set_num: setNum,
          date: r.date as string,
          price_gbp: r.price_gbp as number | null,
          sales_rank: r.sales_rank as number | null,
        });
        snapshotsBySet.set(setNum, existing);
      }
    }

    return snapshotsBySet;
  }

  /**
   * Upsert the historical result for a set.
   * Returns true when at least one window produced a corroborated price.
   */
  private async upsertResult(set: RetiredSet, snapshots: PriceSnapshot[]): Promise<boolean> {
    const rrp = set.uk_retail_price;
    const retiredDate = set.retired_date;

    if (!rrp || rrp <= 0 || !retiredDate) {
      await this.upsertHistorical(set.set_number, {
        retired_date: retiredDate,
        retired_date_estimated: set.retired_date_estimated,
        rrp_gbp: rrp,
        price_at_retirement: null,
        price_1yr_post: null,
        price_3yr_post: null,
        actual_1yr_appreciation: null,
        actual_3yr_appreciation: null,
        snapshots_at_retirement: null,
        snapshots_1yr: null,
        snapshots_3yr: null,
        label_method: LABEL_METHOD,
        data_quality: 'insufficient',
        had_amazon_listing: set.has_amazon_listing ?? false,
      });
      return false;
    }

    const atRetirement = computeWindowMedianPrice(
      snapshots,
      retiredDate,
      WINDOW_DAYS_AT_RETIREMENT,
      rrp
    );
    const oneYearPost = computeWindowMedianPrice(
      snapshots,
      this.addYears(retiredDate, 1),
      WINDOW_DAYS_1YR,
      rrp
    );
    const threeYearPost = computeWindowMedianPrice(
      snapshots,
      this.addYears(retiredDate, 3),
      WINDOW_DAYS_3YR,
      rrp
    );

    const avgSalesRank = this.getAvgSalesRankPost(snapshots, retiredDate);

    // Calculate appreciation percentages
    const appreciation1yr =
      oneYearPost.price != null ? ((oneYearPost.price - rrp) / rrp) * 100 : null;

    const appreciation3yr =
      threeYearPost.price != null ? ((threeYearPost.price - rrp) / rrp) * 100 : null;

    // Determine data quality
    const hasAnyPrice =
      atRetirement.price != null || oneYearPost.price != null || threeYearPost.price != null;
    const dataQuality = !hasAnyPrice
      ? 'insufficient'
      : appreciation1yr != null && appreciation3yr != null
        ? 'good'
        : 'partial';

    await this.upsertHistorical(set.set_number, {
      retired_date: retiredDate,
      retired_date_estimated: set.retired_date_estimated,
      rrp_gbp: rrp,
      price_at_retirement: atRetirement.price,
      price_1yr_post: oneYearPost.price,
      price_3yr_post: threeYearPost.price,
      actual_1yr_appreciation:
        appreciation1yr != null ? Math.round(appreciation1yr * 100) / 100 : null,
      actual_3yr_appreciation:
        appreciation3yr != null ? Math.round(appreciation3yr * 100) / 100 : null,
      snapshots_at_retirement: atRetirement.snapshots,
      snapshots_1yr: oneYearPost.snapshots,
      snapshots_3yr: threeYearPost.snapshots,
      label_method: LABEL_METHOD,
      had_amazon_listing: set.has_amazon_listing ?? false,
      avg_sales_rank_post: avgSalesRank,
      data_quality: dataQuality,
    });

    return hasAnyPrice;
  }

  /**
   * Get average sales rank for a set after retirement from pre-fetched data.
   */
  private getAvgSalesRankPost(snapshots: PriceSnapshot[], retiredDate: string): number | null {
    const retiredTime = new Date(retiredDate).getTime();
    const ranks = snapshots
      .filter(
        (s) => new Date(s.date).getTime() >= retiredTime && s.sales_rank != null && s.sales_rank > 0
      )
      .map((s) => s.sales_rank!);

    if (ranks.length === 0) return null;
    return Math.round(ranks.reduce((sum, r) => sum + r, 0) / ranks.length);
  }

  /**
   * Upsert a row into investment_historical.
   */
  private async upsertHistorical(setNum: string, data: Record<string, unknown>): Promise<void> {
    const { error } = await this.supabase.from('investment_historical').upsert(
      {
        set_num: setNum,
        ...data,
        updated_at: new Date().toISOString(),
      } as unknown as Record<string, unknown>,
      { onConflict: 'set_num' }
    );

    if (error) {
      console.error(`[HistoricalAppreciation] Upsert error for ${setNum}:`, error.message);
      throw error;
    }
  }

  /**
   * Add years to a date string and return as ISO date.
   */
  private addYears(dateStr: string, years: number): string {
    const date = new Date(dateStr);
    date.setFullYear(date.getFullYear() + years);
    return date.toISOString().split('T')[0];
  }
}
