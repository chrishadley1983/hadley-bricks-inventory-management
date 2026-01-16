/**
 * Amazon Stock Service
 *
 * Implements platform-specific logic for Amazon stock reconciliation.
 * Handles importing listings from SP-API and comparing against inventory.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database, Json } from '@hadley-bricks/database';
import type { AmazonCredentials } from '@/lib/amazon/types';
import { CredentialsRepository } from '@/lib/repositories/credentials.repository';
import { PlatformStockService } from '../platform-stock.service';
import { AmazonReportsClient } from './amazon-reports.client';
import { parseAmazonListingsReport } from './amazon-report-parser';
import type {
  StockPlatform,
  ListingImport,
  StockComparison,
  ComparisonSummary,
  ComparisonFilters,
  DiscrepancyType,
} from '../types';

// Use Supabase generated types for database operations
type PlatformListingInsert = Database['public']['Tables']['platform_listings']['Insert'];

// ============================================================================
// AMAZON STOCK SERVICE
// ============================================================================

/**
 * Amazon-specific stock service
 *
 * Handles:
 * - Importing listings via GET_MERCHANT_LISTINGS_ALL_DATA report
 * - Comparing listings against inventory by ASIN
 */
export class AmazonStockService extends PlatformStockService {
  readonly platform: StockPlatform = 'amazon';

  private credentialsRepo: CredentialsRepository;

  constructor(supabase: SupabaseClient<Database>, userId: string) {
    super(supabase, userId);
    this.credentialsRepo = new CredentialsRepository(supabase);
  }

  // ==========================================================================
  // IMPORT METHODS
  // ==========================================================================

  /**
   * Trigger a new Amazon listings import
   *
   * Workflow:
   * 1. Get Amazon credentials
   * 2. Create import record
   * 3. Request report from SP-API
   * 4. Wait for report to complete
   * 5. Download and parse report
   * 6. Store listings in database
   */
  async triggerImport(): Promise<ListingImport> {
    console.log('[AmazonStockService] Starting listings import...');

    // 1. Get Amazon credentials
    const credentials = await this.getAmazonCredentials();
    if (!credentials) {
      throw new Error(
        'Amazon credentials not configured. Please set up Amazon integration first.'
      );
    }

    // 2. Create import record
    const importId = await this.createImportRecord({
      amazon_report_type: 'GET_MERCHANT_LISTINGS_ALL_DATA',
    });

    try {
      // 3. Create reports client and fetch report
      const client = new AmazonReportsClient(credentials);

      console.log('[AmazonStockService] Requesting report from Amazon...');
      const reportContent = await client.fetchMerchantListingsReport(
        credentials.marketplaceIds
      );

      // 4. Parse report
      console.log('[AmazonStockService] Parsing report...');
      const parseResult = parseAmazonListingsReport(reportContent);

      if (parseResult.errors.length > 0) {
        console.warn(
          '[AmazonStockService] Parse errors:',
          parseResult.errors.slice(0, 5)
        );
      }

      // 5. Delete old listings
      console.log('[AmazonStockService] Clearing old listings...');
      await this.deleteOldListings();

      // 6. Insert new listings
      console.log(
        `[AmazonStockService] Inserting ${parseResult.listings.length} listings...`
      );

      const listingRows: PlatformListingInsert[] = parseResult.listings.map((listing) => ({
        user_id: this.userId,
        platform: 'amazon',
        platform_sku: listing.sellerSku || null,
        platform_item_id: listing.asin,
        title: listing.title || null,
        quantity: listing.quantity,
        price: listing.price,
        currency: 'GBP',
        listing_status: listing.listingStatus,
        fulfillment_channel: listing.fulfillmentChannel,
        amazon_data: listing.amazonData as unknown as Json,
        ebay_data: null,
        bricklink_data: null,
        import_id: importId,
        raw_data: listing.rawRow as unknown as Json,
      }));

      const inserted = await this.insertListingsBatch(importId, listingRows);

      // 7. Mark import complete
      await this.updateImportRecord(importId, {
        status: 'completed',
        total_rows: parseResult.totalRows,
        processed_rows: inserted,
        error_count: parseResult.skippedRows,
        completed_at: new Date().toISOString(),
      });

      console.log(
        `[AmazonStockService] Import complete: ${inserted} listings imported`
      );

      const importRecord = await this.getImportStatus(importId);
      return importRecord!;
    } catch (error) {
      // Mark import as failed
      await this.updateImportRecord(importId, {
        status: 'failed',
        error_message:
          error instanceof Error ? error.message : 'Unknown error',
        completed_at: new Date().toISOString(),
      });

      console.error('[AmazonStockService] Import failed:', error);
      throw error;
    }
  }

