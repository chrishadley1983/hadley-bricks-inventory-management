/**
 * Amazon Arbitrage Sync Service
 *
 * Handles syncing Amazon inventory ASINs and pricing data for arbitrage tracking.
 * Uses the correct SP-API endpoints:
 * - Reports API (GET_MERCHANT_LISTINGS_ALL_DATA) for inventory ASINs
 * - Product Pricing API for competitive pricing data
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@hadley-bricks/database';
import type { AmazonCredentials } from '../amazon';
import { createAmazonPricingClient, type AsinCompetitiveSummaryData } from '../amazon';
import { createAmazonReportsClient } from '../platform-stock/amazon/amazon-reports.client';
import { CredentialsRepository } from '../repositories';

const UK_MARKETPLACE_ID = 'A1F83G8C2ARO7P';
const BATCH_SIZE = 20; // Amazon allows up to 20 ASINs per batch for pricing
const RATE_LIMIT_DELAY = 500; // ms between API calls

/**
 * Parsed inventory item from merchant listings report
 */
interface MerchantListingItem {
  asin: string;
  sellerSku: string;
  productName: string;
  price: number | null;
  quantity: number;
  imageUrl?: string;
  openDate?: string;
  itemCondition?: string;
  status?: string;
}

/**
 * Service for syncing Amazon data for arbitrage tracking
 */
export class AmazonArbitrageSyncService {
  private credentialsRepo: CredentialsRepository;

  constructor(private supabase: SupabaseClient<Database>) {
    this.credentialsRepo = new CredentialsRepository(supabase);
  }

  /**
   * Get Amazon credentials for a user
   */
  private async getCredentials(userId: string): Promise<AmazonCredentials> {
    const credentials = await this.credentialsRepo.getCredentials<AmazonCredentials>(
      userId,
      'amazon'
    );

    if (!credentials) {
      throw new Error('Amazon credentials not configured');
    }

    return credentials;
  }

  /**
   * Sync inventory ASINs from Amazon to tracked_asins table
   * Uses GET_MERCHANT_LISTINGS_ALL_DATA report to get all ASINs
   */
  async syncInventoryAsins(
    userId: string,
    onProgress?: (processed: number, total: number) => void
  ): Promise<{ added: number; updated: number; total: number }> {
    console.log('[AmazonArbitrageSyncService.syncInventoryAsins] Starting sync for user:', userId);
    const startTime = Date.now();

    const credentials = await this.getCredentials(userId);
    const reportsClient = createAmazonReportsClient(credentials);

    // Fetch merchant listings report
    console.log('[AmazonArbitrageSyncService.syncInventoryAsins] Fetching merchant listings report...');
    const reportContent = await reportsClient.fetchMerchantListingsReport([UK_MARKETPLACE_ID]);

    // Parse TSV report
    const rawInventoryItems = this.parseMerchantListingsReport(reportContent);
    console.log(`[AmazonArbitrageSyncService.syncInventoryAsins] Parsed ${rawInventoryItems.length} inventory items`);

    // Deduplicate by ASIN - keep first occurrence (same ASIN may have multiple SKUs)
    const seenAsins = new Set<string>();
    const inventoryItems = rawInventoryItems.filter((item) => {
      if (seenAsins.has(item.asin)) {
        return false;
      }
      seenAsins.add(item.asin);
      return true;
    });
    const total = inventoryItems.length;
    console.log(`[AmazonArbitrageSyncService.syncInventoryAsins] After deduplication: ${total} unique ASINs`);

    let added = 0;
    let updated = 0;

    // Process items in batches for efficiency
    const UPSERT_BATCH_SIZE = 100;
    const batches = this.chunkArray(inventoryItems, UPSERT_BATCH_SIZE);

    for (let batchIndex = 0; batchIndex < batches.length; batchIndex++) {
      const batch = batches[batchIndex];
      const now = new Date().toISOString();

      // Prepare upsert data
      const upsertData = batch.map((item) => ({
        asin: item.asin,
        user_id: userId,
        source: 'inventory' as const,
        status: 'active' as const,
        name: item.productName,
        image_url: item.imageUrl ?? null,
        sku: item.sellerSku,
        quantity: item.quantity ?? 0,
        price: item.price ?? null,
        last_synced_at: now,
      }));

      // Check which ASINs already exist
      const asins = batch.map((item) => item.asin);
      const { data: existing } = await this.supabase
        .from('tracked_asins')
        .select('asin')
        .eq('user_id', userId)
        .in('asin', asins);

      const existingSet = new Set(existing?.map((e) => e.asin) ?? []);

      // Upsert all items
      const { error } = await this.supabase
        .from('tracked_asins')
        .upsert(upsertData, {
          onConflict: 'user_id,asin',
        });

      if (error) {
        console.error('[AmazonArbitrageSyncService.syncInventoryAsins] Upsert error:', error);
      } else {
        // Count added vs updated
        for (const item of batch) {
          if (existingSet.has(item.asin)) {
            updated++;
          } else {
            added++;
          }
        }
      }

      // Report progress
      const processed = Math.min((batchIndex + 1) * UPSERT_BATCH_SIZE, total);
      onProgress?.(processed, total);
    }

    const duration = Date.now() - startTime;
    console.log(`[AmazonArbitrageSyncService.syncInventoryAsins] Completed in ${duration}ms: ${added} added, ${updated} updated`);

    // Update sync status
    await this.updateSyncStatus(userId, 'inventory_asins', {
      status: 'completed',
      itemsProcessed: total,
      itemsFailed: 0,
      durationMs: duration,
    });

    return { added, updated, total };
  }

