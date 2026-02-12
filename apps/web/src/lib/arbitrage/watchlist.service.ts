/**
 * Arbitrage Watchlist Service
 *
 * Manages the persistent watchlist of set numbers for scheduled eBay/BrickLink pricing sync.
 * The watchlist is populated from:
 * 1. All ASINs ever sold on Amazon (from order history)
 * 2. Retired seeded ASINs with pricing data (buy_box_price or was_price_90d)
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@hadley-bricks/database';

const PAGE_SIZE = 1000; // Supabase returns max 1000 rows

/**
 * Normalize a set number to BrickLink format.
 * BrickLink requires the variant suffix (e.g., "75301-1" not "75301").
 *
 * Rules:
 * - If already has a suffix like "-1", "-2", etc., leave it alone
 * - If it's a standard set number (numeric only), append "-1"
 * - Promotional/gear items starting with 5xxxxxx are left as-is (they need manual mapping)
 */
function normalizeToBricklinkFormat(setNumber: string): string {
  if (!setNumber) return setNumber;

  // Already has a suffix (e.g., "-1", "-2")
  if (/-\d+$/.test(setNumber)) {
    return setNumber;
  }

  // Skip 7-digit gear/accessory items (5xxxxxx) - these need manual mapping
  if (/^5\d{6}$/.test(setNumber)) {
    return setNumber;
  }

  // Standard set numbers (4-6 digits) get "-1" suffix
  if (/^\d{4,6}$/.test(setNumber)) {
    return `${setNumber}-1`;
  }

  // Return as-is for anything else
  return setNumber;
}

export type WatchlistSource = 'sold_inventory' | 'retired_with_pricing' | 'seeded';

export interface WatchlistItem {
  id: string;
  asin: string | null;
  bricklinkSetNumber: string;
  source: WatchlistSource;
  ebayLastSyncedAt: string | null;
  bricklinkLastSyncedAt: string | null;
  isActive: boolean;
}

export interface WatchlistRefreshResult {
  added: number;
  removed: number;
  total: number;
  soldInventoryCount: number;
  retiredWithPricingCount: number;
}

export interface WatchlistStats {
  totalActive: number;
  soldInventoryCount: number;
  retiredWithPricingCount: number;
  ebayNeverSynced: number;
  bricklinkNeverSynced: number;
  ebayStale: number;
  bricklinkStale: number;
  oldestEbaySync: string | null;
  oldestBricklinkSync: string | null;
}

/**
 * Service for managing the arbitrage watchlist
 */
export class ArbitrageWatchlistService {
  constructor(private supabase: SupabaseClient<Database>) {}