  // ==========================================================================
  // COMPARISON METHODS
  // ==========================================================================

  /**
   * Get stock comparison between Amazon listings and inventory
   *
   * Algorithm:
   * 1. Fetch all Amazon listings from platform_listings
   * 2. Fetch inventory items where listing_platform='amazon' and status='LISTED' (with ASIN)
   * 3. Fetch inventory items where listing_platform='amazon' but no ASIN (missing link)
   * 4. Group inventory by ASIN (since individual items are separate rows)
   * 5. Compare quantities and identify discrepancies
   */
  async getStockComparison(filters: ComparisonFilters): Promise<{
    comparisons: StockComparison[];
    summary: ComparisonSummary;
  }> {
    console.log('[AmazonStockService] Building stock comparison...');

    // 1. Get all Amazon listings
    const listings = await this.getAllListings();

    // 2. Get inventory items listed on Amazon (with ASIN)
    const inventoryItems = await this.getAmazonInventoryItems();

    // 3. Get inventory items marked as Amazon but missing ASIN
    const missingAsinItems = await this.getAmazonInventoryItemsMissingAsin();
    console.log(`[AmazonStockService] Found ${missingAsinItems.length} items missing ASIN`);

    // 4. Build comparison map keyed by ASIN
    const comparisonMap = new Map<string, StockComparison>();

    // Process platform listings first
    for (const listing of listings) {
      const asin = listing.platformItemId;

      comparisonMap.set(asin, {
        platformItemId: asin,
        platformTitle: listing.title,
        platformQuantity: listing.quantity,
        platformListingStatus: listing.listingStatus,
        platformFulfillmentChannel: listing.fulfillmentChannel,
        platformPrice: listing.price,
        platformSku: listing.platformSku,
        inventoryQuantity: 0,
        inventoryTotalValue: 0,
        inventoryItems: [],
        discrepancyType: 'platform_only',
        quantityDifference: listing.quantity,
        priceDifference: null,
      });
    }

    // Process inventory items missing ASIN (group by set_number as pseudo-key)
    // These are items marked as Amazon platform but without a linked ASIN
    const missingAsinBySetNumber = new Map<string, AmazonInventoryItem[]>();
    for (const item of missingAsinItems) {
      const existing = missingAsinBySetNumber.get(item.setNumber) || [];
      existing.push(item);
      missingAsinBySetNumber.set(item.setNumber, existing);
    }

    console.log(`[AmazonStockService] Missing ASIN grouped into ${missingAsinBySetNumber.size} unique set numbers`);

    // Add missing ASIN items to comparison map with special key prefix
    for (const [setNumber, items] of missingAsinBySetNumber) {
      const key = `NO_ASIN:${setNumber}`;
      const totalValue = items.reduce((sum, i) => sum + (i.listingValue || 0), 0);

      comparisonMap.set(key, {
        platformItemId: key,
        platformTitle: items[0].itemName || `Set ${setNumber} (Missing ASIN)`,
        platformQuantity: 0, // Not on platform (no ASIN to match)
        platformListingStatus: null,
        platformFulfillmentChannel: null,
        platformPrice: null,
        platformSku: null,
        inventoryQuantity: items.length,
        inventoryTotalValue: totalValue,
        inventoryItems: items.map((item) => ({
          id: item.id,
          setNumber: item.setNumber,
          itemName: item.itemName,
          condition: item.condition,
          listingValue: item.listingValue,
          storageLocation: item.storageLocation,
          sku: item.sku,
          status: item.status,
          createdAt: item.createdAt,
        })),
        discrepancyType: 'missing_asin',
        quantityDifference: -items.length, // All are missing from platform
        priceDifference: null,
      });
      console.log(`[AmazonStockService] Added missing ASIN entry for set ${setNumber} with ${items.length} items`);
    }

    console.log(`[AmazonStockService] Comparison map size after adding missing ASIN: ${comparisonMap.size}`);

    // Process inventory items
    for (const item of inventoryItems) {
      const asin = item.amazonAsin;
      if (!asin) continue;

      const existing = comparisonMap.get(asin);

      if (existing) {
        // Add to existing comparison
        existing.inventoryQuantity += 1;
        existing.inventoryTotalValue += item.listingValue || 0;
        existing.inventoryItems.push({
          id: item.id,
          setNumber: item.setNumber,
          itemName: item.itemName,
          condition: item.condition,
          listingValue: item.listingValue,
          storageLocation: item.storageLocation,
          sku: item.sku,
          status: item.status,
          createdAt: item.createdAt,
        });
      } else {
        // Inventory-only item (not listed on Amazon)
        comparisonMap.set(asin, {
          platformItemId: asin,
          platformTitle: null,
          platformQuantity: 0,
          platformListingStatus: null,
          platformFulfillmentChannel: null,
          platformPrice: null,
          platformSku: null,
          inventoryQuantity: 1,
          inventoryTotalValue: item.listingValue || 0,
          inventoryItems: [
            {
              id: item.id,
              setNumber: item.setNumber,
              itemName: item.itemName,
              condition: item.condition,
              listingValue: item.listingValue,
              storageLocation: item.storageLocation,
              sku: item.sku,
              status: item.status,
              createdAt: item.createdAt,
            },
          ],
          discrepancyType: 'inventory_only',
          quantityDifference: -1,
          priceDifference: null,
        });
      }
    }

    // Calculate discrepancy types and differences
    for (const comparison of comparisonMap.values()) {
      comparison.quantityDifference =
        comparison.platformQuantity - comparison.inventoryQuantity;

      // Skip items that already have missing_asin type - don't overwrite
      if (comparison.discrepancyType === 'missing_asin') {
        continue;
      }

      // Determine discrepancy type
      if (comparison.quantityDifference === 0) {
        // Quantities match (including both being 0)
        comparison.discrepancyType = 'match';
      } else if (comparison.inventoryQuantity === 0) {
        // Platform has stock but no inventory items linked
        comparison.discrepancyType = 'platform_only';
      } else if (comparison.platformQuantity === 0) {
        // Inventory has items but platform shows 0 stock
        // This is a quantity mismatch - item is listed but out of stock on platform
        comparison.discrepancyType = 'quantity_mismatch';

        // Calculate price difference if we have both prices
        if (
          comparison.platformPrice !== null &&
          comparison.inventoryItems.length > 0
        ) {
          const avgInventoryPrice =
            comparison.inventoryTotalValue / comparison.inventoryQuantity;
          comparison.priceDifference =
            comparison.platformPrice - avgInventoryPrice;
        }
      } else {
        // Both have stock but quantities differ
        comparison.discrepancyType = 'quantity_mismatch';

        // Calculate price difference if we have both prices
        if (
          comparison.platformPrice !== null &&
          comparison.inventoryItems.length > 0
        ) {
          const avgInventoryPrice =
            comparison.inventoryTotalValue / comparison.inventoryQuantity;
          comparison.priceDifference =
            comparison.platformPrice - avgInventoryPrice;
        }
      }
      // inventory_only is set during inventory processing for items not on platform
    }

    // Convert to array
    let comparisons = Array.from(comparisonMap.values());

    // Apply filters
    if (filters.discrepancyType && filters.discrepancyType !== 'all') {
      comparisons = comparisons.filter(
        (c) => c.discrepancyType === filters.discrepancyType
      );
    }

    if (filters.search) {
      const searchLower = filters.search.toLowerCase();
      comparisons = comparisons.filter(
        (c) =>
          c.platformItemId.toLowerCase().includes(searchLower) ||
          c.platformTitle?.toLowerCase().includes(searchLower) ||
          c.platformSku?.toLowerCase().includes(searchLower) ||
          c.inventoryItems.some(
            (item) =>
              item.setNumber.toLowerCase().includes(searchLower) ||
              item.itemName?.toLowerCase().includes(searchLower)
          )
      );
    }

    // Sort by discrepancy type (issues first) then by title
    const discrepancyOrder: Record<DiscrepancyType, number> = {
      missing_asin: 0, // Most critical - can't even verify if listed
      platform_only: 1,
      inventory_only: 2,
      quantity_mismatch: 3,
      price_mismatch: 4,
      match: 5,
    };

    comparisons.sort((a, b) => {
      const orderDiff =
        discrepancyOrder[a.discrepancyType] -
        discrepancyOrder[b.discrepancyType];
      if (orderDiff !== 0) return orderDiff;
      return (a.platformTitle || '').localeCompare(b.platformTitle || '');
    });

    // Calculate summary
    const latestImport = await this.getLatestImport();

    const allComparisons = Array.from(comparisonMap.values());
    const summary: ComparisonSummary = {
      totalPlatformListings: listings.length,
      totalPlatformQuantity: listings.reduce((sum, l) => sum + l.quantity, 0),
      totalInventoryItems: inventoryItems.length + missingAsinItems.length,
      matchedItems: allComparisons.filter((c) => c.discrepancyType === 'match')
        .length,
      platformOnlyItems: allComparisons.filter(
        (c) => c.discrepancyType === 'platform_only'
      ).length,
      inventoryOnlyItems: allComparisons.filter(
        (c) => c.discrepancyType === 'inventory_only'
      ).length,
      quantityMismatches: allComparisons.filter(
        (c) => c.discrepancyType === 'quantity_mismatch'
      ).length,
      priceMismatches: allComparisons.filter(
        (c) => c.discrepancyType === 'price_mismatch'
      ).length,
      missingAsinItems: allComparisons.filter(
        (c) => c.discrepancyType === 'missing_asin'
      ).length,
      lastImportAt: latestImport?.completedAt || null,
    };

    console.log(
      `[AmazonStockService] Comparison complete: ${comparisons.length} items after filters`
    );
    console.log(`[AmazonStockService] Summary: missingAsinItems=${summary.missingAsinItems}, allComparisons count=${allComparisons.length}`);

    // Debug: count missing_asin items
    const missingAsinCount = allComparisons.filter((c) => c.discrepancyType === 'missing_asin').length;
    console.log(`[AmazonStockService] Direct count of missing_asin: ${missingAsinCount}`);

    return { comparisons, summary };
  }

