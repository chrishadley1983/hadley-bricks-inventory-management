/**
 * Helper to look up BrickLink price cache data for snapshot items.
 * Shared between overview and items API routes.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@hadley-bricks/database';

export interface BLCacheEntry {
  partNumber: string;
  colourId: number;
  priceNew: number | null;
  priceUsed: number | null;
  strNew: number | null;
  strUsed: number | null;
  stockNew: number | null;
  stockUsed: number | null;
  soldNew: number | null;
  soldUsed: number | null;
}

/**
 * Fetch BrickLink cache entries for a list of part numbers.
 * Returns a Map keyed by "partNumber|colourId".
 */
export async function fetchBLCache(
  supabase: SupabaseClient<Database>,
  partNumbers: string[]
): Promise<Map<string, BLCacheEntry>> {
  const map = new Map<string, BLCacheEntry>();
  if (partNumbers.length === 0) return map;

  // Dedupe
  const unique = [...new Set(partNumbers)];

  // Fetch in batches of 500 (Supabase IN limit)
  for (let i = 0; i < unique.length; i += 500) {
    const batch = unique.slice(i, i + 500);
    const { data } = await supabase
      .from('bricklink_part_price_cache')
      .select('part_number, colour_id, price_new, price_used, sell_through_rate_new, sell_through_rate_used, stock_available_new, stock_available_used, times_sold_new, times_sold_used')
      .in('part_number', batch);

    if (data) {
      for (const row of data) {
        const key = `${row.part_number}|${row.colour_id}`;
        map.set(key, {
          partNumber: row.part_number,
          colourId: row.colour_id,
          priceNew: row.price_new ? parseFloat(String(row.price_new)) : null,
          priceUsed: row.price_used ? parseFloat(String(row.price_used)) : null,
          strNew: row.sell_through_rate_new ? parseFloat(String(row.sell_through_rate_new)) : null,
          strUsed: row.sell_through_rate_used ? parseFloat(String(row.sell_through_rate_used)) : null,
          stockNew: row.stock_available_new,
          stockUsed: row.stock_available_used,
          soldNew: row.times_sold_new,
          soldUsed: row.times_sold_used,
        });
      }
    }
  }

  return map;
}

/**
 * Get STR for a lot based on its condition and BL cache entry.
 */
export function getSTR(condition: string, entry: BLCacheEntry | undefined): number | null {
  if (!entry) return null;
  return condition === 'New' ? entry.strNew : entry.strUsed;
}

/**
 * Get sold count for a lot based on its condition.
 */
export function getSold(condition: string, entry: BLCacheEntry | undefined): number | null {
  if (!entry) return null;
  return condition === 'New' ? entry.soldNew : entry.soldUsed;
}

/**
 * Get for-sale count for a lot based on its condition.
 */
export function getForSale(condition: string, entry: BLCacheEntry | undefined): number | null {
  if (!entry) return null;
  return condition === 'New' ? entry.stockNew : entry.stockUsed;
}

/**
 * Get BL average price for a lot based on its condition.
 */
export function getBLAvg(condition: string, entry: BLCacheEntry | undefined): number | null {
  if (!entry) return null;
  return condition === 'New' ? entry.priceNew : entry.priceUsed;
}
