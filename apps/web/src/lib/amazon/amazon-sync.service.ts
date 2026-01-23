/**
 * Amazon Sync Service
 *
 * Manages the sync queue, feed submission, and result processing
 * for pushing price and quantity updates to Amazon.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@hadley-bricks/database';
import type { AmazonCredentials } from './types';
import { CredentialsRepository } from '@/lib/repositories/credentials.repository';
import { AmazonFeedsClient } from './amazon-feeds.client';
import { AmazonListingsClient } from './amazon-listings.client';
import { AmazonCatalogClient, type ProductTypeResult } from './amazon-catalog.client';
import type {
  AmazonSyncQueueRow,
  AmazonSyncFeedRow,
  AmazonSyncFeedItemRow,
  QueueItemWithDetails,
  AggregatedQueueItem,
  SyncFeed,
  SyncFeedWithDetails,
  FeedStatus,
  FeedItemStatus,
  ListingsFeedPayload,
  ListingsFeedMessage,
  ListingsFeedPatch,
  FeedProcessingReport,
  ListingsValidationResult,
  PriceConflict,
  TwoPhaseResult,
  TwoPhaseStepResult,
} from './amazon-sync.types';
import { TWO_PHASE_DEFAULTS } from './amazon-sync.types';
import { emailService } from '@/lib/email';
import { pushoverService } from '@/lib/notifications';

// Re-export constants
export { UK_MARKETPLACE_ID, DEFAULT_PRODUCT_TYPE, PRODUCT_TYPE_CACHE_TTL_DAYS } from './amazon-sync.types';
import {
  DEFAULT_PRODUCT_TYPE,
  PRODUCT_TYPE_CACHE_TTL_DAYS,
  VERIFICATION_TIMEOUT_MS,
} from './amazon-sync.types';

// Variation configuration for testing price payload fixes
import {
  buildPurchasableOffer,
  logVariationConfig,
  PRICE_PAYLOAD_VARIATION,
} from './amazon-sync.config';

// ============================================================================
// TYPES
// ============================================================================

type InventoryItemRow = Database['public']['Tables']['inventory_items']['Row'];
type PlatformListingRow = Database['public']['Tables']['platform_listings']['Row'];
type AmazonProductCacheRow = Database['public']['Tables']['amazon_product_cache']['Row'];

/**
 * Result of attempting to add an item to the queue
 */
export interface AddToQueueResult {
  success: boolean;
  item?: AmazonSyncQueueRow;
  priceConflict?: PriceConflict;
  error?: string;
}

// ============================================================================
// SERVICE CLASS
// ============================================================================

/**
 * Amazon Sync Service
 *
 * Handles queue management, feed submission, polling, and result processing.
 */
export class AmazonSyncService {
  private supabase: SupabaseClient<Database>;
  private userId: string;
  private credentialsRepo: CredentialsRepository;

  constructor(supabase: SupabaseClient<Database>, userId: string) {
    this.supabase = supabase;
    this.userId = userId;
    this.credentialsRepo = new CredentialsRepository(supabase);

    // Log variation configuration for debugging price=0 issue
    logVariationConfig();
  }

  // ==========================================================================
  // QUEUE MANAGEMENT
  // ==========================================================================

  /**
   * Add an inventory item to the sync queue
   *
   * Validates that the item's price matches:
   * 1. Other items in the queue with the same ASIN
   * 2. The existing Amazon listing price (if one exists) - queried LIVE from Amazon API
   *
   * @param inventoryItemId - ID of the inventory item to queue
   * @param skipConflictCheck - If true, skips price conflict validation (use after user confirms)
   * @returns Result with either the created queue item or price conflict info
   */
  async addToQueue(inventoryItemId: string, skipConflictCheck: boolean = false): Promise<AddToQueueResult> {
    console.log('\n========================================');
    console.log('[AmazonSyncService] ADD TO QUEUE - START');
    console.log('========================================');
    console.log(`[AmazonSyncService] Inventory Item ID: ${inventoryItemId}`);

    // 1. Get inventory item
    const { data: inventoryItem, error: inventoryError } = await this.supabase
      .from('inventory_items')
      .select('*')
      .eq('id', inventoryItemId)
      .eq('user_id', this.userId)
      .single();

    if (inventoryError || !inventoryItem) {
      console.error('[AmazonSyncService] ERROR: Inventory item not found');
      return { success: false, error: 'Inventory item not found' };
    }

    console.log('[AmazonSyncService] Inventory Item Found:');
    console.log(`  - Set Number: ${inventoryItem.set_number}`);
    console.log(`  - Item Name: ${inventoryItem.item_name}`);
    console.log(`  - ASIN: ${inventoryItem.amazon_asin}`);
    console.log(`  - Listing Value (local price): £${inventoryItem.listing_value}`);
    console.log(`  - Condition: ${inventoryItem.condition}`);
    console.log(`  - Status: ${inventoryItem.status}`);

    // 2. Validate required fields
    if (!inventoryItem.amazon_asin) {
      console.error('[AmazonSyncService] ERROR: No Amazon ASIN');
      return { success: false, error: 'Inventory item has no Amazon ASIN' };
    }
    if (inventoryItem.listing_value === null) {
      console.error('[AmazonSyncService] ERROR: No listing value');
      return { success: false, error: 'Inventory item has no listing value (price)' };
    }

    // 3. Validate status - only BACKLOG items can be added to sync queue
    const status = inventoryItem.status?.toUpperCase();
    if (status !== 'BACKLOG') {
      console.error(`[AmazonSyncService] ERROR: Invalid status '${inventoryItem.status}' - only Backlog items allowed`);
      return { success: false, error: `Only items with Backlog status can be added to the sync queue (current status: ${inventoryItem.status || 'none'})` };
    }

    const localPrice = inventoryItem.listing_value;
    console.log(`[AmazonSyncService] Local price to sync: £${localPrice.toFixed(2)}`);

    // 4. Look up Amazon listing from local cache to get seller SKU
    console.log('[AmazonSyncService] Checking local platform_listings cache...');
    const cachedListing = await this.getLatestAmazonListing(
      inventoryItem.amazon_asin
    );

    // Determine the Amazon SKU - use existing listing SKU or generate a new one
    let amazonSku: string;
    let amazonPrice: number | null = null;
    let amazonQuantity: number | null = null;
    let isNewSku = false;

    if (cachedListing && cachedListing.platform_sku) {
      // Use existing SKU from platform_listings cache
      amazonSku = cachedListing.platform_sku;
      console.log(`[AmazonSyncService] Found cached listing with SKU: ${amazonSku}`);
      console.log(`[AmazonSyncService] Cached listing data:`);
      console.log(`  - Platform SKU: ${cachedListing.platform_sku}`);
      console.log(`  - Platform Item ID (ASIN): ${cachedListing.platform_item_id}`);
      console.log(`  - Price (cached): ${cachedListing.price}`);
      console.log(`  - Quantity (cached): ${cachedListing.quantity}`);

      // 4a. Query Amazon API directly for LIVE price and quantity
      console.log('[AmazonSyncService] Querying Amazon API for LIVE data...');
      const credentials = await this.getAmazonCredentials();
      if (credentials) {
        const listingsClient = new AmazonListingsClient(credentials);
        const liveListing = await listingsClient.getListing(
          amazonSku,
          'A1F83G8C2ARO7P',
          ['offers', 'fulfillmentAvailability']
        );

        console.log('[AmazonSyncService] Amazon API Response:');
        console.log(JSON.stringify(liveListing, null, 2));

        if (liveListing) {
          // Extract live price from Amazon
          const offer = liveListing.offers?.find(
            (o) => o.marketplaceId === 'A1F83G8C2ARO7P'
          );
          console.log('[AmazonSyncService] Offer found:');
          console.log(JSON.stringify(offer, null, 2));

          if (offer?.price?.amount) {
            // Amazon API returns price as string, parse to number
            amazonPrice = typeof offer.price.amount === 'string'
              ? parseFloat(offer.price.amount)
              : offer.price.amount;
            console.log(`[AmazonSyncService] Extracted price from offer.price.amount: £${amazonPrice}`);
          } else {
            console.log('[AmazonSyncService] No price found in offer.price.amount');
          }

          // Extract live quantity from Amazon
          const fulfillment = liveListing.fulfillmentAvailability?.find(
            (f) => f.fulfillmentChannelCode === 'DEFAULT'
          );
          console.log('[AmazonSyncService] Fulfillment found:');
          console.log(JSON.stringify(fulfillment, null, 2));

          if (fulfillment?.quantity !== undefined) {
            amazonQuantity = fulfillment.quantity;
            console.log(`[AmazonSyncService] Extracted quantity from fulfillment: ${amazonQuantity}`);
          } else {
            console.log('[AmazonSyncService] No quantity found in fulfillment');
          }

          console.log('[AmazonSyncService] ----------------------------------------');
          console.log(`[AmazonSyncService] LIVE Amazon data summary for ${amazonSku}:`);
          console.log(`  - Live Price: ${amazonPrice !== null ? `£${amazonPrice}` : 'NOT FOUND'}`);
          console.log(`  - Live Quantity: ${amazonQuantity !== null ? amazonQuantity : 'NOT FOUND'}`);
          console.log('[AmazonSyncService] ----------------------------------------');
        } else {
          console.log('[AmazonSyncService] WARNING: No live listing data returned from Amazon API');
        }
      } else {
        console.log('[AmazonSyncService] WARNING: No Amazon credentials found, skipping live data fetch');
      }

      // 4b. Check if local price differs from existing Amazon price
      if (!skipConflictCheck && amazonPrice !== null && Math.abs(amazonPrice - localPrice) > 0.01) {
        console.error('[AmazonSyncService] PRICE CONFLICT DETECTED!');
        console.error(`  - Local Price: £${localPrice.toFixed(2)}`);
        console.error(`  - Amazon Price: £${amazonPrice.toFixed(2)}`);
        console.error(`  - Difference: £${Math.abs(amazonPrice - localPrice).toFixed(2)}`);
        return {
          success: false,
          priceConflict: {
            type: 'amazon',
            inventoryItemId,
            asin: inventoryItem.amazon_asin,
            setNumber: inventoryItem.set_number,
            itemName: inventoryItem.item_name,
            localPrice,
            conflictPrice: amazonPrice,
          },
        };
      }
    } else {
      // No local cache entry found - BUT we should check Amazon API first
      // This handles cases where SKU was created via the app but not yet cached
      console.log('[AmazonSyncService] No local cache entry found - checking Amazon API for existing listings...');

      const credentials = await this.getAmazonCredentials();
      if (credentials) {
        const listingsClient = new AmazonListingsClient(credentials);
        const existingListings = await listingsClient.findListingsByAsin(
          inventoryItem.amazon_asin,
          'A1F83G8C2ARO7P'
        );

        if (existingListings.length > 0) {
          // Found existing listing on Amazon! Use that SKU instead of generating new one
          const existingListing = existingListings[0]; // Use first found listing
          amazonSku = existingListing.sku;
          // Parse price - API may return string or number
          amazonPrice = existingListing.price !== undefined
            ? (typeof existingListing.price === 'string' ? parseFloat(existingListing.price) : existingListing.price)
            : null;
          amazonQuantity = existingListing.quantity ?? null;
          isNewSku = false; // This is NOT a new SKU - we found it on Amazon
          console.log(`[AmazonSyncService] FOUND EXISTING LISTING ON AMAZON!`);
          console.log(`  - SKU: ${amazonSku}`);
          console.log(`  - Price: ${amazonPrice !== null ? `£${amazonPrice}` : 'N/A'}`);
          console.log(`  - Quantity: ${amazonQuantity ?? 'N/A'}`);
          console.log('[AmazonSyncService] Will use PATCH operation (existing SKU)');

          // Note: We don't cache to platform_listings here as that table requires
          // an import_id foreign key. The API query approach (Option B) is sufficient
          // since we query Amazon directly when the cache is empty.

          // Check for price conflict with existing Amazon listing
          if (!skipConflictCheck && amazonPrice !== null && Math.abs(amazonPrice - localPrice) > 0.01) {
            console.error('[AmazonSyncService] PRICE CONFLICT DETECTED (from API lookup)!');
            console.error(`  - Local Price: £${localPrice.toFixed(2)}`);
            console.error(`  - Amazon Price: £${amazonPrice.toFixed(2)}`);
            return {
              success: false,
              priceConflict: {
                type: 'amazon',
                inventoryItemId,
                asin: inventoryItem.amazon_asin,
                setNumber: inventoryItem.set_number,
                itemName: inventoryItem.item_name,
                localPrice,
                conflictPrice: amazonPrice,
              },
            };
          }
        } else {
          // No existing listing found on Amazon - generate new SKU
          amazonSku = this.generateSellerSku(inventoryItem.amazon_asin);
          isNewSku = true; // Mark as new SKU - will use UPDATE operation
          console.log(`[AmazonSyncService] No existing listing on Amazon - generating new SKU: ${amazonSku}`);
          console.log('[AmazonSyncService] This will be treated as a NEW listing (isNewSku=true)');
        }
      } else {
        // No credentials - fall back to generating new SKU
        amazonSku = this.generateSellerSku(inventoryItem.amazon_asin);
        isNewSku = true;
        console.log('[AmazonSyncService] No Amazon credentials - generating new SKU (treating as new)');
      }
    }

    // 4c. Check if there are other items in queue with same ASIN but different price
    console.log('[AmazonSyncService] Checking for price conflicts with other queued items...');
    const { data: existingQueueItems } = await this.supabase
      .from('amazon_sync_queue')
      .select('local_price, inventory_item_id')
      .eq('user_id', this.userId)
      .eq('asin', inventoryItem.amazon_asin);

    if (!skipConflictCheck && existingQueueItems && existingQueueItems.length > 0) {
      console.log(`[AmazonSyncService] Found ${existingQueueItems.length} other items in queue with same ASIN`);
      const conflictingItem = existingQueueItems.find(
        (item) => Math.abs(item.local_price - localPrice) > 0.01
      );
      if (conflictingItem) {
        console.error('[AmazonSyncService] QUEUE PRICE CONFLICT DETECTED!');
        return {
          success: false,
          priceConflict: {
            type: 'queue',
            inventoryItemId,
            asin: inventoryItem.amazon_asin,
            setNumber: inventoryItem.set_number,
            itemName: inventoryItem.item_name,
            localPrice,
            conflictPrice: conflictingItem.local_price,
            conflictingQueueItemId: conflictingItem.inventory_item_id,
          },
        };
      }
    } else if (!skipConflictCheck) {
      console.log('[AmazonSyncService] No other items in queue with same ASIN');
    }

    // 5. Get product type for this ASIN (with caching)
    console.log('[AmazonSyncService] Getting product type from cache/API...');
    const productType = await this.getProductTypeForAsin(
      inventoryItem.amazon_asin,
      'A1F83G8C2ARO7P'
    );
    console.log(`[AmazonSyncService] Product type: ${productType}`);

    // 6. Create queue entry
    console.log('[AmazonSyncService] Creating queue entry...');
    const queueItem: Database['public']['Tables']['amazon_sync_queue']['Insert'] =
      {
        user_id: this.userId,
        inventory_item_id: inventoryItemId,
        sku: inventoryItem.sku || inventoryItem.amazon_asin,
        asin: inventoryItem.amazon_asin,
        local_price: localPrice,
        local_quantity: 1,
        amazon_sku: amazonSku,
        amazon_price: amazonPrice,
        amazon_quantity: amazonQuantity,
        product_type: productType,
        is_new_sku: isNewSku,
      };

    console.log('[AmazonSyncService] Queue entry to insert:');
    console.log(JSON.stringify(queueItem, null, 2));

    // 7. Insert queue entry
    const { data, error } = await this.supabase
      .from('amazon_sync_queue')
      .insert(queueItem)
      .select()
      .single();

    if (error) {
      if (error.code === '23505') {
        console.error('[AmazonSyncService] ERROR: Item already in queue');
        return { success: false, error: 'Item is already in the sync queue' };
      }
      console.error('[AmazonSyncService] ERROR inserting queue item:', error);
      return { success: false, error: `Failed to add to queue: ${error.message}` };
    }

    if (!data) {
      console.error('[AmazonSyncService] ERROR: Insert returned no data');
      return { success: false, error: 'Insert returned no data - RLS may be blocking the operation' };
    }

    console.log('[AmazonSyncService] Queue entry created successfully:');
    console.log(`  - Queue ID: ${data.id}`);
    console.log(`  - Amazon SKU: ${data.amazon_sku}`);
    console.log(`  - Local Price: £${data.local_price}`);
    console.log(`  - Amazon Price: ${data.amazon_price !== null ? `£${data.amazon_price}` : 'null'}`);
    console.log(`  - Amazon Quantity: ${data.amazon_quantity}`);
    console.log(`  - Is New SKU: ${data.is_new_sku}`);
    console.log('========================================');
    console.log('[AmazonSyncService] ADD TO QUEUE - COMPLETE');
    console.log('========================================\n');

    return { success: true, item: data };
  }