  // ==========================================================================
  // PRIVATE HELPER METHODS
  // ==========================================================================

  /**
   * Get Amazon credentials for the user
   */
  private async getAmazonCredentials(): Promise<AmazonCredentials | null> {
    try {
      return await this.credentialsRepo.getCredentials<AmazonCredentials>(
        this.userId,
        'amazon'
      );
    } catch (error) {
      console.error(
        '[AmazonStockService] Error fetching credentials:',
        error
      );
      return null;
    }
  }

  /**
   * Get inventory items listed on Amazon (with ASIN)
   *
   * Fetches items where:
   * - status = 'LISTED'
   * - listing_platform ILIKE 'amazon'
   * - amazon_asin IS NOT NULL
   */
  private async getAmazonInventoryItems(): Promise<AmazonInventoryItem[]> {
    const allItems: AmazonInventoryItem[] = [];
    const pageSize = 1000;
    let page = 0;
    let hasMore = true;

    console.log(`[AmazonStockService] getAmazonInventoryItems: userId=${this.userId}`);

    while (hasMore) {
      const { data, error } = await this.supabase
        .from('inventory_items')
        .select(
          'id, set_number, item_name, condition, amazon_asin, listing_value, storage_location, sku, status, created_at'
        )
        .eq('user_id', this.userId)
        .eq('status', 'LISTED')
        .ilike('listing_platform', '%amazon%')
        .not('amazon_asin', 'is', null)
        .range(page * pageSize, (page + 1) * pageSize - 1);

      console.log(`[AmazonStockService] Inventory WITH ASIN query page ${page}: error=${error?.message || 'none'}, count=${data?.length || 0}`);

      if (error) {
        throw new Error(`Failed to fetch inventory items: ${error.message}`);
      }

      const items = (data || []).map((row) => ({
        id: row.id,
        setNumber: row.set_number,
        itemName: row.item_name,
        condition: row.condition,
        amazonAsin: row.amazon_asin,
        listingValue: row.listing_value ? Number(row.listing_value) : null,
        storageLocation: row.storage_location,
        sku: row.sku,
        status: row.status || 'LISTED', // Default to LISTED since we filter by it
        createdAt: row.created_at,
      }));

      allItems.push(...items);
      hasMore = (data?.length ?? 0) === pageSize;
      page++;
    }

    return allItems;
  }