  /**
   * Sync Amazon pricing data for all active tracked ASINs
   * Uses Product Pricing API for competitive pricing and competitive summary for WasPrice/offers
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
    console.log('[AmazonArbitrageSyncService.syncPricing] Starting pricing sync for user:', userId);
    const startTime = Date.now();

    const credentials = await this.getCredentials(userId);
    const pricingClient = createAmazonPricingClient(credentials);

    // Get all active tracked ASINs (including quantity for your_qty)
    const { data: trackedAsins, error } = await this.supabase
      .from('tracked_asins')
      .select('asin, sku, quantity')
      .eq('user_id', userId)
      .eq('status', 'active');

    if (error) {
      throw new Error(`Failed to fetch tracked ASINs: ${error.message}`);
    }

    // Get seeded ASINs if enabled
    let seededAsins: { asin: string }[] = [];
    if (options.includeSeeded !== false) {
      const { data: seededData, error: seededError } = await this.supabase
        .from('user_seeded_asin_preferences')
        .select(`
          seeded_asins!inner(asin),
          manual_asin_override
        `)
        .eq('user_id', userId)
        .eq('include_in_sync', true)
        .eq('user_status', 'active');

      if (!seededError && seededData) {
        seededAsins = seededData
          .map((p) => {
            const sa = p.seeded_asins as unknown as { asin: string | null };
            return { asin: p.manual_asin_override ?? sa?.asin };
          })
          .filter((a): a is { asin: string } => a.asin !== null && a.asin !== undefined);

        console.log(`[AmazonArbitrageSyncService.syncPricing] Found ${seededAsins.length} seeded ASINs to sync`);
      }
    }

    // Create quantity lookup map from tracked ASINs
    const quantityMap = new Map<string, number>();
    for (const ta of trackedAsins ?? []) {
      quantityMap.set(ta.asin, ta.quantity ?? 0);
    }

    // Combine and deduplicate ASINs
    const allAsins = [
      ...(trackedAsins ?? []).map((a) => a.asin),
      ...seededAsins.map((a) => a.asin),
    ];
    const uniqueAsins = [...new Set(allAsins)].map((asin) => ({ asin }));

    const total = uniqueAsins.length;
    let updated = 0;
    let failed = 0;
    const today = new Date().toISOString().split('T')[0];

    // Process in batches (max 20 ASINs per request)
    const batches = this.chunkArray(uniqueAsins, BATCH_SIZE);

    for (let batchIndex = 0; batchIndex < batches.length; batchIndex++) {
      const batch = batches[batchIndex];
      const asins = batch.map((item) => item.asin);

      try {
        // Fetch competitive pricing for batch (v0 API - faster, basic pricing)
        const pricingData = await pricingClient.getCompetitivePricing(asins, UK_MARKETPLACE_ID);

        // Fetch competitive summary for batch (v2022-05-01 API - WasPrice, offers)
        let summaryData: AsinCompetitiveSummaryData[] = [];
        try {
          summaryData = await pricingClient.getCompetitiveSummary(asins, UK_MARKETPLACE_ID);
        } catch (summaryErr) {
          console.warn(`[AmazonArbitrageSyncService.syncPricing] Could not fetch competitive summary:`, summaryErr);
          // Continue without summary data - we'll use basic pricing only
        }

        // Create lookup map for summary data
        const summaryMap = new Map<string, AsinCompetitiveSummaryData>();
        for (const summary of summaryData) {
          summaryMap.set(summary.asin, summary);
        }

        // Store pricing snapshots with extended data
        const upsertData = pricingData.map((pricing) => {
          const summary = summaryMap.get(pricing.asin);
          const lowestOffer = summary?.lowestOffer;

          return {
            user_id: userId,
            asin: pricing.asin,
            snapshot_date: today,
            your_price: pricing.yourPrice,
            your_qty: quantityMap.get(pricing.asin) ?? 0,
            buy_box_price: pricing.buyBoxPrice,
            buy_box_is_yours: pricing.buyBoxIsYours,
            offer_count: (pricing.newOfferCount ?? 0) + (pricing.usedOfferCount ?? 0),
            sales_rank: pricing.salesRank,
            sales_rank_category: pricing.salesRankCategory,
            // New fields from competitive summary
            was_price_90d: summary?.wasPrice ?? null,
            lowest_offer_price: lowestOffer?.totalPrice ?? null,
            price_is_lowest_offer: pricing.buyBoxPrice === null && lowestOffer !== null,
            lowest_offer_seller_id: lowestOffer?.sellerId ?? null,
            lowest_offer_is_fba: lowestOffer ? lowestOffer.fulfillmentType === 'AFN' : null,
            lowest_offer_is_prime: lowestOffer?.isPrime ?? null,
            offers_json: summary?.offers ? JSON.stringify(summary.offers) : null,
            total_offer_count: summary?.totalOfferCount ?? null,
            competitive_price: summary?.competitivePrice ?? null,
          };
        });

        const { error: insertError } = await this.supabase
          .from('amazon_arbitrage_pricing')
          .upsert(upsertData, {
            onConflict: 'asin,snapshot_date',
          });

        if (insertError) {
          console.error(`[AmazonArbitrageSyncService.syncPricing] Error storing pricing:`, insertError);
          failed += batch.length;
        } else {
          updated += pricingData.length;
        }
      } catch (err) {
        console.error(`[AmazonArbitrageSyncService.syncPricing] Error processing batch ${batchIndex}:`, err);
        failed += batch.length;
      }

      // Rate limit (longer delay because we're calling 2 APIs)
      await this.delay(RATE_LIMIT_DELAY * 2);

      // Report progress
      const processed = Math.min((batchIndex + 1) * BATCH_SIZE, total);
      onProgress?.(processed, total);
    }

    const duration = Date.now() - startTime;
    console.log(`[AmazonArbitrageSyncService.syncPricing] Completed in ${duration}ms: ${updated} updated, ${failed} failed`);

    // Update sync status
    await this.updateSyncStatus(userId, 'amazon_pricing', {
      status: 'completed',
      itemsProcessed: updated,
      itemsFailed: failed,
      durationMs: duration,
    });

    return { updated, failed, total };
  }

  /**
   * Parse GET_MERCHANT_LISTINGS_ALL_DATA TSV report
   * Report columns (tab-separated):
   * item-name, item-description, listing-id, seller-sku, price, quantity,
   * open-date, image-url, item-is-marketplace, product-id-type, zshop-shipping-fee,
   * item-note, item-condition, zshop-category1, zshop-browse-path, zshop-storefront-feature,
   * asin1, asin2, asin3, will-ship-internationally, expedited-shipping, zshop-boldface,
   * product-id, bid-for-featured-placement, add-delete, pending-quantity,
   * fulfillment-channel, merchant-shipping-group, status
   */
  private parseMerchantListingsReport(content: string): MerchantListingItem[] {
    const lines = content.split('\n');
    if (lines.length < 2) {
      return [];
    }

    // Parse header to find column indices
    const headers = lines[0].split('\t').map((h) => h.trim().toLowerCase());
    const columnIndex: Record<string, number> = {};
    headers.forEach((header, index) => {
      columnIndex[header] = index;
    });

    const items: MerchantListingItem[] = [];

    // Parse data rows (skip header)
    for (let i = 1; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;

      const columns = line.split('\t');

      // Get ASIN (could be in asin1, asin, or product-id column)
      const asin =
        this.getColumn(columns, columnIndex, 'asin1') ||
        this.getColumn(columns, columnIndex, 'asin') ||
        this.getColumn(columns, columnIndex, 'product-id');

      if (!asin) continue;

      const priceStr = this.getColumn(columns, columnIndex, 'price');
      const quantityStr = this.getColumn(columns, columnIndex, 'quantity');

      items.push({
        asin,
        sellerSku: this.getColumn(columns, columnIndex, 'seller-sku') || '',
        productName: this.getColumn(columns, columnIndex, 'item-name') || asin,
        price: priceStr ? parseFloat(priceStr) : null,
        quantity: quantityStr ? parseInt(quantityStr, 10) : 0,
        imageUrl: this.getColumn(columns, columnIndex, 'image-url') || undefined,
        openDate: this.getColumn(columns, columnIndex, 'open-date') || undefined,
        itemCondition: this.getColumn(columns, columnIndex, 'item-condition') || undefined,
        status: this.getColumn(columns, columnIndex, 'status') || undefined,
      });
    }

    return items;
  }

  /**
   * Get column value by header name
   */
  private getColumn(
    columns: string[],
    columnIndex: Record<string, number>,
    headerName: string
  ): string {
    const index = columnIndex[headerName];
    if (index === undefined || index >= columns.length) {
      return '';
    }
    return columns[index].trim();
  }

  /**
   * Update sync status
   */
  private async updateSyncStatus(
    userId: string,
    jobType: 'inventory_asins' | 'amazon_pricing',
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
        job_type: jobType,
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
   * Split array into chunks
   */
  private chunkArray<T>(array: T[], size: number): T[][] {
    const chunks: T[][] = [];
    for (let i = 0; i < array.length; i += size) {
      chunks.push(array.slice(i, i + size));
    }
    return chunks;
  }

  /**
   * Delay helper
   */
  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
