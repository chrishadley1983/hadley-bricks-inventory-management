/**
 * eBay Arbitrage Sync Service
 *
 * Handles syncing eBay pricing data for arbitrage tracking.
 * Uses the eBay Browse API to search for LEGO sets and calculate pricing aggregates.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database, Json } from '@hadley-bricks/database';
import { getEbayBrowseClient, type EbayItemSummary } from '../ebay/ebay-browse.client';
import { isValidLegoListing } from './ebay-listing-validator';
import { ArbitrageWatchlistService } from './watchlist.service';

const BATCH_SIZE = 5; // Number of parallel requests per batch
const BATCH_DELAY = 200; // ms between batches

/**
 * Processed eBay listing for storage
 */
export interface ProcessedEbayListing {
  itemId: string;
  title: string;
  price: number;
  currency: string;
  shipping: number;
  totalPrice: number;
  seller: string;
  sellerFeedback: number;
  url: string;
}

/**
 * eBay pricing snapshot
 */
export interface EbayPricingSnapshot {
  setNumber: string;
  minPrice: number | null;
  avgPrice: number | null;
  maxPrice: number | null;
  totalListings: number;
  listings: ProcessedEbayListing[];
}

/**
 * Service for syncing eBay pricing data
 */
export class EbayArbitrageSyncService {
  constructor(private supabase: SupabaseClient<Database>) {}