  /**
   * Add multiple inventory items to the queue
   *
   * Note: Bulk operations skip conflict checking - use for items with confirmed prices only.
   * For individual items where user interaction may be needed, use addToQueue directly.
   */
  async addBulkToQueue(inventoryItemIds: string[], skipConflictCheck: boolean = true): Promise<{
    added: number;
    skipped: number;
    errors: string[];
    priceConflicts: PriceConflict[];
  }> {
    const result = {
      added: 0,
      skipped: 0,
      errors: [] as string[],
      priceConflicts: [] as PriceConflict[],
    };

    for (const id of inventoryItemIds) {
      const addResult = await this.addToQueue(id, skipConflictCheck);

      if (addResult.success) {
        result.added++;
      } else if (addResult.priceConflict) {
        result.priceConflicts.push(addResult.priceConflict);
      } else if (addResult.error) {
        if (addResult.error.includes('already in the sync queue')) {
          result.skipped++;
        } else {
          result.errors.push(`${id}: ${addResult.error}`);
        }
      }
    }

    return result;
  }

  /**
   * Remove an item from the queue
   */
  async removeFromQueue(queueItemId: string): Promise<void> {
    const { error } = await this.supabase
      .from('amazon_sync_queue')
      .delete()
      .eq('id', queueItemId)
      .eq('user_id', this.userId);

    if (error) {
      throw new Error(`Failed to remove from queue: ${error.message}`);
    }
  }

  /**
   * Clear the entire queue
   */
  async clearQueue(): Promise<number> {
    const { data, error } = await this.supabase
      .from('amazon_sync_queue')
      .delete()
      .eq('user_id', this.userId)
      .select('id');

    if (error) {
      throw new Error(`Failed to clear queue: ${error.message}`);
    }

    return data?.length ?? 0;
  }

  /**
   * Get all queue items with inventory details
   */
  async getQueueItems(): Promise<QueueItemWithDetails[]> {
    const { data, error } = await this.supabase
      .from('amazon_sync_queue')
      .select(
        `
        *,
        inventory_items (
          id,
          set_number,
          item_name,
          condition,
          storage_location,
          listing_value
        )
      `
      )
      .eq('user_id', this.userId)
      .order('added_at', { ascending: false });

    if (error) {
      throw new Error(`Failed to get queue items: ${error.message}`);
    }

    // Filter out items where inventory_items is null (should not happen with FK constraint)
    const validItems = (data ?? []).filter((item) => item.inventory_items !== null);

    return validItems.map((item) => {
      const inv = item.inventory_items as unknown as InventoryItemRow;
      return {
        ...item,
        inventory_items: undefined, // Remove the nested object
        inventoryItem: {
          id: inv.id,
          set_number: inv.set_number,
          item_name: inv.item_name,
          condition: inv.condition,
          storage_location: inv.storage_location,
          listing_value: inv.listing_value,
        },
        priceDifference:
          item.amazon_price !== null
            ? item.local_price - item.amazon_price
            : null,
        quantityDifference:
          item.amazon_quantity !== null
            ? item.local_quantity - item.amazon_quantity
            : null,
      } as QueueItemWithDetails;
    });
  }

  /**
   * Get aggregated queue items by ASIN for feed submission
   *
   * Aggregates items by ASIN and calculates:
   * - queueQuantity: number of items in the queue
   * - existingAmazonQuantity: current quantity on Amazon (from platform_listings cache)
   * - totalQuantity: sum of both (for incrementing stock)
   */
  async getAggregatedQueueItems(): Promise<AggregatedQueueItem[]> {
    const items = await this.getQueueItems();

    // Group by ASIN (trim to prevent whitespace issues)
    const asinMap = new Map<string, AggregatedQueueItem>();

    for (const item of items) {
      const trimmedAsin = item.asin.trim();
      const existing = asinMap.get(trimmedAsin);

      if (existing) {
        // Add to existing aggregation
        existing.queueQuantity += 1;
        existing.totalQuantity = existing.existingAmazonQuantity + existing.queueQuantity;
        existing.inventoryItemIds.push(item.inventory_item_id);
        existing.queueItemIds.push(item.id);
        if (item.inventoryItem.item_name) {
          existing.itemNames.push(item.inventoryItem.item_name);
        }
      } else {
        // Create new aggregation
        const existingAmazonQty = item.amazon_quantity ?? 0;
        const queueQty = 1;

        asinMap.set(trimmedAsin, {
          asin: trimmedAsin,
          amazonSku: (item.amazon_sku || item.asin).trim(),
          price: item.local_price,
          queueQuantity: queueQty,
          existingAmazonQuantity: existingAmazonQty,
          totalQuantity: existingAmazonQty + queueQty,
          inventoryItemIds: [item.inventory_item_id],
          queueItemIds: [item.id],
          itemNames: item.inventoryItem.item_name
            ? [item.inventoryItem.item_name]
            : [],
          productType: item.product_type || DEFAULT_PRODUCT_TYPE,
          isNewSku: item.is_new_sku ?? false,
        });
      }
    }

    return Array.from(asinMap.values());
  }

  /**
   * Get queue count
   */
  async getQueueCount(): Promise<number> {
    const { count, error } = await this.supabase
      .from('amazon_sync_queue')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', this.userId);

    if (error) {
      throw new Error(`Failed to get queue count: ${error.message}`);
    }

    return count ?? 0;
  }

  // ==========================================================================
  // FEED SUBMISSION
  // ==========================================================================

