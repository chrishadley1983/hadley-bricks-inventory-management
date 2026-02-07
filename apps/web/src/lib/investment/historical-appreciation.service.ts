/**
 * Historical Appreciation Service
 *
 * Calculates actual 1-year and 3-year appreciation for retired LEGO sets
 * by comparing RRP to post-retirement Amazon buy box prices from price_snapshots.
 *
 * Populates the investment_historical table with results.
 *
 * Uses batch-fetching to avoid N+1 query patterns - all price snapshots for
 * retired sets are loaded upfront and processed in memory.
 */

import type { SupabaseClient } from '@supabase/supabase-js';

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
  expected_retirement_date: string | null;
  has_amazon_listing: boolean | null;
}

interface PriceSnapshot {
  set_num: string;
  date: string;
  price_gbp: number | null;
  sales_rank: number | null;
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
        const success = this.calculateForSet(set, snapshots);
        // Upsert result
        await this.upsertResult(set, snapshots);
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
    const pageSize = 1000;
    let page = 0;
    let hasMore = true;

    while (hasMore) {
      const { data, error } = await this.supabase
        .from('brickset_sets')
        .select('set_number, uk_retail_price, expected_retirement_date, has_amazon_listing')
        .eq('retirement_status' as string, 'retired')
        .range(page * pageSize, (page + 1) * pageSize - 1);

      if (error) {
        console.error('[HistoricalAppreciation] Error fetching retired sets:', error.message);
        break;
      }

      if (!data || data.length === 0) {
        hasMore = false;
        break;
      }

      for (const row of data) {
        const record = row as unknown as Record<string, unknown>;
        sets.push({
          set_number: record.set_number as string,
          uk_retail_price: record.uk_retail_price as number | null,
          expected_retirement_date: record.expected_retirement_date as string | null,
          has_amazon_listing: record.has_amazon_listing as boolean | null,
        });
      }

      hasMore = data.length === pageSize;
      page++;
    }