  /**
   * Sync eBay pricing for all mapped set numbers
   *
   * @param userId - User ID
   * @param options - Sync options
   * @param options.includeSeeded - Include seeded ASINs in sync (default: true)
   * @param onProgress - Progress callback
   */
  async syncPricing(
    userId: string,
    options: { includeSeeded?: boolean } = {},
    onProgress?: (processed: number, total: number) => void
  ): Promise<{ updated: number; failed: number; total: number }> {
    console.log('[EbayArbitrageSyncService.syncPricing] Starting pricing sync');
    const startTime = Date.now();

    // Get all active tracked ASINs
    const { data: activeAsins, error: asinsError } = await this.supabase
      .from('tracked_asins')
      .select('asin')
      .eq('user_id', userId)
      .eq('status', 'active');

    if (asinsError) {
      throw new Error(`Failed to fetch active ASINs: ${asinsError.message}`);
    }

    const activeAsinSet = new Set((activeAsins ?? []).map((a) => a.asin));

    // Get all mappings for this user
    const { data: mappings, error: mappingsError } = await this.supabase
      .from('asin_bricklink_mapping')
      .select('asin, bricklink_set_number')
      .eq('user_id', userId);

    if (mappingsError) {
      throw new Error(`Failed to fetch mappings: ${mappingsError.message}`);
    }

    // Filter to only mappings for active ASINs and get unique set numbers
    const activeMappings = (mappings ?? []).filter((m) => activeAsinSet.has(m.asin));
    const inventorySetNumbers = activeMappings.map((m) => m.bricklink_set_number);

    // Get seeded set numbers if enabled
    let seededSetNumbers: string[] = [];
    if (options.includeSeeded !== false) {
      const { data: seededData, error: seededError } = await this.supabase
        .from('user_seeded_asin_preferences')
        .select(
          `
          seeded_asins!inner(
            brickset_sets!inner(set_number)
          )
        `
        )
        .eq('user_id', userId)
        .eq('include_in_sync', true)
        .eq('user_status', 'active');

      if (!seededError && seededData) {
        seededSetNumbers = seededData
          .map((p) => {
            const sa = p.seeded_asins as unknown as {
              brickset_sets: { set_number: string } | null;
            };
            return sa?.brickset_sets?.set_number;
          })
          .filter((s): s is string => s !== null && s !== undefined);

        console.log(
          `[EbayArbitrageSyncService.syncPricing] Found ${seededSetNumbers.length} seeded set numbers to sync`
        );
      }
    }

    // Combine and deduplicate set numbers
    const setNumbers = [...new Set([...inventorySetNumbers, ...seededSetNumbers])];
    const total = setNumbers.length;
    console.log(`[EbayArbitrageSyncService.syncPricing] Found ${total} unique set numbers to sync`);

    let updated = 0;
    let failed = 0;
    let processed = 0;
    const today = new Date().toISOString().split('T')[0];

    const client = getEbayBrowseClient();

    // Process in parallel batches for speed
    for (let batchStart = 0; batchStart < setNumbers.length; batchStart += BATCH_SIZE) {
      const batch = setNumbers.slice(batchStart, batchStart + BATCH_SIZE);

      const batchResults = await Promise.allSettled(
        batch.map(async (setNumber) => {
          try {
            // Search eBay for this set
            const searchResult = await client.searchLegoSet(setNumber, 50);

            // Process and filter results
            const processedListings = this.processListings(
              searchResult.itemSummaries ?? [],
              setNumber
            );

            // Calculate aggregates
            const snapshot = this.calculateSnapshot(setNumber, processedListings);

            // Store in database
            const { error: insertError } = await this.supabase.from('ebay_pricing').upsert(
              {
                set_number: setNumber,
                snapshot_date: today,
                country_code: 'GB',
                condition: 'NEW',
                min_price: snapshot.minPrice,
                avg_price: snapshot.avgPrice,
                max_price: snapshot.maxPrice,
                total_listings: snapshot.totalListings,
                listings_json: snapshot.listings as unknown as Json,
              },
              {
                onConflict: 'set_number,snapshot_date,country_code,condition',
              }
            );

            if (insertError) {
              console.error(
                `[EbayArbitrageSyncService] Error storing ${setNumber}:`,
                insertError.message
              );
              return { success: false, setNumber };
            }

            return { success: true, setNumber, snapshot };
          } catch (err) {
            console.error(
              `[EbayArbitrageSyncService] Error fetching ${setNumber}:`,
              err instanceof Error ? err.message : 'Unknown error'
            );
            return { success: false, setNumber };
          }
        })
      );

      // Count results
      for (const result of batchResults) {
        processed++;
        if (result.status === 'fulfilled' && result.value.success) {
          updated++;
        } else {
          failed++;
        }
      }

      // Log progress every 50 items
      if (processed % 50 === 0 || processed === total) {
        console.log(
          `[EbayArbitrageSyncService] Progress: ${processed}/${total} (${updated} updated, ${failed} failed)`
        );
      }

      // Report progress
      onProgress?.(processed, total);

      // Delay between batches to avoid rate limits
      if (batchStart + BATCH_SIZE < setNumbers.length) {
        await this.delay(BATCH_DELAY);
      }
    }

    const duration = Date.now() - startTime;
    console.log(
      `[EbayArbitrageSyncService.syncPricing] Completed in ${duration}ms: ${updated} updated, ${failed} failed`
    );

    // Update sync status
    await this.updateSyncStatus(userId, {
      status: failed > 0 && updated === 0 ? 'failed' : 'completed',
      itemsProcessed: updated,
      itemsFailed: failed,
      durationMs: duration,
    });

    return { updated, failed, total };
  }

