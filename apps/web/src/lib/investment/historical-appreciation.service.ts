/**
 * Historical Appreciation Service
 *
 * Calculates actual 1-year and 3-year appreciation for retired LEGO sets
 * by comparing RRP to post-retirement Amazon buy box prices from price_snapshots.
 *
 * Populates the investment_historical table with results.
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

export class HistoricalAppreciationService {
  private supabase: SupabaseClient;

  constructor(supabase: SupabaseClient) {
    this.supabase = supabase;
  }

  /**
   * Calculate and store historical appreciation for all retired sets.
   */
  async calculateAll(): Promise<HistoricalAppreciationResult> {
    const startTime = Date.now();
    let calculated = 0;
    let insufficientData = 0;
    let errors = 0;

    // Fetch all retired sets
    const retiredSets = await this.fetchRetiredSets();

    for (const set of retiredSets) {
      try {
        const success = await this.calculateForSet(set);
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
   * Calculate appreciation for a single retired set.
   * Returns true if calculated successfully, false if insufficient data.
   */
  private async calculateForSet(set: RetiredSet): Promise<boolean> {
    const rrp = set.uk_retail_price;
    const retiredDate = set.expected_retirement_date;

    if (!rrp || rrp <= 0) {
      await this.upsertHistorical(set.set_number, {
        retired_date: retiredDate,
        rrp_gbp: rrp,
        data_quality: 'insufficient',
        had_amazon_listing: set.has_amazon_listing ?? false,
      });
      return false;
    }

    // Get price snapshots around retirement and post-retirement dates
    const priceAtRetirement = retiredDate
      ? await this.findPriceNearDate(set.set_number, retiredDate)
      : null;

    const oneYearPost = retiredDate
      ? await this.findPriceNearDate(set.set_number, this.addYears(retiredDate, 1))
      : null;

    const threeYearPost = retiredDate
      ? await this.findPriceNearDate(set.set_number, this.addYears(retiredDate, 3))
      : null;

    // Get average sales rank post-retirement
    const avgSalesRank = retiredDate
      ? await this.getAvgSalesRankPost(set.set_number, retiredDate)
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

    return dataQuality !== 'insufficient';
  }

  /**
   * Find the closest price snapshot to a target date for a set.
   * Looks within a 30-day window around the target date.
   */
  private async findPriceNearDate(
    setNum: string,
    targetDate: string
  ): Promise<number | null> {
    const windowDays = 30;
    const target = new Date(targetDate);
    const from = new Date(target);
    from.setDate(from.getDate() - windowDays);
    const to = new Date(target);
    to.setDate(to.getDate() + windowDays);

    const fromStr = from.toISOString().split('T')[0];
    const toStr = to.toISOString().split('T')[0];

    const { data, error } = await this.supabase
      .from('price_snapshots')
      .select('date, price_gbp')
      .eq('set_num', setNum)
      .in('source', ['keepa_amazon_buybox', 'amazon_buybox'])
      .gte('date', fromStr)
      .lte('date', toStr)
      .not('price_gbp', 'is', null)
      .order('date', { ascending: true });

    if (error || !data || data.length === 0) {
      return null;
    }

    // Find the snapshot closest to the target date
    let closest = data[0];
    let minDiff = Math.abs(new Date(data[0].date).getTime() - target.getTime());

    for (const row of data) {
      const diff = Math.abs(new Date(row.date).getTime() - target.getTime());
      if (diff < minDiff) {
        minDiff = diff;
        closest = row;
      }
    }

    return closest.price_gbp as number;
  }

  /**
   * Get average sales rank for a set after retirement.
   */
  private async getAvgSalesRankPost(
    setNum: string,
    retiredDate: string
  ): Promise<number | null> {
    const { data, error } = await this.supabase
      .from('price_snapshots')
      .select('sales_rank')
      .eq('set_num', setNum)
      .in('source', ['keepa_amazon_buybox', 'amazon_buybox'])
      .gte('date', retiredDate)
      .not('sales_rank', 'is', null);

    if (error || !data || data.length === 0) {
      return null;
    }

    const ranks = data.map((r) => r.sales_rank as number).filter((r) => r > 0);
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