  /**
   * Submit the queue to Amazon
   *
   * @param dryRun - If true, validates without submitting
   * @returns The created feed record
   */
  async submitFeed(dryRun: boolean): Promise<SyncFeed> {
    console.log(`[AmazonSyncService] Submitting feed (dryRun: ${dryRun})`);

    // 1. Get credentials
    const credentials = await this.getAmazonCredentials();
    if (!credentials) {
      throw new Error(
        'Amazon credentials not configured. Please set up Amazon integration first.'
      );
    }

    // 2. Get aggregated queue items
    const aggregatedItems = await this.getAggregatedQueueItems();

    if (aggregatedItems.length === 0) {
      throw new Error('No items in the sync queue');
    }

    // 3. Create feed record
    const feed = await this.createFeedRecord(
      aggregatedItems.length,
      dryRun
    );

    try {
      // 4. Build feed payload
      const payload = this.buildFeedPayload(aggregatedItems, credentials.sellerId);

      // Update feed with request payload
      await this.updateFeedRecord(feed.id, {
        request_payload: payload as unknown as Database['public']['Tables']['amazon_sync_feeds']['Update']['request_payload'],
      });

      // 5. Create feed items
      await this.createFeedItems(feed.id, aggregatedItems);

      if (dryRun) {
        // 6a. Validate using Listings API
        const listingsClient = new AmazonListingsClient(credentials);
        const validationResults = await this.validateItems(
          listingsClient,
          aggregatedItems
        );

        // Update feed items with validation results
        await this.updateFeedItemsWithValidation(feed.id, validationResults);

        // Mark feed as done
        const successCount = validationResults.filter(
          (r) => r.status === 'VALID'
        ).length;
        const errorCount = validationResults.length - successCount;

        await this.updateFeedRecord(feed.id, {
          status: 'done',
          success_count: successCount,
          error_count: errorCount,
          completed_at: new Date().toISOString(),
        });

        // Clear successfully validated items from queue
        if (!dryRun) {
          await this.clearQueueForFeed(aggregatedItems);
        }

        return await this.getFeed(feed.id);
      } else {
        // 6b. Submit feed to Amazon
        const feedsClient = new AmazonFeedsClient(credentials);
        const { feedId, feedDocumentId } = await feedsClient.submitFeed(
          payload,
          'JSON_LISTINGS_FEED',
          [credentials.marketplaceIds[0] || 'A1F83G8C2ARO7P']
        );

        // Update feed record with Amazon IDs
        await this.updateFeedRecord(feed.id, {
          amazon_feed_id: feedId,
          amazon_feed_document_id: feedDocumentId,
          status: 'submitted',
          submitted_at: new Date().toISOString(),
        });

        return await this.getFeed(feed.id);
      }
    } catch (error) {
      // Mark feed as error
      await this.updateFeedRecord(feed.id, {
        status: 'error',
        error_message: error instanceof Error ? error.message : 'Unknown error',
        completed_at: new Date().toISOString(),
      });
      throw error;
    }
  }

  // ==========================================================================
  // TWO-PHASE SYNC (ASYNC/BACKGROUND VERSION)
  // ==========================================================================

  /**
   * Submit feed using two-phase sync (price first, then quantity)
   *
   * IMPORTANT: This method returns IMMEDIATELY after submitting the price feed.
   * The caller should poll using processTwoPhaseStep() to continue processing.
   *
   * Flow:
   * 1. Submit price-only feed → RETURN IMMEDIATELY
   * 2. Client polls processTwoPhaseStep() which handles:
   *    - Polling for price feed completion
   *    - Verifying price is live on Amazon
   *    - Submitting quantity feed
   *    - Polling for quantity feed completion
   *    - Sending notifications
   *
   * @param options - Submission options
   * @returns Result with price feed and initial status (processing continues in background)
   */
  async submitTwoPhaseFeed(options: {
    dryRun: boolean;
    userEmail: string;
    priceVerificationTimeout?: number;
    priceVerificationInterval?: number;
  }): Promise<TwoPhaseResult> {
    const { dryRun, userEmail } = options;

    console.log('[AmazonSyncService] Starting two-phase sync (async mode)');

    // Get credentials and aggregated items
    const credentials = await this.getAmazonCredentials();
    if (!credentials) {
      throw new Error('Amazon credentials not configured');
    }

    const aggregatedItems = await this.getAggregatedQueueItems();
    if (aggregatedItems.length === 0) {
      throw new Error('No items in the sync queue');
    }

    // Split items: new SKUs need single-phase (UPDATE), existing SKUs use two-phase (PATCH)
    // New SKUs send price+quantity together atomically, so two-phase doesn't make sense for them
    const newSkuItems = aggregatedItems.filter((item) => item.isNewSku);
    const existingSkuItems = aggregatedItems.filter((item) => !item.isNewSku);

    console.log(`[AmazonSyncService] Queue split: ${newSkuItems.length} new SKUs (single-phase), ${existingSkuItems.length} existing SKUs (two-phase)`);

    // Submit new SKUs as single-phase (full UPDATE with price+quantity)
    // These don't need verification because price and quantity are sent atomically
    if (newSkuItems.length > 0) {
      console.log('[AmazonSyncService] Submitting new SKUs as single-phase feed');
      const newSkuFeed = await this.submitNewSkuFeed(newSkuItems, credentials, dryRun);
      console.log(`[AmazonSyncService] New SKU feed submitted: ${newSkuFeed.id}`);

      // Clear new SKU items from queue immediately (they're fully submitted)
      if (!dryRun) {
        await this.clearQueueForFeed(newSkuItems);
      }
    }

    // If no existing SKUs, we're done (only had new SKUs)
    if (existingSkuItems.length === 0) {
      console.log('[AmazonSyncService] No existing SKUs - two-phase not needed');
      // Return a synthetic result since we only had new SKUs
      return {
        priceFeed: newSkuItems.length > 0 ? await this.getLatestFeed() : null as unknown as SyncFeed,
        status: 'price_verified', // Effectively complete
      };
    }

    // Submit existing SKUs as two-phase (price-only PATCH first)
    console.log('[AmazonSyncService] Phase 1: Submitting price-only feed for existing SKUs');
    const priceFeed = await this.submitPriceOnlyFeed(existingSkuItems, credentials, dryRun);

    if (dryRun) {
      return {
        priceFeed,
        status: 'price_verified',
      };
    }

    // Set up background processing state
    // Note: two_phase_* columns added by migration 20260123000002_two_phase_background.sql
    await this.updateFeedRecord(priceFeed.id, {
      two_phase_step: 'price_submitted',
      two_phase_started_at: new Date().toISOString(),
      two_phase_user_email: userEmail,
      two_phase_poll_count: 0,
    } as Parameters<typeof this.updateFeedRecord>[1]);

    // Return immediately - processing continues via processTwoPhaseStep()
    return {
      priceFeed: await this.getFeed(priceFeed.id),
      status: 'price_submitted',
    };
  }

  /**
   * Process the next step of a two-phase sync
   *
   * Call this repeatedly to advance through the two-phase sync process.
   * Each call processes one step and returns the current state.
   *
   * Steps:
   * 1. price_polling - Poll Amazon for price feed status
   * 2. price_verification - Check if price is live on Amazon
   * 3. quantity_submission - Submit quantity feed
   * 4. quantity_polling - Poll Amazon for quantity feed status
   * 5. complete - All done, notifications sent
   *
   * @param feedId - The price feed ID
   * @param userEmail - User email for notifications
   * @returns Current state and whether processing is complete
   */
  async processTwoPhaseStep(feedId: string, userEmail: string): Promise<TwoPhaseStepResult> {
    const feed = await this.getFeedWithTwoPhaseState(feedId);

    if (!feed) {
      throw new Error('Feed not found');
    }

    // Check if this is a two-phase feed
    if (feed.sync_mode !== 'two_phase') {
      throw new Error('Feed is not a two-phase sync');
    }

    const step = feed.two_phase_step as string;

    // Update poll tracking
    await this.updateFeedRecord(feedId, {
      two_phase_last_poll_at: new Date().toISOString(),
      two_phase_poll_count: (feed.two_phase_poll_count ?? 0) + 1,
    } as Parameters<typeof this.updateFeedRecord>[1]);

    // Check for timeout (30 minutes from start)
    const startedAt = feed.two_phase_started_at ? new Date(feed.two_phase_started_at).getTime() : 0;
    const elapsed = Date.now() - startedAt;
    const timeout = TWO_PHASE_DEFAULTS.priceVerificationTimeout;

    if (elapsed > timeout && step !== 'complete' && step !== 'failed') {
      return this.failTwoPhaseSync(feedId, userEmail, 'Timeout: Two-phase sync exceeded 30 minute limit');
    }

    // Process based on current step
    switch (step) {
      case 'price_submitted':
      case 'price_polling':
        return this.processPricePollingStep(feedId, userEmail);

      case 'price_verifying':
        return this.processPriceVerificationStep(feedId, userEmail);

      case 'quantity_submitted':
      case 'quantity_polling':
        return this.processQuantityPollingStep(feedId, userEmail);

      case 'complete':
        return {
          feedId,
          status: 'completed',
          step: 'complete',
          isComplete: true,
          message: 'Two-phase sync completed successfully',
          priceFeed: await this.getFeed(feedId),
          quantityFeed: feed.quantity_feed_id ? await this.getFeed(feed.quantity_feed_id) : undefined,
        };

      case 'failed':
        return {
          feedId,
          status: 'failed',
          step: 'complete',
          isComplete: true,
          message: feed.error_message || 'Two-phase sync failed',
          error: feed.error_message || undefined,
          priceFeed: await this.getFeed(feedId),
        };

      default:
        throw new Error(`Unknown two-phase step: ${step}`);
    }
  }

  /**
   * Process price feed polling step
   */
  private async processPricePollingStep(feedId: string, userEmail: string): Promise<TwoPhaseStepResult> {
    // Poll Amazon for price feed status
    const feed = await this.pollFeedStatus(feedId);

    if (feed.status === 'submitted' || feed.status === 'processing') {
      // Still processing - continue polling
      await this.updateFeedRecord(feedId, {
        two_phase_step: 'price_polling',
      } as Parameters<typeof this.updateFeedRecord>[1]);

      return {
        feedId,
        status: 'price_processing',
        step: 'price_polling',
        isComplete: false,
        message: 'Price feed still processing on Amazon',
        priceFeed: feed,
        nextPollDelay: 5000,
      };
    }

    if (feed.status === 'error' || (feed.error_count ?? 0) > 0) {
      // Price feed rejected
      return this.failTwoPhaseSync(feedId, userEmail, feed.error_message || 'Price feed rejected by Amazon', 'price');
    }

    if (feed.status === 'done' || feed.status === 'done_verifying') {
      // Price feed accepted - move to verification
      // Note: 'done_verifying' means new SKUs need price verification, which this two-phase
      // flow handles anyway via the 'price_verifying' step
      await this.updateFeedRecord(feedId, {
        two_phase_step: 'price_verifying',
      } as Parameters<typeof this.updateFeedRecord>[1]);

      return {
        feedId,
        status: 'price_verifying',
        step: 'price_verification',
        isComplete: false,
        message: 'Price feed accepted, verifying price is live on Amazon',
        priceFeed: feed,
        nextPollDelay: 30000, // 30 seconds for verification
      };
    }

    // Unexpected status
    return this.failTwoPhaseSync(feedId, userEmail, `Unexpected feed status: ${feed.status}`);
  }

