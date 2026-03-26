/**
 * Inventory Explorer — BrickLink Price Enrichment Service
 *
 * Fetches BrickLink price guide data (avg price, STR, sold, for-sale counts)
 * for snapshot items and caches in the existing bricklink_part_price_cache table.
 *
 * Uses 2 API calls per item: stock + sold for the item's condition.
 * Rate-limited to stay within BrickLink's 5000 req/day limit.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@hadley-bricks/database';
import { BrickLinkClient } from '../bricklink/client';
import type { BrickLinkCredentials, BrickLinkItemType } from '../bricklink/types';
import { CredentialsRepository } from '../repositories/credentials.repository';

/** Map explorer item_type to BrickLink item type */
function toBrickLinkType(itemType: string): BrickLinkItemType {
  switch (itemType) {
    case 'Set':
      return 'SET';
    case 'Minifig':
      return 'MINIFIG';
    default:
      return 'PART';
  }
}

export interface EnrichmentProgress {
  processed: number;
  total: number;
  cached: number;
  fetched: number;
  errors: number;
  status: 'running' | 'completed' | 'failed';
}

export interface EnrichmentResult {
  totalProcessed: number;
  alreadyCached: number;
  newlyFetched: number;
  errors: number;
}

/** Delay between API requests (ms) */
const REQUEST_DELAY = 250;

/** Delay between batches (ms) */
const BATCH_DELAY = 2000;

/** Batch size for BrickLink API calls */
const BATCH_SIZE = 10;

/** Max items to enrich per manual invocation */
const MAX_ITEMS_PER_RUN = 200;

/** Max items for daily cron refresh (1000 items = 2000 API calls, well within 5000/day) */
const MAX_ITEMS_DAILY_REFRESH = 1000;

export class EnrichmentService {
  constructor(
    private supabase: SupabaseClient<Database>,
    private userId: string
  ) {}

  /**
   * Enrich snapshot items with BrickLink price data.
   * Prioritises items by value (most expensive first).
   * Skips items already in the cache (unless stale).
   */
  async enrich(options?: {
    maxItems?: number;
    onProgress?: (progress: EnrichmentProgress) => void;
  }): Promise<EnrichmentResult> {
    const maxItems = options?.maxItems ?? MAX_ITEMS_PER_RUN;
    const onProgress = options?.onProgress;

    // 1. Get BrickLink credentials
    const credRepo = new CredentialsRepository(this.supabase);
    const creds = await credRepo.getCredentials<BrickLinkCredentials>(this.userId, 'bricklink');
    if (!creds) {
      throw new Error('BrickLink credentials not configured');
    }

    const client = new BrickLinkClient(creds);

    // 2. Get distinct items from snapshot that need enrichment
    //    We fetch consolidated (item_number, color_id, condition, item_type)
    //    ordered by total value descending (most valuable first)
    const candidates = await this.getUnenrichedItems(maxItems);

    if (candidates.length === 0) {
      return { totalProcessed: 0, alreadyCached: 0, newlyFetched: 0, errors: 0 };
    }

    let fetched = 0;
    let errors = 0;
    const total = candidates.length;

    // 3. Process in batches
    for (let i = 0; i < candidates.length; i += BATCH_SIZE) {
      const batch = candidates.slice(i, i + BATCH_SIZE);

      for (const item of batch) {
        try {
          await this.fetchAndCache(client, item);
          fetched++;
        } catch (err) {
          errors++;
          const msg = err instanceof Error ? err.message : String(err);
          // Stop on rate limit
          if (msg.includes('rate limit') || msg.includes('429')) {
            console.log('[Enrichment] Rate limited, stopping');
            onProgress?.({
              processed: i + batch.indexOf(item) + 1,
              total,
              cached: 0,
              fetched,
              errors,
              status: 'completed',
            });
            return { totalProcessed: fetched + errors, alreadyCached: 0, newlyFetched: fetched, errors };
          }
          console.error(`[Enrichment] Error for ${item.itemNumber}: ${msg}`);
        }

        // Rate limit delay
        await sleep(REQUEST_DELAY);
      }

      onProgress?.({
        processed: Math.min(i + BATCH_SIZE, total),
        total,
        cached: 0,
        fetched,
        errors,
        status: 'running',
      });

      // Batch delay
      if (i + BATCH_SIZE < candidates.length) {
        await sleep(BATCH_DELAY);
      }
    }

    onProgress?.({
      processed: total,
      total,
      cached: 0,
      fetched,
      errors,
      status: 'completed',
    });

    return { totalProcessed: total, alreadyCached: 0, newlyFetched: fetched, errors };
  }