  /**
   * Refresh the watchlist by combining:
   * 1. All ASINs ever sold on Amazon
   * 2. Retired seeded ASINs with pricing data
   *
   * This performs a full refresh - items no longer meeting criteria will be deactivated.
   */
  async refreshWatchlist(userId: string): Promise<WatchlistRefreshResult> {
    console.log('[ArbitrageWatchlistService.refreshWatchlist] Starting refresh for user:', userId);
    const startTime = Date.now();

    // 1. Get all ASINs ever sold on Amazon (from order_items joined to platform_orders)
    const soldAsins = await this.getSoldAmazonAsins(userId);
    console.log(`[ArbitrageWatchlistService.refreshWatchlist] Found ${soldAsins.length} sold ASINs`);

    // 2. Get retired seeded ASINs with pricing data
    const retiredSeeded = await this.getRetiredSeededWithPricing(userId);
    console.log(`[ArbitrageWatchlistService.refreshWatchlist] Found ${retiredSeeded.length} retired seeded with pricing`);

    // Combine both sources into a Map keyed by bricklink_set_number
    const watchlistMap = new Map<string, { asin: string | null; source: WatchlistSource }>();

    // Add sold inventory items (priority over seeded)
    for (const item of soldAsins) {
      if (item.bricklinkSetNumber) {
        const normalizedSetNumber = normalizeToBricklinkFormat(item.bricklinkSetNumber);
        watchlistMap.set(normalizedSetNumber, {
          asin: item.asin,
          source: 'sold_inventory',
        });
      }
    }

    // Add retired seeded items (only if not already from sold inventory)
    for (const item of retiredSeeded) {
      const normalizedSetNumber = normalizeToBricklinkFormat(item.bricklinkSetNumber);
      if (!watchlistMap.has(normalizedSetNumber)) {
        watchlistMap.set(normalizedSetNumber, {
          asin: item.asin,
          source: 'retired_with_pricing',
        });
      }
    }

    // Get existing watchlist items
    const existingItems = await this.getAllWatchlistItems(userId);
    const existingMap = new Map(existingItems.map((item) => [item.bricklinkSetNumber, item]));

    let added = 0;
    let removed = 0;

    // Prepare upsert data for new/updated items
    const upsertData: {
      user_id: string;
      asin: string | null;
      bricklink_set_number: string;
      source: WatchlistSource;
      is_active: boolean;
    }[] = [];

    // Add new items or reactivate existing ones
    for (const [setNumber, data] of watchlistMap) {
      const existing = existingMap.get(setNumber);
      if (!existing) {
        added++;
      }
      upsertData.push({
        user_id: userId,
        asin: data.asin,
        bricklink_set_number: setNumber,
        source: data.source,
        is_active: true,
      });
    }

    // Deactivate items that are no longer in the watchlist criteria
    // Skip 'seeded' source items - they're managed separately via migration/manual insertion
    const setNumbersToDeactivate: string[] = [];
    for (const [setNumber, existing] of existingMap) {
      if (!watchlistMap.has(setNumber) && existing.isActive && existing.source !== 'seeded') {
        setNumbersToDeactivate.push(setNumber);
        removed++;
      }
    }

    // Batch upsert watchlist items
    if (upsertData.length > 0) {
      const BATCH_SIZE = 100;
      for (let i = 0; i < upsertData.length; i += BATCH_SIZE) {
        const batch = upsertData.slice(i, i + BATCH_SIZE);
        const { error } = await this.supabase
          .from('arbitrage_watchlist')
          .upsert(batch, {
            onConflict: 'user_id,bricklink_set_number',
          });

        if (error) {
          console.error('[ArbitrageWatchlistService.refreshWatchlist] Upsert error:', error);
        }
      }
    }

    // Deactivate removed items
    if (setNumbersToDeactivate.length > 0) {
      const { error } = await this.supabase
        .from('arbitrage_watchlist')
        .update({ is_active: false })
        .eq('user_id', userId)
        .in('bricklink_set_number', setNumbersToDeactivate);

      if (error) {
        console.error('[ArbitrageWatchlistService.refreshWatchlist] Deactivate error:', error);
      }
    }

    const duration = Date.now() - startTime;
    console.log(`[ArbitrageWatchlistService.refreshWatchlist] Completed in ${duration}ms: ${added} added, ${removed} deactivated, ${watchlistMap.size} total`);

    return {
      added,
      removed,
      total: watchlistMap.size,
      soldInventoryCount: soldAsins.filter((a) => a.bricklinkSetNumber).length,
      retiredWithPricingCount: retiredSeeded.length,
    };
  }

  /**
   * Get a batch of watchlist items for sync, ordered by oldest sync time first
   *
   * @param userId - User ID
   * @param syncType - Which platform to get items for
   * @param offset - Offset for pagination (cursor position)
   * @param limit - Maximum items to return
   */
  async getWatchlistBatch(
    userId: string,
    syncType: 'ebay' | 'bricklink',
    offset: number,
    limit: number
  ): Promise<WatchlistItem[]> {
    const syncColumn = syncType === 'ebay' ? 'ebay_last_synced_at' : 'bricklink_last_synced_at';

    // Order by sync timestamp (nulls first = never synced), then by id for deterministic ordering
    const { data, error } = await this.supabase
      .from('arbitrage_watchlist')
      .select('*')
      .eq('user_id', userId)
      .eq('is_active', true)
      .order(syncColumn, { ascending: true, nullsFirst: true })
      .order('id', { ascending: true })
      .range(offset, offset + limit - 1);

    if (error) {
      console.error('[ArbitrageWatchlistService.getWatchlistBatch] Error:', error);
      return [];
    }

    return (data ?? []).map((item) => ({
      id: item.id,
      asin: item.asin,
      bricklinkSetNumber: item.bricklink_set_number,
      source: item.source as WatchlistSource,
      ebayLastSyncedAt: item.ebay_last_synced_at,
      bricklinkLastSyncedAt: item.bricklink_last_synced_at,
      isActive: item.is_active,
    }));
  }