    return sets;
  }

  /**
   * Batch-fetch all price snapshots for the given set numbers.
   * Returns a map of set_num -> sorted snapshots.
   */
  private async batchFetchSnapshots(
    setNums: string[]
  ): Promise<Map<string, PriceSnapshot[]>> {
    const snapshotsBySet = new Map<string, PriceSnapshot[]>();
    const pageSize = 1000;

    // Fetch in chunks of set numbers to avoid query size limits
    for (let chunkStart = 0; chunkStart < setNums.length; chunkStart += 100) {
      const setNumChunk = setNums.slice(chunkStart, chunkStart + 100);
      let page = 0;
      let hasMore = true;

      while (hasMore) {
        const { data, error } = await this.supabase
          .from('price_snapshots')
          .select('set_num, date, price_gbp, sales_rank')
          .in('set_num', setNumChunk)
          .in('source', ['keepa_amazon_buybox', 'amazon_buybox'])
          .order('date', { ascending: true })
          .range(page * pageSize, (page + 1) * pageSize - 1);

        if (error) {
          console.error('[HistoricalAppreciation] Error fetching snapshots:', error.message);
          break;
        }

        if (!data || data.length === 0) {
          hasMore = false;
          break;
        }

        for (const row of data) {
          const r = row as Record<string, unknown>;
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

        hasMore = data.length === pageSize;
        page++;
      }
    }

    return snapshotsBySet;
  }

  /**
   * Calculate appreciation for a single retired set using pre-fetched snapshots.
   * Returns true if calculated successfully, false if insufficient data.
   */
  private calculateForSet(set: RetiredSet, snapshots: PriceSnapshot[]): boolean {
    const rrp = set.uk_retail_price;
    if (!rrp || rrp <= 0) return false;

    const retiredDate = set.expected_retirement_date;
    if (!retiredDate) return false;

    const priceAtRetirement = this.findPriceNearDate(snapshots, retiredDate);
    const oneYearPost = this.findPriceNearDate(snapshots, this.addYears(retiredDate, 1));
    const threeYearPost = this.findPriceNearDate(snapshots, this.addYears(retiredDate, 3));

    const hasAnyPrice = priceAtRetirement != null || oneYearPost != null || threeYearPost != null;
    return hasAnyPrice;
  }

  /**
   * Upsert the historical result for a set.
   */
  private async upsertResult(
    set: RetiredSet,
    snapshots: PriceSnapshot[]
  ): Promise<void> {
    const rrp = set.uk_retail_price;
    const retiredDate = set.expected_retirement_date;

    if (!rrp || rrp <= 0) {
      await this.upsertHistorical(set.set_number, {
        retired_date: retiredDate,
        rrp_gbp: rrp,
        data_quality: 'insufficient',
        had_amazon_listing: set.has_amazon_listing ?? false,
      });
      return;
    }

    const priceAtRetirement = retiredDate
      ? this.findPriceNearDate(snapshots, retiredDate)
      : null;

    const oneYearPost = retiredDate
      ? this.findPriceNearDate(snapshots, this.addYears(retiredDate, 1))
      : null;

    const threeYearPost = retiredDate
      ? this.findPriceNearDate(snapshots, this.addYears(retiredDate, 3))
      : null;

    const avgSalesRank = retiredDate
      ? this.getAvgSalesRankPost(snapshots, retiredDate)
      : null;

    // Calculate appreciation percentages
    const appreciation1yr = oneYearPost != null
      ? ((oneYearPost - rrp) / rrp) * 100
      : null;

    const appreciation3yr = threeYearPost != null
      ? ((threeYearPost - rrp) / rrp) * 100
      : null;

    // Determine data quality
    const hasAnyPrice = priceAtRetirement != null || oneYearPost != null || threeYearPost != null;
    const dataQuality = !hasAnyPrice
      ? 'insufficient'
      : (appreciation1yr != null && appreciation3yr != null)
        ? 'good'
        : 'partial';

    await this.upsertHistorical(set.set_number, {
      retired_date: retiredDate,
      rrp_gbp: rrp,
      price_at_retirement: priceAtRetirement,
      price_1yr_post: oneYearPost,
      price_3yr_post: threeYearPost,
      actual_1yr_appreciation: appreciation1yr != null ? Math.round(appreciation1yr * 100) / 100 : null,
      actual_3yr_appreciation: appreciation3yr != null ? Math.round(appreciation3yr * 100) / 100 : null,
      had_amazon_listing: set.has_amazon_listing ?? false,
      avg_sales_rank_post: avgSalesRank,
      data_quality: dataQuality,
    });
  }

  /**
   * Find the closest price snapshot to a target date from pre-fetched data.
   * Looks within a 30-day window around the target date.
   */
  private findPriceNearDate(
    snapshots: PriceSnapshot[],
    targetDate: string
  ): number | null {
    const windowMs = 30 * 24 * 60 * 60 * 1000; // 30 days
    const targetTime = new Date(targetDate).getTime();

    let closest: PriceSnapshot | null = null;
    let minDiff = Infinity;

    for (const s of snapshots) {
      if (s.price_gbp == null) continue;
      const diff = Math.abs(new Date(s.date).getTime() - targetTime);
      if (diff <= windowMs && diff < minDiff) {
        minDiff = diff;
        closest = s;
      }
    }

    return closest?.price_gbp ?? null;
  }

  /**
   * Get average sales rank for a set after retirement from pre-fetched data.
   */
  private getAvgSalesRankPost(
    snapshots: PriceSnapshot[],
    retiredDate: string
  ): number | null {
    const retiredTime = new Date(retiredDate).getTime();
    const ranks = snapshots
      .filter((s) => new Date(s.date).getTime() >= retiredTime && s.sales_rank != null && s.sales_rank > 0)
      .map((s) => s.sales_rank!);

    if (ranks.length === 0) return null;
    return Math.round(ranks.reduce((sum, r) => sum + r, 0) / ranks.length);
  }

  /**
   * Upsert a row into investment_historical.
   */
  private async upsertHistorical(
    setNum: string,
    data: Record<string, unknown>
  ): Promise<void> {
    const { error } = await this.supabase
      .from('investment_historical')
      .upsert(
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
