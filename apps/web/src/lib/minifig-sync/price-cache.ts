import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@hadley-bricks/database';
import type { MinifigPriceCache, ResearchResult } from './types';

export class PriceCacheService {
  constructor(private supabase: SupabaseClient<Database>) {}

  /**
   * Look up a valid (non-expired) cache entry for a BrickLink ID.
   * Returns null if no cache or cache is expired.
   */
  async lookup(bricklinkId: string): Promise<MinifigPriceCache | null> {
    const { data } = await this.supabase
      .from('minifig_price_cache')
      .select('*')
      .eq('bricklink_id', bricklinkId)
      .gt('expires_at', new Date().toISOString())
      .single();

    return data;
  }

  /**
   * Check if a valid cache entry exists (without returning full data).
   */
  async hasValidCache(bricklinkId: string): Promise<boolean> {
    const { data } = await this.supabase
      .from('minifig_price_cache')
      .select('id')
      .eq('bricklink_id', bricklinkId)
      .gt('expires_at', new Date().toISOString())
      .single();

    return !!data;
  }

  /**
   * Upsert a cache entry from research results.
   * Calculates expires_at as now + cacheMonths.
   */
  async upsert(
    bricklinkId: string,
    result: ResearchResult,
    cacheMonths: number,
  ): Promise<void> {
    const now = new Date();
    const expiresAt = new Date(now);
    expiresAt.setMonth(expiresAt.getMonth() + cacheMonths);

    const baseData = {
      bricklink_id: bricklinkId,
      researched_at: now.toISOString(),
      expires_at: expiresAt.toISOString(),
      source: result.source,
    };

    let upsertData: Record<string, unknown>;

    if (result.source === 'terapeak') {
      upsertData = {
        ...baseData,
        terapeak_avg_sold_price: result.avgSoldPrice,
        terapeak_min_sold_price: result.minSoldPrice,
        terapeak_max_sold_price: result.maxSoldPrice,
        terapeak_sold_count: result.soldCount,
        terapeak_active_count: result.activeCount,
        terapeak_sell_through_rate: result.sellThroughRate,
        terapeak_avg_shipping: result.avgShipping,
      };
    } else {
      // BrickLink fallback
      upsertData = {
        ...baseData,
        bricklink_avg_sold_price: result.avgSoldPrice,
        bricklink_sold_count: result.soldCount,
        // Populate terapeak fields from BrickLink data as best-effort
        terapeak_avg_sold_price: result.avgSoldPrice,
        terapeak_min_sold_price: result.minSoldPrice,
        terapeak_max_sold_price: result.maxSoldPrice,
        terapeak_sold_count: result.soldCount,
      };
    }

    const { error } = await this.supabase
      .from('minifig_price_cache')
      .upsert(upsertData as Database['public']['Tables']['minifig_price_cache']['Insert'], {
        onConflict: 'bricklink_id',
      });

    if (error) {
      throw new Error(`Failed to upsert price cache for ${bricklinkId}: ${error.message}`);
    }
  }

  /**
   * Get all expired cache entries (for refresh cron).
   */
  async getExpired(limit = 50): Promise<MinifigPriceCache[]> {
    const { data } = await this.supabase
      .from('minifig_price_cache')
      .select('*')
      .lt('expires_at', new Date().toISOString())
      .order('expires_at', { ascending: true })
      .limit(limit);

    return data ?? [];
  }

  /**
   * Delete a cache entry (for force-refresh).
   */
  async invalidate(bricklinkId: string): Promise<void> {
    await this.supabase
      .from('minifig_price_cache')
      .delete()
      .eq('bricklink_id', bricklinkId);
  }
}