  /**
   * Sync eBay pricing for a batch of items from the watchlist
   * Used by scheduled cron jobs for cursor-based processing.
   *
   * @param userId - User ID
   * @param options - Batch options
   * @param options.offset - Starting offset in the watchlist
   * @param options.limit - Maximum items to process
   * @returns { processed, failed, updated, setNumbers } - The set numbers that were processed
   */
  async syncPricingBatch(
    userId: string,
    options: { offset: number; limit: number }
  ): Promise<{ processed: number; failed: number; updated: number; setNumbers: string[] }> {
    console.log(
      `[EbayArbitrageSyncService.syncPricingBatch] Starting batch - offset: ${options.offset}, limit: ${options.limit}`
    );
    const startTime = Date.now();

    // Get batch from watchlist (ordered by oldest sync time first)
    const watchlistService = new ArbitrageWatchlistService(this.supabase);
    const watchlistBatch = await watchlistService.getWatchlistBatch(
      userId,
      'ebay',
      options.offset,
      options.limit
    );

    if (watchlistBatch.length === 0) {
      console.log('[EbayArbitrageSyncService.syncPricingBatch] No items to process in this batch');
      return { processed: 0, failed: 0, updated: 0, setNumbers: [] };
    }

    const setNumbers = watchlistBatch.map((item) => item.bricklinkSetNumber);
    console.log(
      `[EbayArbitrageSyncService.syncPricingBatch] Processing ${setNumbers.length} set numbers`
    );

    let updated = 0;
    let failed = 0;
    let processed = 0;
    const today = new Date().toISOString().split('T')[0];
    const successfulSetNumbers: string[] = [];

    const client = getEbayBrowseClient();

    // Process in parallel batches for speed
    for (let batchStart = 0; batchStart < setNumbers.length; batchStart += BATCH_SIZE) {
      const batch = setNumbers.slice(batchStart, batchStart + BATCH_SIZE);

      const batchResults = await Promise.allSettled(
        batch.map(async (setNumber) => {
          try {
            // Search eBay for this set
            const searchResult = await client.searchLegoSet(setNumber, 50);

            // Process and filter results
            const processedListings = this.processListings(
              searchResult.itemSummaries ?? [],
              setNumber
            );

            // Calculate aggregates
            const snapshot = this.calculateSnapshot(setNumber, processedListings);

            // Store in database
            const { error: insertError } = await this.supabase.from('ebay_pricing').upsert(
              {
                set_number: setNumber,
                snapshot_date: today,
                country_code: 'GB',
                condition: 'NEW',
                min_price: snapshot.minPrice,
                avg_price: snapshot.avgPrice,
                max_price: snapshot.maxPrice,
                total_listings: snapshot.totalListings,
                listings_json: snapshot.listings as unknown as Json,
              },
              {
                onConflict: 'set_number,snapshot_date,country_code,condition',
              }
            );

            if (insertError) {
              console.error(
                `[EbayArbitrageSyncService.syncPricingBatch] Error storing ${setNumber}:`,
                insertError.message
              );
              return { success: false, setNumber };
            }

            return { success: true, setNumber, snapshot };
          } catch (err) {
            console.error(
              `[EbayArbitrageSyncService.syncPricingBatch] Error fetching ${setNumber}:`,
              err instanceof Error ? err.message : 'Unknown error'
            );
            return { success: false, setNumber };
          }
        })
      );

      // Count results
      for (const result of batchResults) {
        processed++;
        if (result.status === 'fulfilled' && result.value.success) {
          updated++;
          successfulSetNumbers.push(result.value.setNumber);
        } else {
          failed++;
        }
      }

      // Delay between batches to avoid rate limits
      if (batchStart + BATCH_SIZE < setNumbers.length) {
        await this.delay(BATCH_DELAY);
      }
    }

    // Update watchlist timestamps for successfully synced items
    if (successfulSetNumbers.length > 0) {
      await watchlistService.updateSyncTimestamp(userId, successfulSetNumbers, 'ebay');
    }

    const duration = Date.now() - startTime;
    console.log(
      `[EbayArbitrageSyncService.syncPricingBatch] Batch completed in ${duration}ms: ${updated} updated, ${failed} failed`
    );

    return { processed, failed, updated, setNumbers };
  }

  /**
   * Sync pricing for a single set number
   */
  async syncSingleSet(setNumber: string): Promise<EbayPricingSnapshot> {
    const client = getEbayBrowseClient();
    const today = new Date().toISOString().split('T')[0];

    // Search eBay for this set
    const searchResult = await client.searchLegoSet(setNumber, 50);

    // Process and filter results
    const processedListings = this.processListings(searchResult.itemSummaries ?? [], setNumber);

    // Calculate aggregates
    const snapshot = this.calculateSnapshot(setNumber, processedListings);

    // Store in database
    await this.supabase.from('ebay_pricing').upsert(
      {
        set_number: setNumber,
        snapshot_date: today,
        country_code: 'GB',
        condition: 'NEW',
        min_price: snapshot.minPrice,
        avg_price: snapshot.avgPrice,
        max_price: snapshot.maxPrice,
        total_listings: snapshot.totalListings,
        listings_json: snapshot.listings as unknown as Json,
      },
      {
        onConflict: 'set_number,snapshot_date,country_code,condition',
      }
    );

    return snapshot;
  }

