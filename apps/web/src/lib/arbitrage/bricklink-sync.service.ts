/**
 * BrickLink Arbitrage Sync Service
 *
 * Handles syncing BrickLink pricing data for arbitrage tracking.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database, Json } from '@hadley-bricks/database';
import { BrickLinkClient, BrickLinkApiError, RateLimitError } from '../bricklink/client';
import type { BrickLinkCredentials, BrickLinkPriceGuide, BrickLinkPriceDetail } from '../bricklink/types';
import { CredentialsRepository } from '../repositories';

const RATE_LIMIT_DELAY = 200; // ms between BrickLink API calls

/**
 * Service for syncing BrickLink pricing data
 */
export class BrickLinkArbitrageSyncService {
  private credentialsRepo: CredentialsRepository;

  constructor(private supabase: SupabaseClient<Database>) {
    this.credentialsRepo = new CredentialsRepository(supabase);
  }

  /**
   * Get BrickLink client for a user
   */
  private async getClient(userId: string): Promise<BrickLinkClient> {
    const credentials = await this.credentialsRepo.getCredentials<BrickLinkCredentials>(
      userId,
      'bricklink'
    );

    if (!credentials) {
      throw new Error('BrickLink credentials not configured');
    }

    return new BrickLinkClient(credentials);
  }

  /**
   * Sync BrickLink pricing for all mapped set numbers
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
    console.log('[BrickLinkArbitrageSyncService.syncPricing] Starting pricing sync for user:', userId);
    const startTime = Date.now();

    const client = await this.getClient(userId);

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
        .select(`
          seeded_asins!inner(
            brickset_sets!inner(set_number)
          )
        `)
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

        console.log(`[BrickLinkArbitrageSyncService.syncPricing] Found ${seededSetNumbers.length} seeded set numbers to sync`);
      }
    }

    // Combine and deduplicate set numbers
    const setNumbers = [...new Set([...inventorySetNumbers, ...seededSetNumbers])];
    const total = setNumbers.length;
    console.log(`[BrickLinkArbitrageSyncService.syncPricing] Found ${total} unique set numbers to sync`);

    let updated = 0;
    let failed = 0;
    const today = new Date().toISOString().split('T')[0];

    for (let i = 0; i < setNumbers.length; i++) {
      const setNumber = setNumbers[i];

      try {
        // Fetch UK-filtered price guide for aggregate prices (min/avg/max)
        // Note: BrickLink uses "UK" NOT ISO standard "GB" for United Kingdom
        // Note: country_code filter gives UK-only aggregate prices but removes price_detail
        const ukPriceGuide = await client.getSetPriceGuide(setNumber, {
          condition: 'N',
          countryCode: 'UK',
          currencyCode: 'GBP',
        });

        // Also fetch global price guide to get price_detail for breakdown display
        // We use UK aggregate prices but global price_detail (UI highlights UK sellers)
        const globalPriceGuide = await client.getSetPriceGuide(setNumber, {
          condition: 'N',
          currencyCode: 'GBP',
        });

        // Debug: Log UK prices
        if (i < 3) {
          console.log(`[BrickLinkArbitrageSyncService] ${setNumber} UK: min=${ukPriceGuide.min_price}, lots=${ukPriceGuide.unit_quantity}`);
        }

        // Process global price details - sort by price, keep all sellers
        const priceDetails = this.processPriceDetails(globalPriceGuide.price_detail);

        // Store UK-only pricing snapshot with global price_detail for breakdown
        // Note: BrickLink uses "UK" not ISO standard "GB"
        const { error: insertError } = await this.supabase
          .from('bricklink_arbitrage_pricing')
          .upsert({
            user_id: userId,
            bricklink_set_number: setNumber,
            snapshot_date: today,
            condition: 'N',
            country_code: 'UK',
            min_price: ukPriceGuide.min_price ? parseFloat(ukPriceGuide.min_price) : null,
            avg_price: ukPriceGuide.avg_price ? parseFloat(ukPriceGuide.avg_price) : null,
            max_price: ukPriceGuide.max_price ? parseFloat(ukPriceGuide.max_price) : null,
            qty_avg_price: ukPriceGuide.qty_avg_price ? parseFloat(ukPriceGuide.qty_avg_price) : null,
            total_lots: ukPriceGuide.unit_quantity,
            total_qty: ukPriceGuide.total_quantity,
            price_detail_json: priceDetails as unknown as Json, // Global price_detail for breakdown (UI highlights UK)
          }, {
            onConflict: 'user_id,bricklink_set_number,snapshot_date,condition,country_code',
          });

        if (insertError) {
          console.error(`[BrickLinkArbitrageSyncService.syncPricing] Error storing pricing for ${setNumber}:`, insertError);
          failed++;
        } else {
          updated++;
        }
      } catch (err) {
        if (err instanceof RateLimitError) {
          console.error('[BrickLinkArbitrageSyncService.syncPricing] Rate limit exceeded, stopping sync');
          // Update sync status with error
          await this.updateSyncStatus(userId, {
            status: 'failed',
            itemsProcessed: updated,
            itemsFailed: failed + (setNumbers.length - i),
            durationMs: Date.now() - startTime,
            errorMessage: 'BrickLink API rate limit exceeded',
          });
          throw err;
        }

        if (err instanceof BrickLinkApiError && err.code === 404) {
          console.log(`[BrickLinkArbitrageSyncService.syncPricing] Set ${setNumber} not found in BrickLink`);
        } else {
          console.error(`[BrickLinkArbitrageSyncService.syncPricing] Error fetching pricing for ${setNumber}:`, err);
        }
        failed++;
      }

      // Rate limit
      await this.delay(RATE_LIMIT_DELAY);

      // Report progress
      onProgress?.(i + 1, total);
    }

    const duration = Date.now() - startTime;
    console.log(`[BrickLinkArbitrageSyncService.syncPricing] Completed in ${duration}ms: ${updated} updated, ${failed} failed`);

    // Update sync status
    await this.updateSyncStatus(userId, {
      status: 'completed',
      itemsProcessed: updated,
      itemsFailed: failed,
      durationMs: duration,
    });

    return { updated, failed, total };
  }

  /**
   * Sync pricing for a single set number
   * Uses UK country filter to get UK-only aggregate prices
   * Also fetches global price_detail for breakdown display (UI highlights UK sellers)
   */
  async syncSingleSet(
    userId: string,
    setNumber: string
  ): Promise<BrickLinkPriceGuide> {
    const client = await this.getClient(userId);
    const today = new Date().toISOString().split('T')[0];

    // Fetch UK-filtered price guide for aggregate prices (min/avg/max)
    // Note: BrickLink uses "UK" NOT ISO standard "GB" for United Kingdom
    const ukPriceGuide = await client.getSetPriceGuide(setNumber, {
      condition: 'N',
      countryCode: 'UK',
      currencyCode: 'GBP',
    });

    // Also fetch global price guide to get price_detail for breakdown display
    const globalPriceGuide = await client.getSetPriceGuide(setNumber, {
      condition: 'N',
      currencyCode: 'GBP',
    });

    // Process global price details - sort by price, keep all sellers
    const priceDetails = this.processPriceDetails(globalPriceGuide.price_detail);

    // Store UK-only pricing snapshot with global price_detail for breakdown
    // Note: BrickLink uses "UK" not ISO standard "GB"
    await this.supabase
      .from('bricklink_arbitrage_pricing')
      .upsert({
        user_id: userId,
        bricklink_set_number: setNumber,
        snapshot_date: today,
        condition: 'N',
        country_code: 'UK',
        min_price: ukPriceGuide.min_price ? parseFloat(ukPriceGuide.min_price) : null,
        avg_price: ukPriceGuide.avg_price ? parseFloat(ukPriceGuide.avg_price) : null,
        max_price: ukPriceGuide.max_price ? parseFloat(ukPriceGuide.max_price) : null,
        qty_avg_price: ukPriceGuide.qty_avg_price ? parseFloat(ukPriceGuide.qty_avg_price) : null,
        total_lots: ukPriceGuide.unit_quantity,
        total_qty: ukPriceGuide.total_quantity,
        price_detail_json: priceDetails as unknown as Json, // Global price_detail for breakdown (UI highlights UK)
      }, {
        onConflict: 'user_id,bricklink_set_number,snapshot_date,condition,country_code',
      });

    return ukPriceGuide;
  }