  /**
   * Get the count of active watchlist items for a user
   */
  async getWatchlistCount(userId: string): Promise<number> {
    const { count, error } = await this.supabase
      .from('arbitrage_watchlist')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', userId)
      .eq('is_active', true);

    if (error) {
      console.error('[ArbitrageWatchlistService.getWatchlistCount] Error:', error);
      return 0;
    }

    return count ?? 0;
  }

  /**
   * Update sync timestamps for items after they've been synced
   *
   * @param userId - User ID
   * @param setNumbers - Set numbers that were synced
   * @param syncType - Which platform was synced
   */
  async updateSyncTimestamp(
    userId: string,
    setNumbers: string[],
    syncType: 'ebay' | 'bricklink'
  ): Promise<void> {
    if (setNumbers.length === 0) return;

    const now = new Date().toISOString();
    const updateColumn = syncType === 'ebay' ? 'ebay_last_synced_at' : 'bricklink_last_synced_at';

    // Batch update in chunks of 100
    const BATCH_SIZE = 100;
    for (let i = 0; i < setNumbers.length; i += BATCH_SIZE) {
      const batch = setNumbers.slice(i, i + BATCH_SIZE);

      const { error } = await this.supabase
        .from('arbitrage_watchlist')
        .update({ [updateColumn]: now })
        .eq('user_id', userId)
        .in('bricklink_set_number', batch);

      if (error) {
        console.error('[ArbitrageWatchlistService.updateSyncTimestamp] Error:', error);
      }
    }
  }

  /**
   * Get watchlist statistics for a user
   */
  async getWatchlistStats(userId: string): Promise<WatchlistStats | null> {
    const { data, error } = await this.supabase
      .from('arbitrage_watchlist_stats')
      .select('*')
      .eq('user_id', userId)
      .single();

    if (error || !data) {
      return null;
    }

    return {
      totalActive: data.total_active ?? 0,
      soldInventoryCount: data.sold_inventory_count ?? 0,
      retiredWithPricingCount: data.retired_with_pricing_count ?? 0,
      ebayNeverSynced: data.ebay_never_synced ?? 0,
      bricklinkNeverSynced: data.bricklink_never_synced ?? 0,
      ebayStale: data.ebay_stale ?? 0,
      bricklinkStale: data.bricklink_stale ?? 0,
      oldestEbaySync: data.oldest_ebay_sync,
      oldestBricklinkSync: data.oldest_bricklink_sync,
    };
  }

  /**
   * Get all ASINs that have been sold on Amazon
   * These are from inventory_items that have amazon_asin and have been sold
   * (linked to order_items via inventory_item_id where the order is from Amazon)
   */
  private async getSoldAmazonAsins(
    userId: string
  ): Promise<{ asin: string; bricklinkSetNumber: string | null }[]> {
    const results: { asin: string; bricklinkSetNumber: string | null }[] = [];
    let page = 0;
    let hasMore = true;

    while (hasMore) {
      // Get inventory items that have been sold on Amazon (have an amazon_asin and linked to an order)
      const { data, error } = await this.supabase
        .from('inventory_items')
        .select(`
          amazon_asin,
          set_number,
          order_items!inventory_item_id(
            order_id,
            platform_orders!inner(platform)
          )
        `)
        .eq('user_id', userId)
        .not('amazon_asin', 'is', null)
        .not('order_items', 'is', null)
        .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1);

      if (error) {
        console.error('[ArbitrageWatchlistService.getSoldAmazonAsins] Error:', error);
        break;
      }

      // Deduplicate by ASIN and filter for Amazon orders
      const seenAsins = new Set(results.map((r) => r.asin));
      for (const item of data ?? []) {
        const orderItems = item.order_items as unknown as Array<{
          order_id: string;
          platform_orders: { platform: string } | null;
        }> | null;

        // Check if any order is from Amazon
        const hasAmazonOrder = orderItems?.some(
          (oi) => oi.platform_orders?.platform === 'amazon'
        );

        if (item.amazon_asin && hasAmazonOrder && !seenAsins.has(item.amazon_asin)) {
          seenAsins.add(item.amazon_asin);
          results.push({
            asin: item.amazon_asin,
            bricklinkSetNumber: item.set_number ?? null,
          });
        }
      }

      hasMore = (data?.length ?? 0) === PAGE_SIZE;
      page++;
    }