  /**
   * Get snapshot items that don't have fresh BrickLink data.
   * Returns consolidated unique (item_number, color_id, condition, item_type) combos.
   */
  private async getUnenrichedItems(
    limit: number
  ): Promise<Array<{ itemNumber: string; colorId: number; condition: string; itemType: string; totalValue: number }>> {
    // Get top items by value from snapshot
    const allItems: Array<{
      item_number: string;
      color_id: number | null;
      condition: string;
      item_type: string;
      bricqer_price: number;
      quantity: number;
    }> = [];

    let offset = 0;
    const pageSize = 1000;
    while (true) {
      const { data } = await this.supabase
        .from('bricqer_inventory_snapshot')
        .select('item_number, color_id, condition, item_type, bricqer_price, quantity')
        .eq('user_id', this.userId)
        .not('color_id', 'is', null)
        .range(offset, offset + pageSize - 1);

      if (!data || data.length === 0) break;
      allItems.push(...data);
      if (data.length < pageSize) break;
      offset += pageSize;
    }

    // Consolidate by (item_number, color_id, condition, item_type) and sum value
    const map = new Map<string, { itemNumber: string; colorId: number; condition: string; itemType: string; totalValue: number }>();

    for (const item of allItems) {
      if (item.color_id === null) continue;
      const key = `${item.item_number}|${item.color_id}|${item.condition}`;
      const existing = map.get(key);
      if (existing) {
        existing.totalValue += item.bricqer_price * item.quantity;
      } else {
        map.set(key, {
          itemNumber: item.item_number,
          colorId: item.color_id,
          condition: item.condition,
          itemType: item.item_type,
          totalValue: item.bricqer_price * item.quantity,
        });
      }
    }

    // Check which ones already have fresh cache entries
    const candidates = Array.from(map.values());
    const partNumbers = [...new Set(candidates.map((c) => c.itemNumber))];

    // Fetch existing cache entries
    const freshThresholdMs = 90 * 24 * 60 * 60 * 1000; // 90 days
    const freshAfter = new Date(Date.now() - freshThresholdMs).toISOString();

    const cachedSet = new Set<string>();
    let cacheOffset = 0;
    while (true) {
      const { data: cached } = await this.supabase
        .from('bricklink_part_price_cache')
        .select('part_number, colour_id')
        .in('part_number', partNumbers.slice(cacheOffset, cacheOffset + 500))
        .gte('fetched_at', freshAfter);

      if (!cached || cached.length === 0) break;
      for (const c of cached) {
        cachedSet.add(`${c.part_number}|${c.colour_id}`);
      }
      cacheOffset += 500;
      if (cacheOffset >= partNumbers.length) break;
    }

    // Filter out already-cached items
    const unenriched = candidates.filter(
      (c) => !cachedSet.has(`${c.itemNumber}|${c.colorId}`)
    );

    // Sort by value descending and take top N
    unenriched.sort((a, b) => b.totalValue - a.totalValue);
    return unenriched.slice(0, limit);
  }

  /**
   * Fetch BrickLink price data for a single item and cache it.
   * Makes 2 API calls: stock + sold for the item's condition.
   */
  private async fetchAndCache(
    client: BrickLinkClient,
    item: { itemNumber: string; colorId: number; condition: string; itemType: string }
  ): Promise<void> {
    const blType = toBrickLinkType(item.itemType);
    const blCondition = item.condition === 'New' ? 'N' : 'U';

    // Fetch stock data (current listings)
    const stockData = await client.getPartPriceGuide(blType, item.itemNumber, item.colorId, {
      condition: blCondition,
      guideType: 'stock',
      currencyCode: 'GBP',
    });

    await sleep(REQUEST_DELAY);

    // Fetch sold data (historical sales)
    const soldData = await client.getPartPriceGuide(blType, item.itemNumber, item.colorId, {
      condition: blCondition,
      guideType: 'sold',
      currencyCode: 'GBP',
    });

    // Calculate STR: times_sold / (times_sold + stock_available)
    const stockAvailable = stockData.total_quantity || 0;
    const timesSold = soldData.total_quantity || 0;
    const str = stockAvailable + timesSold > 0
      ? (timesSold / (timesSold + stockAvailable)) * 100
      : null;

    const avgPrice = soldData.avg_price ? parseFloat(soldData.avg_price) : null;

    // Build upsert row — use the new/used split columns
    const isNew = blCondition === 'N';
    const now = new Date().toISOString();

    const { error } = await this.supabase
      .from('bricklink_part_price_cache')
      .upsert(
        {
          part_number: item.itemNumber,
          part_type: blType,
          colour_id: item.colorId,
          fetched_at: now,
          updated_at: now,
          ...(isNew
            ? {
                price_new: avgPrice,
                sell_through_rate_new: str,
                stock_available_new: stockAvailable,
                times_sold_new: timesSold,
              }
            : {
                price_used: avgPrice,
                sell_through_rate_used: str,
                stock_available_used: stockAvailable,
                times_sold_used: timesSold,
              }),
        },
        { onConflict: 'part_number,colour_id' }
      );

    if (error) {
      console.error(`[Enrichment] Cache upsert error for ${item.itemNumber}:`, error.message);
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
