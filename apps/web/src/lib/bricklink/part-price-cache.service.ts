/**
 * Part Price Cache Service
 *
 * Manages caching of BrickLink part prices to reduce API calls.
 * Cache is keyed by part_number + colour_id with configurable freshness.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type {
  PartIdentifier,
  CacheLookupResult,
  CachedPartWithIdentifier,
  PartPriceData,
} from '@/types/partout';

/** Default cache freshness in days (6 months) */
const DEFAULT_FRESHNESS_DAYS = 180;

/**
 * Get the cache freshness threshold in days from environment variable
 */
function getFreshnessDays(): number {
  const envValue = process.env.PARTOUT_CACHE_FRESHNESS_DAYS;
  if (envValue) {
    const parsed = parseInt(envValue, 10);
    if (!isNaN(parsed) && parsed > 0) {
      return parsed;
    }
  }
  return DEFAULT_FRESHNESS_DAYS;
}

/**
 * Check if a cached entry is still fresh
 */
function isFresh(fetchedAt: Date): boolean {
  const freshnessDays = getFreshnessDays();
  const freshnessMs = freshnessDays * 24 * 60 * 60 * 1000;
  const now = Date.now();
  return now - fetchedAt.getTime() < freshnessMs;
}

/**
 * Part Price Cache Service
 */
export class PartPriceCacheService {
  constructor(private supabase: SupabaseClient) {}

  /**
   * Look up cached prices for a list of parts
   * @param parts List of part identifiers to look up
   * @returns Object with cached (fresh) and uncached (stale/missing) parts
   */
  async getCachedPrices(parts: PartIdentifier[]): Promise<CacheLookupResult> {
    if (parts.length === 0) {
      return { cached: [], uncached: [] };
    }

    // Build query for all part+colour combinations
    const lookupPairs = parts.map((p) => ({
      partNumber: p.partNumber,
      colourId: p.colourId,
    }));

    // Query cache table for all parts
    // Supabase doesn't support composite IN queries, so we'll fetch by part numbers
    // and filter in memory
    const uniquePartNumbers = [...new Set(parts.map((p) => p.partNumber))];

    const { data: cachedData, error } = await this.supabase
      .from('bricklink_part_price_cache')
      .select('*')
      .in('part_number', uniquePartNumbers);

    if (error) {
      console.error('[PartPriceCacheService] Error fetching cached prices:', error);
      // On error, treat all as uncached
      return { cached: [], uncached: parts };
    }

    // Build a map of cached entries by part_number + colour_id
    const cacheMap = new Map<string, CachedPartWithIdentifier>();
    for (const row of cachedData || []) {
      const key = `${row.part_number}:${row.colour_id}`;
      const fetchedAt = new Date(row.fetched_at);

      if (isFresh(fetchedAt)) {
        // Find the original part to get name and quantity
        const originalPart = parts.find(
          (p) => p.partNumber === row.part_number && p.colourId === row.colour_id
        );

        if (originalPart) {
          cacheMap.set(key, {
            partNumber: row.part_number,
            partType: row.part_type,
            colourId: row.colour_id,
            colourName: row.colour_name,
            priceNew: row.price_new ? parseFloat(row.price_new) : null,
            priceUsed: row.price_used ? parseFloat(row.price_used) : null,
            sellThroughRateNew: row.sell_through_rate_new ? parseFloat(row.sell_through_rate_new) : null,
            sellThroughRateUsed: row.sell_through_rate_used ? parseFloat(row.sell_through_rate_used) : null,
            stockAvailableNew: row.stock_available_new,
            stockAvailableUsed: row.stock_available_used,
            timesSoldNew: row.times_sold_new,
            timesSoldUsed: row.times_sold_used,
            fetchedAt,
            name: originalPart.name,
            quantity: originalPart.quantity,
          });
        }
      }
    }

    // Separate parts into cached and uncached
    const cached: CachedPartWithIdentifier[] = [];
    const uncached: PartIdentifier[] = [];

    for (const part of parts) {
      const key = `${part.partNumber}:${part.colourId}`;
      const cachedEntry = cacheMap.get(key);

      if (cachedEntry) {
        cached.push(cachedEntry);
      } else {
        uncached.push(part);
      }
    }

    console.log(
      `[PartPriceCacheService] Cache lookup: ${cached.length} cached, ${uncached.length} uncached`
    );

    return { cached, uncached };
  }

  /**
   * Insert or update prices in the cache
   * @param prices List of part prices to cache
   */
  async upsertPrices(prices: PartPriceData[]): Promise<void> {
    if (prices.length === 0) {
      return;
    }

    const now = new Date().toISOString();

    // Transform to database format
    const rows = prices.map((p) => ({
      part_number: p.partNumber,
      part_type: p.partType,
      colour_id: p.colourId,
      colour_name: p.colourName,
      price_new: p.priceNew,
      price_used: p.priceUsed,
      sell_through_rate_new: p.sellThroughRateNew,
      sell_through_rate_used: p.sellThroughRateUsed,
      stock_available_new: p.stockAvailableNew,
      stock_available_used: p.stockAvailableUsed,
      times_sold_new: p.timesSoldNew,
      times_sold_used: p.timesSoldUsed,
      fetched_at: now,
      updated_at: now,
    }));

    // Upsert in batches of 100 to avoid hitting limits
    const BATCH_SIZE = 100;
    for (let i = 0; i < rows.length; i += BATCH_SIZE) {
      const batch = rows.slice(i, i + BATCH_SIZE);

      const { error } = await this.supabase
        .from('bricklink_part_price_cache')
        .upsert(batch, {
          onConflict: 'part_number,colour_id',
          ignoreDuplicates: false,
        });

      if (error) {
        console.error('[PartPriceCacheService] Error upserting prices:', error);
        // Continue with other batches
      }
    }

    console.log(`[PartPriceCacheService] Upserted ${prices.length} prices to cache`);
  }

  /**
   * Get the current freshness threshold in days
   */
  getFreshnessDays(): number {
    return getFreshnessDays();
  }

  /**
   * Delete cached prices for specific parts
   * @param parts List of part identifiers to delete from cache
   */
  async deleteCachedPrices(parts: PartIdentifier[]): Promise<void> {
    if (parts.length === 0) {
      return;
    }

    // Get unique part numbers
    const uniquePartNumbers = [...new Set(parts.map((p) => p.partNumber))];

    // Build conditions for deletion - we need to match part_number + colour_id pairs
    // Supabase doesn't support composite IN queries, so delete by part numbers
    // and let the API re-fetch with correct colors
    const { error } = await this.supabase
      .from('bricklink_part_price_cache')
      .delete()
      .in('part_number', uniquePartNumbers);

    if (error) {
      console.error('[PartPriceCacheService] Error deleting cached prices:', error);
    } else {
      console.log(`[PartPriceCacheService] Deleted cache for ${uniquePartNumbers.length} part numbers`);
    }
  }
}