  /**
   * Process price verification step
   *
   * Uses queue items for verification. If queue is empty (edge case), falls back to feed items.
   */
  private async processPriceVerificationStep(feedId: string, userEmail: string): Promise<TwoPhaseStepResult> {
    // Try to get items from queue first
    let aggregatedItems = await this.getAggregatedQueueItems();

    // Fallback: If queue is empty, reconstruct from feed items
    // This handles edge cases where queue was cleared unexpectedly
    if (aggregatedItems.length === 0) {
      console.log('[AmazonSyncService] Queue empty - reconstructing from feed items');
      const feedItems = await this.getFeedItems(feedId);

      if (feedItems.length === 0) {
        return this.failTwoPhaseSync(feedId, userEmail, 'No items found for verification');
      }

      // Reconstruct aggregated items from feed items
      aggregatedItems = feedItems.map((item) => ({
        asin: item.asin,
        amazonSku: item.amazon_sku,
        price: Number(item.submitted_price),
        queueQuantity: item.submitted_quantity,
        existingAmazonQuantity: 0, // Not needed for verification
        totalQuantity: item.submitted_quantity,
        inventoryItemIds: item.inventory_item_ids,
        queueItemIds: [], // Not available
        itemNames: [],
        productType: DEFAULT_PRODUCT_TYPE,
        isNewSku: item.is_new_sku ?? false,
      }));
    }

    // Check if prices are live
    const credentials = await this.getAmazonCredentials();
    if (!credentials) {
      return this.failTwoPhaseSync(feedId, userEmail, 'Amazon credentials not available');
    }

    const listingsClient = new AmazonListingsClient(credentials);
    let allVerified = true;
    const failedSkus: string[] = [];

    for (const item of aggregatedItems) {
      try {
        const listing = await listingsClient.getListing(item.amazonSku, 'A1F83G8C2ARO7P', ['offers']);
        const offer = listing?.offers?.find((o) => o.marketplaceId === 'A1F83G8C2ARO7P');
        const livePrice = offer?.price?.amount;

        if (livePrice === undefined || Math.abs(livePrice - item.price) > 0.01) {
          allVerified = false;
          failedSkus.push(item.amazonSku);
          console.log(
            `[AmazonSyncService] Price not yet live for ${item.amazonSku}: ` +
              `expected ${item.price}, got ${livePrice}`
          );
        }
      } catch (error) {
        allVerified = false;
        failedSkus.push(item.amazonSku);
        console.error(`[AmazonSyncService] Error checking price for ${item.amazonSku}:`, error);
      }
    }

    if (!allVerified) {
      // Still waiting - check if we've exceeded timeout
      const feed = await this.getFeedWithTwoPhaseState(feedId);
      const startedAt = feed?.two_phase_started_at ? new Date(feed.two_phase_started_at).getTime() : Date.now();
      const elapsed = Date.now() - startedAt;

      if (elapsed > TWO_PHASE_DEFAULTS.priceVerificationTimeout) {
        // Timeout - fail with verification error
        return this.failTwoPhaseVerification(feedId, userEmail, failedSkus);
      }

      return {
        feedId,
        status: 'price_verifying',
        step: 'price_verification',
        isComplete: false,
        message: `Waiting for price to appear on Amazon (${Math.round(elapsed / 1000)}s elapsed)`,
        priceFeed: await this.getFeed(feedId),
        nextPollDelay: 30000,
      };
    }

    // All prices verified - submit quantity feed
    console.log('[AmazonSyncService] Prices verified - submitting quantity feed');

    const priceVerifiedAt = new Date().toISOString();
    await this.updateFeedRecord(feedId, {
      status: 'verified',
      price_verified_at: priceVerifiedAt,
    } as Parameters<typeof this.updateFeedRecord>[1]);

    // Submit quantity feed
    const quantityFeed = await this.submitQuantityOnlyFeed(aggregatedItems, credentials, feedId);

    // Update parent feed with quantity feed reference
    await this.updateFeedRecord(feedId, {
      two_phase_step: 'quantity_submitted',
      quantity_feed_id: quantityFeed.id,
    } as Parameters<typeof this.updateFeedRecord>[1]);

    return {
      feedId,
      status: 'quantity_submitted',
      step: 'quantity_submission',
      isComplete: false,
      message: 'Quantity feed submitted to Amazon',
      priceFeed: await this.getFeed(feedId),
      quantityFeed,
      priceVerifiedAt,
      nextPollDelay: 5000,
    };
  }

  /**
   * Process quantity feed polling step
   */
  private async processQuantityPollingStep(feedId: string, userEmail: string): Promise<TwoPhaseStepResult> {
    const priceFeed = await this.getFeedWithTwoPhaseState(feedId);
    const quantityFeedId = priceFeed?.quantity_feed_id;

    if (!quantityFeedId) {
      return this.failTwoPhaseSync(feedId, userEmail, 'Quantity feed ID not found');
    }

    // Poll quantity feed status
    const quantityFeed = await this.pollFeedStatus(quantityFeedId);

    if (quantityFeed.status === 'submitted' || quantityFeed.status === 'processing') {
      // Still processing
      await this.updateFeedRecord(feedId, {
        two_phase_step: 'quantity_polling',
      } as Parameters<typeof this.updateFeedRecord>[1]);

      return {
        feedId,
        status: 'quantity_processing',
        step: 'quantity_polling',
        isComplete: false,
        message: 'Quantity feed still processing on Amazon',
        priceFeed: await this.getFeed(feedId),
        quantityFeed,
        nextPollDelay: 5000,
      };
    }

    if (quantityFeed.status === 'done') {
      // SUCCESS - complete the two-phase sync
      return this.completeTwoPhaseSync(feedId, userEmail, quantityFeedId);
    }

    // Quantity feed failed
    return this.failTwoPhaseSync(
      feedId,
      userEmail,
      quantityFeed.error_message || 'Quantity feed rejected by Amazon',
      'quantity'
    );
  }

  /**
   * Complete a successful two-phase sync
   */
  private async completeTwoPhaseSync(
    feedId: string,
    userEmail: string,
    quantityFeedId: string
  ): Promise<TwoPhaseStepResult> {
    // Get items from queue, with fallback to feed items
    let aggregatedItems = await this.getAggregatedQueueItems();

    // Fallback: If queue is empty, reconstruct from feed items
    if (aggregatedItems.length === 0) {
      console.log('[AmazonSyncService] Queue empty in completeTwoPhaseSync - reconstructing from feed items');
      const feedItems = await this.getFeedItems(feedId);

      aggregatedItems = feedItems.map((item) => ({
        asin: item.asin,
        amazonSku: item.amazon_sku,
        price: Number(item.submitted_price),
        queueQuantity: item.submitted_quantity,
        existingAmazonQuantity: 0,
        totalQuantity: item.submitted_quantity,
        inventoryItemIds: item.inventory_item_ids,
        queueItemIds: [],
        itemNames: [],
        productType: DEFAULT_PRODUCT_TYPE,
        isNewSku: item.is_new_sku ?? false,
      }));
    }

    // Clear any remaining queue items (successful items already cleared during feed processing)
    if (aggregatedItems.length > 0 && aggregatedItems.some((a) => a.queueItemIds.length > 0)) {
      console.log(`[AmazonSyncService] Clearing ${aggregatedItems.length} remaining queue items`);
      await this.clearQueueForFeed(aggregatedItems);
    }

    // Update feed status
    await this.updateFeedRecord(feedId, {
      two_phase_step: 'complete',
      completed_at: new Date().toISOString(),
    } as Parameters<typeof this.updateFeedRecord>[1]);

    // Send success notifications
    const priceFeed = await this.getFeedWithTwoPhaseState(feedId);
    const startedAt = priceFeed?.two_phase_started_at ? new Date(priceFeed.two_phase_started_at).getTime() : Date.now();
    const verificationDuration = Date.now() - startedAt;

    // Get item details - try to enrich with inventory data
    const allInventoryIds = aggregatedItems.flatMap((item) => item.inventoryItemIds);
    let inventoryMap = new Map<string, { set_number: string; item_name: string | null }>();

    if (allInventoryIds.length > 0) {
      const { data: inventoryItems } = await this.supabase
        .from('inventory_items')
        .select('id, set_number, item_name')
        .in('id', allInventoryIds);

      if (inventoryItems) {
        inventoryMap = new Map(
          inventoryItems.map((inv) => [inv.id, { set_number: inv.set_number, item_name: inv.item_name }])
        );
      }
    }

    const itemDetails = aggregatedItems.map((item) => {
      // Try to get item name from inventory
      const firstInvId = item.inventoryItemIds[0];
      const inv = firstInvId ? inventoryMap.get(firstInvId) : undefined;

      return {
        sku: item.amazonSku,
        asin: item.asin,
        setNumber: inv?.set_number ?? item.asin,
        itemName: inv?.item_name ?? item.itemNames[0] ?? 'Unknown',
        price: item.price,
      };
    });

    await emailService.sendTwoPhaseSuccess({
      userEmail,
      feedId,
      itemCount: aggregatedItems.length,
      priceVerificationTime: verificationDuration,
      itemDetails,
    });

    await pushoverService.sendSyncSuccess({
      feedId,
      itemCount: aggregatedItems.length,
      verificationTime: verificationDuration,
    });

    return {
      feedId,
      status: 'completed',
      step: 'complete',
      isComplete: true,
      message: 'Two-phase sync completed successfully! Notifications sent.',
      priceFeed: await this.getFeed(feedId),
      quantityFeed: await this.getFeed(quantityFeedId),
    };
  }

  /**
   * Fail a two-phase sync with notifications
   */
  private async failTwoPhaseSync(
    feedId: string,
    userEmail: string,
    reason: string,
    phase?: 'price' | 'quantity'
  ): Promise<TwoPhaseStepResult> {
    await this.updateFeedRecord(feedId, {
      two_phase_step: 'failed',
      status: 'error',
      error_message: reason,
      completed_at: new Date().toISOString(),
    } as Parameters<typeof this.updateFeedRecord>[1]);

    // Send failure notifications
    const aggregatedItems = await this.getAggregatedQueueItems();
    const itemDetails = this.buildItemDetails(aggregatedItems);

    if (phase) {
      await emailService.sendFeedRejectionFailure({
        userEmail,
        feedId,
        phase,
        errorMessage: reason,
        itemDetails,
      });
    }

    await pushoverService.sendSyncFailure({
      feedId,
      itemCount: aggregatedItems.length,
      reason,
      phase: phase === 'price' ? 'price_rejected' : phase === 'quantity' ? 'quantity_rejected' : 'price_verification',
    });

    return {
      feedId,
      status: 'failed',
      step: 'complete',
      isComplete: true,
      message: `Two-phase sync failed: ${reason}`,
      error: reason,
      priceFeed: await this.getFeed(feedId),
    };
  }

  /**
   * Fail specifically due to price verification timeout
   */
  private async failTwoPhaseVerification(
    feedId: string,
    userEmail: string,
    failedSkus: string[]
  ): Promise<TwoPhaseStepResult> {
    const reason = `Price verification failed for: ${failedSkus.join(', ')}`;

    await this.updateFeedRecord(feedId, {
      two_phase_step: 'failed',
      status: 'verification_failed',
      error_message: reason,
      completed_at: new Date().toISOString(),
    } as Parameters<typeof this.updateFeedRecord>[1]);

    // Send failure notifications
    const aggregatedItems = await this.getAggregatedQueueItems();
    const itemDetails = this.buildItemDetails(aggregatedItems);

    await emailService.sendTwoPhaseFailure({
      userEmail,
      feedId,
      failedSkus,
      submittedPrice: aggregatedItems[0]?.price ?? 0,
      verificationDuration: TWO_PHASE_DEFAULTS.priceVerificationTimeout,
      itemDetails,
    });

    await pushoverService.sendSyncFailure({
      feedId,
      itemCount: failedSkus.length,
      reason: `Price not visible after ${TWO_PHASE_DEFAULTS.priceVerificationTimeout / 60000} mins`,
      phase: 'price_verification',
    });

    return {
      feedId,
      status: 'failed',
      step: 'complete',
      isComplete: true,
      message: `Price verification timeout: ${reason}`,
      error: reason,
      priceFeed: await this.getFeed(feedId),
    };
  }

  /**
   * Get feed with two-phase state columns
   */
  private async getFeedWithTwoPhaseState(feedId: string) {
    const { data, error } = await this.supabase
      .from('amazon_sync_feeds')
      .select('*')
      .eq('id', feedId)
      .eq('user_id', this.userId)
      .single();

    if (error) {
      throw new Error(`Failed to get feed: ${error.message}`);
    }

    return data;
  }