  /**
   * Get latest BrickLink pricing for a set
   */
  async getLatestPricing(
    userId: string,
    setNumber: string
  ): Promise<{
    minPrice: number | null;
    avgPrice: number | null;
    maxPrice: number | null;
    totalLots: number | null;
    totalQty: number | null;
    priceDetails: BrickLinkPriceDetail[] | null;
    snapshotDate: string | null;
  } | null> {
    const { data, error } = await this.supabase
      .from('bricklink_arbitrage_pricing')
      .select('*')
      .eq('user_id', userId)
      .eq('bricklink_set_number', setNumber)
      .eq('condition', 'N')
      .eq('country_code', 'UK')
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
      totalLots: data.total_lots,
      totalQty: data.total_qty,
      priceDetails: data.price_detail_json as BrickLinkPriceDetail[] | null,
      snapshotDate: data.snapshot_date,
    };
  }

  /**
   * Process price details - sort by price, keep all sellers
   * UI will highlight UK sellers
   */
  private processPriceDetails(
    details: BrickLinkPriceDetail[] | undefined
  ): BrickLinkPriceDetail[] | null {
    if (!details || details.length === 0) {
      return null;
    }

    // Sort by price ascending, UK sellers first at each price point
    return details
      .map((d) => ({
        quantity: d.quantity,
        unit_price: d.unit_price,
        shipping_available: d.shipping_available,
        seller_country_code: d.seller_country_code,
      }))
      .sort((a, b) => {
        const priceDiff = parseFloat(a.unit_price) - parseFloat(b.unit_price);
        if (priceDiff !== 0) return priceDiff;
        // GB (UK) sellers first at same price
        if (a.seller_country_code === 'UK' && b.seller_country_code !== 'GB') return -1;
        if (a.seller_country_code !== 'GB' && b.seller_country_code === 'UK') return 1;
        return 0;
      });
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
    await this.supabase
      .from('arbitrage_sync_status')
      .upsert({
        user_id: userId,
        job_type: 'bricklink_pricing',
        status: data.status,
        last_run_at: new Date().toISOString(),
        last_success_at: data.status === 'completed' ? new Date().toISOString() : undefined,
        last_run_duration_ms: data.durationMs,
        items_processed: data.itemsProcessed,
        items_failed: data.itemsFailed,
        error_message: data.errorMessage ?? null,
      }, {
        onConflict: 'user_id,job_type',
      });
  }

  /**
   * Delay helper
   */
  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