  /**
   * Get latest eBay pricing for a set
   */
  async getLatestPricing(setNumber: string): Promise<{
    minPrice: number | null;
    avgPrice: number | null;
    maxPrice: number | null;
    totalListings: number | null;
    listings: ProcessedEbayListing[] | null;
    snapshotDate: string | null;
  } | null> {
    const { data, error } = await this.supabase
      .from('ebay_pricing')
      .select('*')
      .eq('set_number', setNumber)
      .eq('condition', 'NEW')
      .eq('country_code', 'GB')
      .order('snapshot_date', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error || !data) {
      return null;
    }

    return {
      minPrice: data.min_price,
      avgPrice: data.avg_price,
      maxPrice: data.max_price,
      totalListings: data.total_listings,
      listings: data.listings_json as ProcessedEbayListing[] | null,
      snapshotDate: data.snapshot_date,
    };
  }

  /**
   * Process eBay listings - filter invalid ones and extract data
   */
  private processListings(items: EbayItemSummary[], setNumber: string): ProcessedEbayListing[] {
    return items
      .filter((item) => isValidLegoListing(item.title, setNumber))
      .map((item) => {
        const price = parseFloat(item.price?.value ?? '0');
        const shipping = parseFloat(item.shippingOptions?.[0]?.shippingCost?.value ?? '0');

        return {
          itemId: item.itemId,
          title: item.title,
          price,
          currency: item.price?.currency ?? 'GBP',
          shipping,
          totalPrice: price + shipping,
          seller: item.seller?.username ?? 'Unknown',
          sellerFeedback: parseFloat(item.seller?.feedbackPercentage ?? '0'),
          url: item.itemWebUrl ?? '',
        };
      })
      .sort((a, b) => a.totalPrice - b.totalPrice);
  }

  /**
   * Calculate pricing snapshot from processed listings
   */
  private calculateSnapshot(
    setNumber: string,
    listings: ProcessedEbayListing[]
  ): EbayPricingSnapshot {
    if (listings.length === 0) {
      return {
        setNumber,
        minPrice: null,
        avgPrice: null,
        maxPrice: null,
        totalListings: 0,
        listings: [],
      };
    }

    const prices = listings.map((l) => l.totalPrice);
    const sum = prices.reduce((a, b) => a + b, 0);

    return {
      setNumber,
      minPrice: Math.min(...prices),
      avgPrice: Math.round((sum / prices.length) * 100) / 100,
      maxPrice: Math.max(...prices),
      totalListings: listings.length,
      listings: listings.slice(0, 20), // Store top 20 only
    };
  }

  /**
   * Update sync status
   */
  private async updateSyncStatus(
    userId: string,
    data: {
      status: string;
      itemsProcessed: number;
      itemsFailed: number;
      durationMs: number;
      errorMessage?: string;
    }
  ): Promise<void> {
    await this.supabase.from('arbitrage_sync_status').upsert(
      {
        user_id: userId,
        job_type: 'ebay_pricing',
        status: data.status,
        last_run_at: new Date().toISOString(),
        last_success_at: data.status === 'completed' ? new Date().toISOString() : undefined,
        last_run_duration_ms: data.durationMs,
        items_processed: data.itemsProcessed,
        items_failed: data.itemsFailed,
        error_message: data.errorMessage ?? null,
      },
      {
        onConflict: 'user_id,job_type',
      }
    );
  }

  /**
   * Delay helper
   */
  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