    return results;
  }

  /**
   * Get retired seeded ASINs that have pricing data
   * These are seeded ASINs where:
   * - The brickset set has us_date_removed < CURRENT_DATE (retired)
   * - The user has them enabled (include_in_sync = true)
   * - They have pricing data (buy_box_price OR was_price_90d in amazon_arbitrage_pricing)
   */
  private async getRetiredSeededWithPricing(
    userId: string
  ): Promise<{ asin: string | null; bricklinkSetNumber: string }[]> {
    const results: { asin: string | null; bricklinkSetNumber: string }[] = [];
    let page = 0;
    let hasMore = true;

    while (hasMore) {
      // Get seeded ASINs that are:
      // 1. Enabled by the user
      // 2. From retired sets (us_date_removed < now)
      // 3. Have pricing data (buy_box_price or was_price_90d)
      const { data, error } = await this.supabase
        .from('user_seeded_asin_preferences')
        .select(`
          manual_asin_override,
          seeded_asins!inner(
            asin,
            brickset_sets!inner(
              set_number,
              us_date_removed
            )
          )
        `)
        .eq('user_id', userId)
        .eq('include_in_sync', true)
        .eq('user_status', 'active')
        .not('seeded_asins.brickset_sets.us_date_removed', 'is', null)
        .lt('seeded_asins.brickset_sets.us_date_removed', new Date().toISOString().split('T')[0])
        .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1);

      if (error) {
        console.error('[ArbitrageWatchlistService.getRetiredSeededWithPricing] Error:', error);
        break;
      }

      for (const item of data ?? []) {
        const sa = item.seeded_asins as unknown as {
          asin: string | null;
          brickset_sets: { set_number: string; us_date_removed: string | null } | null;
        };
        const asin = item.manual_asin_override ?? sa?.asin ?? null;
        const setNumber = sa?.brickset_sets?.set_number;

        if (setNumber) {
          results.push({
            asin,
            bricklinkSetNumber: setNumber,
          });
        }
      }

      hasMore = (data?.length ?? 0) === PAGE_SIZE;
      page++;
    }

    // Filter to only those with pricing data
    const seededWithPricing: { asin: string | null; bricklinkSetNumber: string }[] = [];

    // Get all ASINs that have pricing data (buy_box_price or was_price_90d)
    const asinsToCheck = results.filter((r) => r.asin).map((r) => r.asin as string);
    if (asinsToCheck.length > 0) {
      // Check for pricing data in batches
      const BATCH_SIZE = 100;
      const asinsWithPricing = new Set<string>();

      for (let i = 0; i < asinsToCheck.length; i += BATCH_SIZE) {
        const batch = asinsToCheck.slice(i, i + BATCH_SIZE);
        const { data: pricingData, error: pricingError } = await this.supabase
          .from('amazon_arbitrage_pricing')
          .select('asin')
          .in('asin', batch)
          .or('buy_box_price.not.is.null,was_price_90d.not.is.null');

        if (!pricingError && pricingData) {
          for (const p of pricingData) {
            asinsWithPricing.add(p.asin);
          }
        }
      }

      // Filter results to only those with pricing
      for (const item of results) {
        if (item.asin && asinsWithPricing.has(item.asin)) {
          seededWithPricing.push(item);
        }
      }
    }

    return seededWithPricing;
  }

  /**
   * Get all watchlist items for a user (paginated)
   */
  private async getAllWatchlistItems(userId: string): Promise<WatchlistItem[]> {
    const results: WatchlistItem[] = [];
    let page = 0;
    let hasMore = true;

    while (hasMore) {
      const { data, error } = await this.supabase
        .from('arbitrage_watchlist')
        .select('*')
        .eq('user_id', userId)
        .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1);

      if (error) {
        console.error('[ArbitrageWatchlistService.getAllWatchlistItems] Error:', error);
        break;
      }

      for (const item of data ?? []) {
        results.push({
          id: item.id,
          asin: item.asin,
          bricklinkSetNumber: item.bricklink_set_number,
          source: item.source as WatchlistSource,
          ebayLastSyncedAt: item.ebay_last_synced_at,
          bricklinkLastSyncedAt: item.bricklink_last_synced_at,
          isActive: item.is_active,
        });
      }

      hasMore = (data?.length ?? 0) === PAGE_SIZE;
      page++;
    }

    return results;
  }
}