  /**
   * Get inventory items marked as Amazon platform but missing ASIN
   *
   * Fetches items where:
   * - status = 'LISTED'
   * - listing_platform ILIKE 'amazon'
   * - amazon_asin IS NULL
   *
   * These represent items supposedly listed on Amazon but without a linked ASIN
   */
  private async getAmazonInventoryItemsMissingAsin(): Promise<AmazonInventoryItem[]> {
    const allItems: AmazonInventoryItem[] = [];
    const pageSize = 1000;
    let page = 0;
    let hasMore = true;

    console.log(`[AmazonStockService] getAmazonInventoryItemsMissingAsin: userId=${this.userId}`);

    while (hasMore) {
      const { data, error } = await this.supabase
        .from('inventory_items')
        .select(
          'id, set_number, item_name, condition, amazon_asin, listing_value, storage_location, sku, status, created_at, listing_platform'
        )
        .eq('user_id', this.userId)
        .eq('status', 'LISTED')
        .ilike('listing_platform', '%amazon%')
        .is('amazon_asin', null)
        .range(page * pageSize, (page + 1) * pageSize - 1);

      console.log(`[AmazonStockService] Missing ASIN query page ${page}: error=${error?.message || 'none'}, count=${data?.length || 0}`);
      if (data && data.length > 0) {
        console.log(`[AmazonStockService] First item:`, JSON.stringify(data[0]));
      }

      if (error) {
        throw new Error(`Failed to fetch inventory items missing ASIN: ${error.message}`);
      }

      const items = (data || []).map((row) => ({
        id: row.id,
        setNumber: row.set_number,
        itemName: row.item_name,
        condition: row.condition,
        amazonAsin: row.amazon_asin,
        listingValue: row.listing_value ? Number(row.listing_value) : null,
        storageLocation: row.storage_location,
        sku: row.sku,
        status: row.status || 'LISTED',
        createdAt: row.created_at,
      }));

      allItems.push(...items);
      hasMore = (data?.length ?? 0) === pageSize;
      page++;
    }

    return allItems;
  }
}

// ============================================================================
// HELPER TYPES
// ============================================================================

interface AmazonInventoryItem {
  id: string;
  setNumber: string;
  itemName: string | null;
  condition: string | null;
  amazonAsin: string | null;
  listingValue: number | null;
  storageLocation: string | null;
  sku: string | null;
  status: string;
  createdAt: string;
}