  /**
   * Submit price-only feed
   */
  private async submitPriceOnlyFeed(
    items: AggregatedQueueItem[],
    credentials: AmazonCredentials,
    dryRun: boolean
  ): Promise<SyncFeed> {
    // Create feed record
    const feed = await this.createFeedRecord(items.length, dryRun);

    // Update with sync mode and phase
    // Note: sync_mode and phase added by migration 20260123000001_two_phase_sync.sql
    await this.updateFeedRecord(feed.id, {
      sync_mode: 'two_phase',
      phase: 'price',
    } as Parameters<typeof this.updateFeedRecord>[1]);

    // Build price-only payload
    const messages: ListingsFeedMessage[] = items.map((item, index) => ({
      messageId: index + 1,
      sku: item.amazonSku,
      operationType: 'PATCH' as const,
      productType: item.productType,
      patches: this.buildPriceOnlyPatches(item),
    }));

    const payload: ListingsFeedPayload = {
      header: {
        sellerId: credentials.sellerId,
        version: '2.0',
        issueLocale: 'en_GB',
      },
      messages,
    };

    // Update feed with payload
    await this.updateFeedRecord(feed.id, {
      request_payload:
        payload as unknown as Database['public']['Tables']['amazon_sync_feeds']['Update']['request_payload'],
    });

    // Create feed items
    await this.createFeedItems(feed.id, items);

    if (dryRun) {
      // Validate via Listings API
      const listingsClient = new AmazonListingsClient(credentials);
      const validationResults = await this.validateItems(listingsClient, items);
      await this.updateFeedItemsWithValidation(feed.id, validationResults);

      const successCount = validationResults.filter((r) => r.status === 'VALID').length;
      await this.updateFeedRecord(feed.id, {
        status: 'done',
        success_count: successCount,
        error_count: validationResults.length - successCount,
        completed_at: new Date().toISOString(),
      });
    } else {
      // Submit to Amazon
      const feedsClient = new AmazonFeedsClient(credentials);
      const { feedId, feedDocumentId } = await feedsClient.submitFeed(
        payload,
        'JSON_LISTINGS_FEED',
        ['A1F83G8C2ARO7P']
      );

      await this.updateFeedRecord(feed.id, {
        amazon_feed_id: feedId,
        amazon_feed_document_id: feedDocumentId,
        status: 'submitted',
        submitted_at: new Date().toISOString(),
      });
    }

    return this.getFeed(feed.id);
  }

  /**
   * Submit new SKU feed (single-phase with full UPDATE operation)
   *
   * New SKUs require UPDATE operation which sends price+quantity atomically.
   * This means two-phase sync doesn't apply - they're submitted as single-phase.
   */
  private async submitNewSkuFeed(
    items: AggregatedQueueItem[],
    credentials: AmazonCredentials,
    dryRun: boolean
  ): Promise<SyncFeed> {
    // Create feed record
    const feed = await this.createFeedRecord(items.length, dryRun);

    // Mark as single-phase since new SKUs are atomic
    await this.updateFeedRecord(feed.id, {
      sync_mode: 'single',
    } as Parameters<typeof this.updateFeedRecord>[1]);

    // Build full payload using UPDATE operation (includes price+quantity)
    const payload = this.buildFeedPayload(items, credentials.sellerId);

    // Update feed with payload
    await this.updateFeedRecord(feed.id, {
      request_payload:
        payload as unknown as Database['public']['Tables']['amazon_sync_feeds']['Update']['request_payload'],
    });

    // Create feed items
    await this.createFeedItems(feed.id, items);

    if (dryRun) {
      // Validate via Listings API
      const listingsClient = new AmazonListingsClient(credentials);
      const validationResults = await this.validateItems(listingsClient, items);
      await this.updateFeedItemsWithValidation(feed.id, validationResults);

      const successCount = validationResults.filter((r) => r.status === 'VALID').length;
      await this.updateFeedRecord(feed.id, {
        status: 'done',
        success_count: successCount,
        error_count: validationResults.length - successCount,
        completed_at: new Date().toISOString(),
      });
    } else {
      // Submit to Amazon
      const feedsClient = new AmazonFeedsClient(credentials);
      const { feedId, feedDocumentId } = await feedsClient.submitFeed(
        payload,
        'JSON_LISTINGS_FEED',
        ['A1F83G8C2ARO7P']
      );

      await this.updateFeedRecord(feed.id, {
        amazon_feed_id: feedId,
        amazon_feed_document_id: feedDocumentId,
        status: 'submitted',
        submitted_at: new Date().toISOString(),
      });
    }

    return this.getFeed(feed.id);
  }

  /**
   * Get the most recently created feed
   */
  private async getLatestFeed(): Promise<SyncFeed> {
    const { data, error } = await this.supabase
      .from('amazon_sync_feeds')
      .select(
        'id, user_id, feed_type, is_dry_run, marketplace_id, status, total_items, success_count, warning_count, error_count, error_message, amazon_feed_id, amazon_feed_document_id, amazon_result_document_id, submitted_at, completed_at, last_poll_at, poll_count, created_at, updated_at, sync_mode, phase, parent_feed_id, price_verified_at, quantity_feed_id, verification_started_at, two_phase_step, two_phase_started_at, two_phase_user_email, two_phase_poll_count, two_phase_last_poll_at'
      )
      .eq('user_id', this.userId)
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    if (error || !data) {
      throw new Error('Failed to get latest feed');
    }

    return data as SyncFeed;
  }

  /**
   * Submit quantity-only feed
   */
  private async submitQuantityOnlyFeed(
    items: AggregatedQueueItem[],
    credentials: AmazonCredentials,
    parentFeedId: string
  ): Promise<SyncFeed> {
    // Create feed record linked to parent
    // Note: sync_mode, phase, parent_feed_id added by migration 20260123000001_two_phase_sync.sql
    const { data: feed, error } = await this.supabase
      .from('amazon_sync_feeds')
      .insert({
        user_id: this.userId,
        feed_type: 'JSON_LISTINGS_FEED',
        is_dry_run: false,
        marketplace_id: 'A1F83G8C2ARO7P',
        status: 'pending',
        total_items: items.length,
        sync_mode: 'two_phase',
        phase: 'quantity',
        parent_feed_id: parentFeedId,
      } as Database['public']['Tables']['amazon_sync_feeds']['Insert'])
      .select()
      .single();

    if (error || !feed) {
      throw new Error(`Failed to create quantity feed: ${error?.message}`);
    }

    // Build quantity-only payload
    const messages: ListingsFeedMessage[] = items.map((item, index) => ({
      messageId: index + 1,
      sku: item.amazonSku,
      operationType: 'PATCH' as const,
      productType: item.productType,
      patches: this.buildQuantityOnlyPatches(item),
    }));

    const payload: ListingsFeedPayload = {
      header: {
        sellerId: credentials.sellerId,
        version: '2.0',
        issueLocale: 'en_GB',
      },
      messages,
    };

    // Update feed with payload
    await this.updateFeedRecord(feed.id, {
      request_payload:
        payload as unknown as Database['public']['Tables']['amazon_sync_feeds']['Update']['request_payload'],
    });

    // Create feed items
    await this.createFeedItems(feed.id, items);

    // Submit to Amazon
    const feedsClient = new AmazonFeedsClient(credentials);
    const { feedId, feedDocumentId } = await feedsClient.submitFeed(
      payload,
      'JSON_LISTINGS_FEED',
      ['A1F83G8C2ARO7P']
    );

    await this.updateFeedRecord(feed.id, {
      amazon_feed_id: feedId,
      amazon_feed_document_id: feedDocumentId,
      status: 'submitted',
      submitted_at: new Date().toISOString(),
    });

    return this.getFeed(feed.id);
  }

  /**
   * Build patches for price-only update (Phase 1 of two-phase sync)
   */
  private buildPriceOnlyPatches(item: AggregatedQueueItem): ListingsFeedPatch[] {
    const purchasableOffer = buildPurchasableOffer(item.price);

    return [
      {
        op: 'replace',
        path: '/attributes/purchasable_offer',
        value: purchasableOffer,
      },
      // Also update list_price for UK marketplace compliance
      {
        op: 'replace',
        path: '/attributes/list_price',
        value: [
          {
            marketplace_id: 'A1F83G8C2ARO7P',
            currency: 'GBP',
            value_with_tax: item.price,
          },
        ],
      },
    ];
  }

  /**
   * Build patches for quantity-only update (Phase 2 of two-phase sync)
   */
  private buildQuantityOnlyPatches(item: AggregatedQueueItem): ListingsFeedPatch[] {
    return [
      {
        op: 'replace',
        path: '/attributes/fulfillment_availability',
        value: [
          {
            fulfillment_channel_code: 'DEFAULT',
            quantity: item.totalQuantity,
          },
        ],
      },
    ];
  }

  /**
   * Build item details for notification emails
   */
  private buildItemDetails(
    items: AggregatedQueueItem[]
  ): Array<{ sku: string; asin: string; setNumber: string; itemName: string }> {
    return items.map((item) => ({
      sku: item.amazonSku,
      asin: item.asin,
      setNumber: item.itemNames[0]?.split(' ')[0] ?? item.asin,
      itemName: item.itemNames[0] ?? 'Unknown',
    }));
  }

  /**
   * Helper to add delay
   */
  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  // ==========================================================================
  // FEED POLLING
  // ==========================================================================

  /**
   * Poll Amazon for feed status update
   */
  async pollFeedStatus(feedId: string): Promise<SyncFeed> {
    const feed = await this.getFeed(feedId);

    if (!feed) {
      throw new Error('Feed not found');
    }

    if (
      feed.status !== 'submitted' &&
      feed.status !== 'processing'
    ) {
      return feed;
    }

    if (!feed.amazon_feed_id) {
      throw new Error('Feed has no Amazon feed ID');
    }

    // Get credentials
    const credentials = await this.getAmazonCredentials();
    if (!credentials) {
      throw new Error('Amazon credentials not configured');
    }

    // Poll Amazon
    const feedsClient = new AmazonFeedsClient(credentials);
    const status = await feedsClient.getFeedStatus(feed.amazon_feed_id);

    console.log(
      `[AmazonSyncService] Poll result: ${status.processingStatus}`
    );

    // Update feed record
    const updates: Database['public']['Tables']['amazon_sync_feeds']['Update'] =
      {
        last_poll_at: new Date().toISOString(),
        poll_count: (feed.poll_count ?? 0) + 1,
      };

    if (status.processingStatus === 'DONE') {
      updates.amazon_result_document_id = status.resultFeedDocumentId || null;
      updates.completed_at = new Date().toISOString();

      // Process results
      let hasItemsNeedingVerification = false;
      if (status.resultFeedDocumentId) {
        try {
          const result = await feedsClient.getFeedResult(
            status.resultFeedDocumentId
          );
          const processResult = await this.processFeedResult(feedId, result);
          hasItemsNeedingVerification = processResult.hasItemsNeedingVerification;
          updates.result_payload = result as unknown as Database['public']['Tables']['amazon_sync_feeds']['Update']['result_payload'];
        } catch (error) {
          console.error(
            '[AmazonSyncService] Failed to process feed result:',
            error
          );
        }
      }

      // Get updated counts
      const items = await this.getFeedItems(feedId);
      // Count 'accepted' as success for now (price verification pending)
      updates.success_count = items.filter(
        (i) => i.status === 'success' || i.status === 'accepted'
      ).length;
      updates.warning_count = items.filter(
        (i) => i.status === 'warning'
      ).length;
      updates.error_count = items.filter((i) => i.status === 'error').length;

      // Set feed status based on whether price verification is needed
      if (hasItemsNeedingVerification) {
        // New SKUs need price verification - Amazon takes up to 30 min to apply price
        updates.status = 'done_verifying';
        updates.verification_started_at = new Date().toISOString();
        console.log('[AmazonSyncService] Feed has new SKUs - status set to done_verifying');
      } else {
        // All items are existing SKUs or had errors - no verification needed
        updates.status = 'done';
      }

      // Clear queue items for successful/accepted submissions
      // For two-phase sync: still clear successful items immediately, don't wait until completion
      const aggregated = await this.getAggregatedQueueItems();
      const successfulAsins = items
        .filter((i) => i.status === 'success' || i.status === 'warning' || i.status === 'accepted')
        .map((i) => i.asin.trim()); // Trim to handle any whitespace issues
      const successfulAggregated = aggregated.filter((a) =>
        successfulAsins.includes(a.asin.trim())
      );
      if (successfulAggregated.length > 0) {
        console.log(`[AmazonSyncService] Clearing ${successfulAggregated.length} successful items from queue`);
        await this.clearQueueForFeed(successfulAggregated);
      }
    } else if (status.processingStatus === 'IN_PROGRESS') {
      updates.status = 'processing';
    } else if (
      status.processingStatus === 'CANCELLED' ||
      status.processingStatus === 'FATAL'
    ) {
      updates.status = status.processingStatus.toLowerCase() as FeedStatus;
      updates.completed_at = new Date().toISOString();
    }

    await this.updateFeedRecord(feedId, updates);
    return await this.getFeed(feedId);
  }

  // ==========================================================================
  // PRICE VERIFICATION
  // ==========================================================================

  /**
   * Verify price on Amazon for feeds in done_verifying status
   *
   * Amazon processes listings in stages with delays:
   * 1. Listing created (immediate)
   * 2. Quantity updated (~few minutes)
   * 3. Price applied (~up to 30 minutes)
   *
   * This method queries the Amazon Listings API to verify that the
   * submitted price is now visible on the listing.
   *
   * @returns Object with verification results
   */
  async verifyFeedPrices(feedId: string): Promise<{
    feed: SyncFeed;
    allVerified: boolean;
    itemResults: Array<{
      sku: string;
      asin: string;
      submittedPrice: number;
      verifiedPrice: number | null;
      priceMatches: boolean;
      error?: string;
    }>;
  }> {
    console.log(`[AmazonSyncService] Starting price verification for feed ${feedId}`);

    const feed = await this.getFeed(feedId);
    if (!feed) {
      throw new Error(`Feed ${feedId} not found`);
    }

    // Only verify feeds in done_verifying status
    if (feed.status !== 'done_verifying') {
      console.log(`[AmazonSyncService] Feed ${feedId} is not in done_verifying status (${feed.status})`);
      return {
        feed,
        allVerified: feed.status === 'verified',
        itemResults: [],
      };
    }

    // Check if verification has timed out (30 minutes)
    const verificationStarted = feed.verification_started_at
      ? new Date(feed.verification_started_at).getTime()
      : Date.now();
    const elapsed = Date.now() - verificationStarted;

    if (elapsed > VERIFICATION_TIMEOUT_MS) {
      console.log(`[AmazonSyncService] Verification timeout for feed ${feedId} (${elapsed}ms)`);
      // Mark as verification failed
      await this.updateFeedRecord(feedId, {
        status: 'verification_failed',
        verification_completed_at: new Date().toISOString(),
      });
      // Update items that are still 'accepted' to 'verification_failed'
      await this.supabase
        .from('amazon_sync_feed_items')
        .update({
          status: 'verification_failed',
          verification_error: 'Price verification timed out after 30 minutes',
        })
        .eq('feed_id', feedId)
        .eq('status', 'accepted');

      return {
        feed: (await this.getFeed(feedId))!,
        allVerified: false,
        itemResults: [],
      };
    }

    // Get Amazon credentials
    const credentials = await this.getAmazonCredentials();
    if (!credentials) {
      throw new Error('Amazon credentials not found');
    }

    const listingsClient = new AmazonListingsClient(credentials);

    // Get feed items that need verification (status = 'accepted')
    const feedItems = await this.getFeedItems(feedId);
    const itemsToVerify = feedItems.filter((item) => item.status === 'accepted');

    if (itemsToVerify.length === 0) {
      console.log(`[AmazonSyncService] No items need verification for feed ${feedId}`);
      // All items verified or had errors - mark feed as verified
      await this.updateFeedRecord(feedId, {
        status: 'verified',
        verification_completed_at: new Date().toISOString(),
      });
      return {
        feed: (await this.getFeed(feedId))!,
        allVerified: true,
        itemResults: [],
      };
    }

    console.log(`[AmazonSyncService] Verifying ${itemsToVerify.length} items`);

    const itemResults: Array<{
      sku: string;
      asin: string;
      submittedPrice: number;
      verifiedPrice: number | null;
      priceMatches: boolean;
      error?: string;
    }> = [];

    let allVerified = true;

    for (const item of itemsToVerify) {
      try {
        console.log(`[AmazonSyncService] Checking price for SKU: ${item.amazon_sku}`);

        const listing = await listingsClient.getListing(
          item.amazon_sku,
          'A1F83G8C2ARO7P',
          ['offers', 'fulfillmentAvailability']
        );

        // Extract the offer price
        const offer = listing?.offers?.find(
          (o) => o.marketplaceId === 'A1F83G8C2ARO7P'
        );
        const verifiedPrice = offer?.price?.amount ?? null;

        // Check if price matches (within 0.01 tolerance)
        const submittedPrice = Number(item.submitted_price);
        const priceMatches = verifiedPrice !== null &&
          Math.abs(verifiedPrice - submittedPrice) < 0.01;

        console.log(`[AmazonSyncService] SKU ${item.amazon_sku}: submitted=${submittedPrice}, verified=${verifiedPrice}, matches=${priceMatches}`);

        itemResults.push({
          sku: item.amazon_sku,
          asin: item.asin,
          submittedPrice,
          verifiedPrice,
          priceMatches,
        });

        if (priceMatches) {
          // Price verified - update item to success
          await this.supabase
            .from('amazon_sync_feed_items')
            .update({
              status: 'success',
              verified_price: verifiedPrice,
              price_verified: true,
            })
            .eq('id', item.id);
        } else {
          // Price not yet applied - keep as accepted
          allVerified = false;
          await this.supabase
            .from('amazon_sync_feed_items')
            .update({
              verified_price: verifiedPrice,
              price_verified: false,
            })
            .eq('id', item.id);
        }
      } catch (error) {
        console.error(`[AmazonSyncService] Error verifying SKU ${item.amazon_sku}:`, error);
        allVerified = false;
        itemResults.push({
          sku: item.amazon_sku,
          asin: item.asin,
          submittedPrice: Number(item.submitted_price),
          verifiedPrice: null,
          priceMatches: false,
          error: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    }

    // Update feed verification tracking
    const updates: Database['public']['Tables']['amazon_sync_feeds']['Update'] = {
      last_verification_at: new Date().toISOString(),
      verification_attempts: (feed.verification_attempts ?? 0) + 1,
    };

    if (allVerified) {
      updates.status = 'verified';
      updates.verification_completed_at = new Date().toISOString();
      console.log(`[AmazonSyncService] All items verified for feed ${feedId}`);
    } else {
      console.log(`[AmazonSyncService] Some items still pending verification for feed ${feedId}`);
    }

    await this.updateFeedRecord(feedId, updates);

    return {
      feed: (await this.getFeed(feedId))!,
      allVerified,
      itemResults,
    };
  }

  /**
   * Get feeds that need price verification
   */
  async getFeedsNeedingVerification(): Promise<SyncFeed[]> {
    const { data, error } = await this.supabase
      .from('amazon_sync_feeds')
      .select(
        'id, user_id, amazon_feed_id, amazon_feed_document_id, amazon_result_document_id, feed_type, is_dry_run, marketplace_id, status, total_items, success_count, warning_count, error_count, submitted_at, last_poll_at, poll_count, completed_at, error_message, error_details, created_at, updated_at, verification_started_at, verification_completed_at, verification_attempts, last_verification_at, sync_mode, phase, parent_feed_id, price_verified_at, quantity_feed_id, two_phase_last_poll_at, two_phase_poll_count, two_phase_started_at, two_phase_step, two_phase_user_email'
      )
      .eq('user_id', this.userId)
      .eq('status', 'done_verifying')
      .order('verification_started_at', { ascending: true });

    if (error) {
      throw new Error(`Failed to get feeds needing verification: ${error.message}`);
    }

    return data ?? [];
  }

  // ==========================================================================
  // FEED HISTORY
  // ==========================================================================

  /**
   * Get feed history
   */
  async getFeedHistory(limit: number = 20): Promise<SyncFeed[]> {
    const { data, error } = await this.supabase
      .from('amazon_sync_feeds')
      .select(
        'id, user_id, amazon_feed_id, amazon_feed_document_id, amazon_result_document_id, feed_type, is_dry_run, marketplace_id, status, total_items, success_count, warning_count, error_count, submitted_at, last_poll_at, poll_count, completed_at, error_message, error_details, created_at, updated_at, verification_started_at, verification_completed_at, verification_attempts, last_verification_at, sync_mode, phase, parent_feed_id, price_verified_at, quantity_feed_id, two_phase_last_poll_at, two_phase_poll_count, two_phase_started_at, two_phase_step, two_phase_user_email'
      )
      .eq('user_id', this.userId)
      .order('created_at', { ascending: false })
      .limit(limit);

    if (error) {
      throw new Error(`Failed to get feed history: ${error.message}`);
    }

    return data ?? [];
  }

  /**
   * Get a single feed with items
   */
  async getFeedWithDetails(feedId: string): Promise<SyncFeedWithDetails | null> {
    const { data: feed, error: feedError } = await this.supabase
      .from('amazon_sync_feeds')
      .select('*')
      .eq('id', feedId)
      .eq('user_id', this.userId)
      .single();

    if (feedError) {
      if (feedError.code === 'PGRST116') {
        return null;
      }
      throw new Error(`Failed to get feed: ${feedError.message}`);
    }

    const items = await this.getFeedItems(feedId);

    // Fetch inventory item details for all items
    const allInventoryIds = items.flatMap((item) => item.inventory_item_ids);
    const uniqueIds = [...new Set(allInventoryIds)];

    let inventoryMap = new Map<string, { set_number: string; item_name: string | null }>();

    if (uniqueIds.length > 0) {
      const { data: inventoryItems } = await this.supabase
        .from('inventory_items')
        .select('id, set_number, item_name')
        .in('id', uniqueIds);

      if (inventoryItems) {
        inventoryMap = new Map(
          inventoryItems.map((inv) => [inv.id, { set_number: inv.set_number, item_name: inv.item_name }])
        );
      }
    }

    // Enrich feed items with inventory details
    const enrichedItems = items.map((item) => {
      const setNumbers: string[] = [];
      const itemNames: string[] = [];

      for (const invId of item.inventory_item_ids) {
        const inv = inventoryMap.get(invId);
        if (inv) {
          setNumbers.push(inv.set_number);
          if (inv.item_name) {
            itemNames.push(inv.item_name);
          }
        }
      }

      return {
        ...item,
        setNumbers: [...new Set(setNumbers)], // Dedupe
        itemNames: [...new Set(itemNames)],   // Dedupe
      };
    });

    return {
      ...feed,
      items: enrichedItems,
    };
  }

  /**
   * Get a single feed without items
   */
  async getFeed(feedId: string): Promise<SyncFeed> {
    const { data, error } = await this.supabase
      .from('amazon_sync_feeds')
      .select(
        'id, user_id, amazon_feed_id, amazon_feed_document_id, amazon_result_document_id, feed_type, is_dry_run, marketplace_id, status, total_items, success_count, warning_count, error_count, submitted_at, last_poll_at, poll_count, completed_at, error_message, error_details, created_at, updated_at, verification_started_at, verification_completed_at, verification_attempts, last_verification_at, sync_mode, phase, parent_feed_id, price_verified_at, quantity_feed_id, two_phase_last_poll_at, two_phase_poll_count, two_phase_started_at, two_phase_step, two_phase_user_email'
      )
      .eq('id', feedId)
      .eq('user_id', this.userId)
      .single();

    if (error) {
      throw new Error(`Failed to get feed: ${error.message}`);
    }

    return data;
  }

  /**
   * Get feed items
   */
  async getFeedItems(feedId: string): Promise<AmazonSyncFeedItemRow[]> {
    const { data, error } = await this.supabase
      .from('amazon_sync_feed_items')
      .select('*')
      .eq('feed_id', feedId)
      .eq('user_id', this.userId)
      .order('asin', { ascending: true });

    if (error) {
      throw new Error(`Failed to get feed items: ${error.message}`);
    }

    return data ?? [];
  }

  // ==========================================================================
  // PRIVATE METHODS - FEED PAYLOAD
  // ==========================================================================

  /**
   * Build the JSON_LISTINGS_FEED payload
   *
   * Uses different operation types based on whether SKU exists on Amazon:
   * - UPDATE with LISTING_OFFER_ONLY: Creates new offer on existing ASIN (new SKU)
   * - PATCH: Updates existing offer (existing SKU)
   *
   * For new offers on existing ASINs:
   * - productType: 'PRODUCT' (root type - Amazon resolves via merchant_suggested_asin)
   * - requirements: 'LISTING_OFFER_ONLY' (only sales terms needed)
   * - merchant_suggested_asin: Links to the existing ASIN
   * - purchasable_offer: Our selling price
   * - fulfillment_availability: Quantity in stock
   */
  private buildFeedPayload(
    items: AggregatedQueueItem[],
    sellerId: string
  ): ListingsFeedPayload {
    console.log('\n========================================');
    console.log('[AmazonSyncService] BUILD FEED PAYLOAD');
    console.log('========================================');
    console.log(`[AmazonSyncService] Building payload for ${items.length} items`);
    console.log(`[AmazonSyncService] Seller ID: ${sellerId}`);

    const messages: ListingsFeedMessage[] = items.map((item, index) => {
      console.log(`\n[AmazonSyncService] --- Item ${index + 1} ---`);
      console.log(`  - ASIN: ${item.asin}`);
      console.log(`  - Amazon SKU: ${item.amazonSku}`);
      console.log(`  - Price: £${item.price}`);
      console.log(`  - Queue Quantity: ${item.queueQuantity}`);
      console.log(`  - Existing Amazon Quantity: ${item.existingAmazonQuantity}`);
      console.log(`  - Total Quantity (to submit): ${item.totalQuantity}`);
      console.log(`  - Product Type: ${item.productType}`);
      console.log(`  - Is New SKU: ${item.isNewSku}`);

      if (item.isNewSku) {
        // New SKU: Use UPDATE operation with LISTING_OFFER_ONLY requirements
        // This creates an offer on an existing ASIN - only sales terms needed
        console.log(`  - Operation: UPDATE (new offer on existing ASIN)`);
        console.log(`  - Requirements: LISTING_OFFER_ONLY`);
        const attributes = this.buildAttributes(item);
        console.log(`  - Attributes being submitted:`);
        console.log(JSON.stringify(attributes, null, 4));
        return {
          messageId: index + 1,
          sku: item.amazonSku,
          operationType: 'UPDATE' as const,
          productType: 'PRODUCT', // Root product type - Amazon resolves via merchant_suggested_asin
          requirements: 'LISTING_OFFER_ONLY' as const,
          attributes,
        };
      } else {
        // Existing SKU: Use PATCH operation with patches array
        // Use the actual product type for updates to existing offers
        console.log(`  - Operation: PATCH (update existing)`);
        const patches = this.buildPatches(item);
        console.log(`  - Patches being submitted:`);
        console.log(JSON.stringify(patches, null, 4));
        return {
          messageId: index + 1,
          sku: item.amazonSku,
          operationType: 'PATCH' as const,
          productType: item.productType,
          patches,
        };
      }
    });

    const payload = {
      header: {
        sellerId,
        version: '2.0',
        issueLocale: 'en_GB',
      },
      messages,
    };

    console.log('\n[AmazonSyncService] COMPLETE FEED PAYLOAD:');
    console.log(JSON.stringify(payload, null, 2));
    console.log('========================================');
    console.log('[AmazonSyncService] BUILD FEED PAYLOAD - COMPLETE');
    console.log('========================================\n');

    return payload;
  }

  /**
   * Build attributes object for UPDATE operation (new offer on existing ASIN)
   *
   * Uses merchant_suggested_asin to link our new SKU to an existing Amazon product.
   * This creates an offer, NOT a new product listing - Amazon matches to existing ASIN.
   *
   * For LISTING_OFFER_ONLY:
   * - merchant_suggested_asin: Links to existing ASIN
   * - condition_type: Item condition (new_new)
   * - purchasable_offer: Our selling price
   * - fulfillment_availability: Quantity available
   */
  private buildAttributes(item: AggregatedQueueItem): Record<string, unknown> {
    // Build purchasable_offer using the configured variation
    // This allows testing different payload structures to fix the price=0 issue
    const purchasableOffer = buildPurchasableOffer(item.price);

    console.log(`[AmazonSyncService] buildAttributes - Using variation: ${PRICE_PAYLOAD_VARIATION}`);
    console.log(`[AmazonSyncService] buildAttributes - Price value: ${item.price}`);
    console.log(`[AmazonSyncService] buildAttributes - purchasable_offer:`, JSON.stringify(purchasableOffer, null, 2));

    return {
      // CRITICAL: Link to existing ASIN - tells Amazon we're selling an existing product
      merchant_suggested_asin: [
        {
          value: item.asin,
          marketplace_id: 'A1F83G8C2ARO7P',
        },
      ],
      // Condition (new)
      condition_type: [
        {
          value: 'new_new', // Assuming new condition - TODO: could derive from inventory
          marketplace_id: 'A1F83G8C2ARO7P',
        },
      ],
      // List Price (RRP) - Required for UK marketplace since mid-2024
      // See: https://github.com/amzn/selling-partner-api-models/issues/3958
      // For UK marketplace, must use value_with_tax (price including VAT)
      list_price: [
        {
          marketplace_id: 'A1F83G8C2ARO7P',
          currency: 'GBP',
          value_with_tax: item.price,
        },
      ],
      // Purchasable Offer - contains our selling price (built via variation config)
      purchasable_offer: purchasableOffer,
      // Quantity
      fulfillment_availability: [
        {
          fulfillment_channel_code: 'DEFAULT',
          quantity: item.totalQuantity,
        },
      ],
    };
  }

  /**
   * Build patch operations for price and quantity
   */
  private buildPatches(item: AggregatedQueueItem): ListingsFeedPatch[] {
    // Build purchasable_offer using the configured variation for consistency
    const purchasableOffer = buildPurchasableOffer(item.price);

    console.log(`[AmazonSyncService] buildPatches - Using variation: ${PRICE_PAYLOAD_VARIATION}`);
    console.log(`[AmazonSyncService] buildPatches - Price value: ${item.price}`);
    console.log(`[AmazonSyncService] buildPatches - purchasable_offer:`, JSON.stringify(purchasableOffer, null, 2));

    return [
      {
        op: 'replace',
        path: '/attributes/purchasable_offer',
        value: purchasableOffer,
      },
      {
        op: 'replace',
        path: '/attributes/fulfillment_availability',
        value: [
          {
            fulfillment_channel_code: 'DEFAULT',
            quantity: item.totalQuantity,
          },
        ],
      },
    ];
  }

  // ==========================================================================
  // PRIVATE METHODS - VALIDATION
  // ==========================================================================

  /**
   * Validate items using Listings API dry run
   */
  private async validateItems(
    client: AmazonListingsClient,
    items: AggregatedQueueItem[]
  ): Promise<ListingsValidationResult[]> {
    const validationItems = items.map((item) => ({
      sku: item.amazonSku,
      productType: item.productType,
      patches: this.buildPatches(item),
    }));

    return client.validateListings(validationItems, 'A1F83G8C2ARO7P');
  }

  /**
   * Update feed items with validation results
   */
  private async updateFeedItemsWithValidation(
    feedId: string,
    results: ListingsValidationResult[]
  ): Promise<void> {
    for (const result of results) {
      const status: FeedItemStatus =
        result.status === 'VALID' ? 'success' : 'error';

      const updates: Database['public']['Tables']['amazon_sync_feed_items']['Update'] =
        {
          status,
          amazon_result_code: result.status,
        };

      if (result.issues && result.issues.length > 0) {
        const errors = result.issues.filter((i) => i.severity === 'ERROR');
        const warnings = result.issues.filter((i) => i.severity === 'WARNING');

        if (errors.length > 0) {
          updates.error_code = errors[0].code;
          updates.error_message = errors[0].message;
          updates.error_details = errors as unknown as Database['public']['Tables']['amazon_sync_feed_items']['Update']['error_details'];
        }

        if (warnings.length > 0) {
          updates.warnings = warnings as unknown as Database['public']['Tables']['amazon_sync_feed_items']['Update']['warnings'];
          if (status === 'success') {
            updates.status = 'warning';
          }
        }
      }

      await this.supabase
        .from('amazon_sync_feed_items')
        .update(updates)
        .eq('feed_id', feedId)
        .eq('amazon_sku', result.sku);
    }
  }

  // ==========================================================================
  // PRIVATE METHODS - FEED RESULTS
  // ==========================================================================

  /**
   * Process feed result from Amazon
   *
   * Amazon returns results in this format:
   * - summary: { errors, warnings, messagesProcessed, messagesAccepted, messagesInvalid }
   * - issues: [{ messageId, code, severity, message, sku }]
   *
   * If there are no issues, all items were accepted successfully.
   * Successfully synced items will have their inventory_items updated with:
   * - status: 'LISTED'
   * - listing_date: current timestamp
   */
  private async processFeedResult(
    feedId: string,
    result: FeedProcessingReport
  ): Promise<{ hasItemsNeedingVerification: boolean }> {
    console.log('[AmazonSyncService] Processing feed result:', JSON.stringify(result, null, 2));

    // Get all feed items to update their status
    const feedItems = await this.getFeedItems(feedId);
    console.log(`[AmazonSyncService] Found ${feedItems.length} feed items to process`);

    // Create a map of SKU -> issues
    const issuesBySku = new Map<string, typeof result.issues>();
    if (result.issues) {
      for (const issue of result.issues) {
        const existing = issuesBySku.get(issue.sku) || [];
        existing.push(issue);
        issuesBySku.set(issue.sku, existing);
      }
    }

    // Collect inventory item IDs that were successfully synced
    const successfulInventoryItemIds: string[] = [];
    let hasItemsNeedingVerification = false;

    // Update each feed item based on the result
    for (const feedItem of feedItems) {
      const issues = issuesBySku.get(feedItem.amazon_sku) || [];
      const errors = issues.filter(i => i.severity === 'ERROR');
      const warnings = issues.filter(i => i.severity === 'WARNING');

      let status: FeedItemStatus;
      if (errors.length > 0) {
        status = 'error';
      } else if (warnings.length > 0) {
        status = 'warning';
      } else {
        // For new SKUs, use 'accepted' status - price verification still needed
        // For existing SKUs, use 'success' - updates are immediate
        if (feedItem.is_new_sku) {
          status = 'accepted';
          hasItemsNeedingVerification = true;
          console.log(`[AmazonSyncService] Feed item ${feedItem.amazon_sku} is new SKU - needs price verification`);
        } else {
          status = 'success';
        }
      }

      const updates: Database['public']['Tables']['amazon_sync_feed_items']['Update'] =
        {
          status,
          amazon_result_code: status === 'accepted' || status === 'success' ? 'ACCEPTED' : status === 'warning' ? 'WARNING' : 'ERROR',
        };

      if (errors.length > 0) {
        updates.error_code = errors[0].code;
        updates.error_message = errors[0].message;
        updates.error_details = errors as unknown as Database['public']['Tables']['amazon_sync_feed_items']['Update']['error_details'];
      }

      if (warnings.length > 0) {
        updates.warnings = warnings as unknown as Database['public']['Tables']['amazon_sync_feed_items']['Update']['warnings'];
      }

      console.log(`[AmazonSyncService] Updating feed item ${feedItem.amazon_sku} to status: ${status}`);

      await this.supabase
        .from('amazon_sync_feed_items')
        .update(updates)
        .eq('id', feedItem.id);

      // Collect successful/accepted inventory item IDs for status update
      // Note: For 'accepted' items, we set LISTED now but price might not be visible yet
      if (status === 'success' || status === 'warning' || status === 'accepted') {
        successfulInventoryItemIds.push(...feedItem.inventory_item_ids);
      }
    }

    // Update inventory items to LISTED status
    if (successfulInventoryItemIds.length > 0) {
      await this.updateInventoryItemsAsListed(successfulInventoryItemIds);
    }

    // Note: We don't update platform_listings here because that table is designed
    // for bulk imports with an import_id foreign key. Instead, we rely on the
    // Amazon API query in addToQueue() to detect existing listings (Option B fix).

    return { hasItemsNeedingVerification };
  }

  /**
   * Update inventory items to LISTED status after successful Amazon sync
   *
   * Sets:
   * - status: 'LISTED'
   * - listing_date: current timestamp
   * - listing_platform: 'amazon'
   */
  private async updateInventoryItemsAsListed(
    inventoryItemIds: string[]
  ): Promise<void> {
    console.log(`[AmazonSyncService] Updating ${inventoryItemIds.length} inventory items to LISTED status`);

    const { error } = await this.supabase
      .from('inventory_items')
      .update({
        status: 'LISTED',
        listing_date: new Date().toISOString(),
        listing_platform: 'amazon',
      })
      .in('id', inventoryItemIds)
      .eq('user_id', this.userId);

    if (error) {
      console.error('[AmazonSyncService] Failed to update inventory items:', error);
      // Don't throw - this is a secondary operation, the feed sync was still successful
    } else {
      console.log(`[AmazonSyncService] Successfully updated ${inventoryItemIds.length} inventory items to LISTED`);
    }
  }

  // ==========================================================================
  // PRIVATE METHODS - DATABASE
  // ==========================================================================

  /**
   * Create a feed record
   */
  private async createFeedRecord(
    totalItems: number,
    isDryRun: boolean
  ): Promise<AmazonSyncFeedRow> {
    const { data, error } = await this.supabase
      .from('amazon_sync_feeds')
      .insert({
        user_id: this.userId,
        feed_type: 'JSON_LISTINGS_FEED',
        is_dry_run: isDryRun,
        marketplace_id: 'A1F83G8C2ARO7P',
        status: 'pending',
        total_items: totalItems,
      })
      .select()
      .single();

    if (error) {
      throw new Error(`Failed to create feed record: ${error.message}`);
    }

    return data;
  }

  /**
   * Update a feed record
   */
  private async updateFeedRecord(
    feedId: string,
    updates: Database['public']['Tables']['amazon_sync_feeds']['Update']
  ): Promise<void> {
    const { error } = await this.supabase
      .from('amazon_sync_feeds')
      .update(updates)
      .eq('id', feedId)
      .eq('user_id', this.userId);

    if (error) {
      throw new Error(`Failed to update feed record: ${error.message}`);
    }
  }

  /**
   * Create feed items for each aggregated ASIN
   */
  private async createFeedItems(
    feedId: string,
    items: AggregatedQueueItem[]
  ): Promise<void> {
    const feedItems: Database['public']['Tables']['amazon_sync_feed_items']['Insert'][] =
      items.map((item) => ({
        user_id: this.userId,
        feed_id: feedId,
        asin: item.asin,
        amazon_sku: item.amazonSku,
        submitted_price: item.price,
        submitted_quantity: item.totalQuantity,
        inventory_item_ids: item.inventoryItemIds,
        status: 'pending',
        is_new_sku: item.isNewSku, // Track if this needs price verification
      }));

    const { error } = await this.supabase
      .from('amazon_sync_feed_items')
      .insert(feedItems);

    if (error) {
      throw new Error(`Failed to create feed items: ${error.message}`);
    }
  }

  /**
   * Clear queue items for successfully submitted feed
   */
  private async clearQueueForFeed(
    items: AggregatedQueueItem[]
  ): Promise<void> {
    const queueItemIds = items.flatMap((i) => i.queueItemIds);

    if (queueItemIds.length === 0) {
      return;
    }

    const { error } = await this.supabase
      .from('amazon_sync_queue')
      .delete()
      .in('id', queueItemIds)
      .eq('user_id', this.userId);

    if (error) {
      console.error('[AmazonSyncService] Failed to clear queue:', error);
    }
  }

  // ==========================================================================
  // PRIVATE METHODS - HELPERS
  // ==========================================================================

  /**
   * Get Amazon credentials for the user
   */
  private async getAmazonCredentials(): Promise<AmazonCredentials | null> {
    return this.credentialsRepo.getCredentials<AmazonCredentials>(
      this.userId,
      'amazon'
    );
  }

  /**
   * Get the latest Amazon listing for an ASIN
   */
  private async getLatestAmazonListing(
    asin: string
  ): Promise<PlatformListingRow | null> {
    const { data, error } = await this.supabase
      .from('platform_listings')
      .select('*')
      .eq('user_id', this.userId)
      .eq('platform', 'amazon')
      .eq('platform_item_id', asin)
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    if (error) {
      if (error.code === 'PGRST116') {
        return null;
      }
      throw new Error(`Failed to get Amazon listing: ${error.message}`);
    }

    return data;
  }

  /**
   * Generate a unique seller SKU for a new Amazon listing
   *
   * Format: HB-{ASIN}-{randomSuffix}
   * - HB prefix identifies Hadley Bricks listings
   * - ASIN for traceability
   * - Random suffix ensures uniqueness
   * - Total max 40 chars (Amazon limit)
   */
  private generateSellerSku(asin: string): string {
    // Generate a random 4-character alphanumeric suffix
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let suffix = '';
    for (let i = 0; i < 4; i++) {
      suffix += chars.charAt(Math.floor(Math.random() * chars.length));
    }

    // Format: HB-{ASIN}-{suffix}
    // ASIN is typically 10 chars, so total would be: 3 + 10 + 1 + 4 = 18 chars (well under 40)
    return `HB-${asin}-${suffix}`;
  }

  // ==========================================================================
  // PRIVATE METHODS - PRODUCT TYPE CACHING
  // ==========================================================================

  /**
   * Get product type for an ASIN with caching
   *
   * 1. Check amazon_product_cache for existing entry
   * 2. If cache hit and fresh (within TTL), return cached value
   * 3. If cache miss, call Amazon Catalog Items API
   * 4. Cache the result for future use
   * 5. Return product type or default fallback
   */
  private async getProductTypeForAsin(
    asin: string,
    marketplaceId: string
  ): Promise<string> {
    console.log(`[AmazonSyncService] Getting product type for ASIN: ${asin}`);

    // 1. Check cache first
    const cachedEntry = await this.getCachedProductType(asin, marketplaceId);

    // Only use cache if fresh AND has a product type (skip null entries to re-fetch)
    if (cachedEntry && cachedEntry.product_type && this.isCacheFresh(cachedEntry.fetched_at, PRODUCT_TYPE_CACHE_TTL_DAYS)) {
      console.log(`[AmazonSyncService] Cache hit for ${asin}: ${cachedEntry.product_type}`);
      return cachedEntry.product_type;
    }

    // Log if we're skipping a null cache entry
    if (cachedEntry && !cachedEntry.product_type) {
      console.log(`[AmazonSyncService] Cache entry for ${asin} has null product_type, re-fetching from API`);
    }

    // 2. Cache miss or stale - call Amazon Catalog API
    try {
      const credentials = await this.getAmazonCredentials();

      if (!credentials) {
        console.warn(`[AmazonSyncService] No Amazon credentials, using default product type`);
        return DEFAULT_PRODUCT_TYPE;
      }

      const catalogClient = new AmazonCatalogClient(credentials);
      const result = await catalogClient.getCatalogItem(asin, marketplaceId);

      // 3. Cache the result
      await this.cacheProductType(asin, marketplaceId, result);

      // 4. Return product type or fallback
      if (result.productType) {
        console.log(`[AmazonSyncService] API returned product type: ${result.productType}`);
        return result.productType;
      }

      console.warn(`[AmazonSyncService] No product type found for ${asin}, using default`);
      return DEFAULT_PRODUCT_TYPE;
    } catch (error) {
      console.error(`[AmazonSyncService] Failed to get product type for ${asin}:`, error);

      // If we have a stale cache entry, use it as fallback
      if (cachedEntry?.product_type) {
        console.log(`[AmazonSyncService] Using stale cached value: ${cachedEntry.product_type}`);
        return cachedEntry.product_type;
      }

      // Final fallback
      return DEFAULT_PRODUCT_TYPE;
    }
  }

  /**
   * Get cached product type from database
   */
  private async getCachedProductType(
    asin: string,
    marketplaceId: string
  ): Promise<AmazonProductCacheRow | null> {
    const { data, error } = await this.supabase
      .from('amazon_product_cache')
      .select('*')
      .eq('user_id', this.userId)
      .eq('asin', asin)
      .eq('marketplace_id', marketplaceId)
      .single();

    if (error) {
      if (error.code === 'PGRST116') {
        // No matching row found
        return null;
      }
      console.error(`[AmazonSyncService] Error fetching product cache:`, error);
      return null;
    }

    return data;
  }

  /**
   * Cache product type result in database
   */
  private async cacheProductType(
    asin: string,
    marketplaceId: string,
    result: ProductTypeResult
  ): Promise<void> {
    const cacheEntry: Database['public']['Tables']['amazon_product_cache']['Insert'] = {
      user_id: this.userId,
      asin,
      marketplace_id: marketplaceId,
      product_type: result.productType,
      title: result.title,
      brand: result.brand,
      fetched_at: new Date().toISOString(),
      raw_response: result.raw as unknown as Database['public']['Tables']['amazon_product_cache']['Insert']['raw_response'],
    };

    // Upsert - update if exists, insert if not
    const { error } = await this.supabase
      .from('amazon_product_cache')
      .upsert(cacheEntry, {
        onConflict: 'user_id,asin,marketplace_id',
      });

    if (error) {
      console.error(`[AmazonSyncService] Failed to cache product type:`, error);
      // Don't throw - caching failure shouldn't break the flow
    } else {
      console.log(`[AmazonSyncService] Cached product type for ${asin}: ${result.productType}`);
    }
  }

  /**
   * Check if cache entry is still fresh based on TTL
   */
  private isCacheFresh(fetchedAt: string, ttlDays: number): boolean {
    const fetchedDate = new Date(fetchedAt);
    const now = new Date();
    const diffMs = now.getTime() - fetchedDate.getTime();
    const diffDays = diffMs / (1000 * 60 * 60 * 24);
    return diffDays < ttlDays;
  }

}
