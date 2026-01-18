/**
 * eBay Stock Service
 *
 * Handles eBay listing import via Trading API and stock comparison.
 * Extends PlatformStockService with eBay-specific functionality.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@hadley-bricks/database';
import { PlatformStockService } from '../platform-stock.service';
import { EbayTradingClient, EbayTradingApiError } from './ebay-trading.client';
import { EbayAuthService } from '@/lib/ebay/ebay-auth.service';
import type {
  StockPlatform,
  ListingImport,
  ComparisonFilters,
  ComparisonSummary,
  DiscrepancyType,
} from '../types';
import type {
  ParsedEbayListing,
  EbayStockComparison,
  SkuValidationResult,
  SkuIssue,
  EbaySkuIssueRow,
  EbayListingData,
} from './types';

// Database insert type
type PlatformListingInsert = Database['public']['Tables']['platform_listings']['Insert'];

// ============================================================================
// EbayStockService Class
// ============================================================================

export class EbayStockService extends PlatformStockService {
  readonly platform: StockPlatform = 'ebay';
  private ebayAuth: EbayAuthService;

  constructor(supabase: SupabaseClient<Database>, userId: string) {
    super(supabase, userId);
    this.ebayAuth = new EbayAuthService();
  }

  // ============================================================================
  // IMPORT METHODS
  // ============================================================================

  /**
   * Trigger a full import of eBay listings via Trading API
   */
  async triggerImport(): Promise<ListingImport> {
    console.log(`[EbayStockService] Starting import for user ${this.userId}`);

    // 1. Get access token (handles refresh automatically)
    const accessToken = await this.ebayAuth.getAccessToken(this.userId);
    if (!accessToken) {
      throw new Error('eBay not connected. Please connect your eBay account first.');
    }

    // 2. Create import record
    const importId = await this.createImportRecord({
      status: 'processing',
    });

    try {
      // 3. Create Trading API client
      const tradingClient = new EbayTradingClient({
        accessToken,
        siteId: 3, // UK
      });

      // 4. Fetch all active listings with progress tracking
      const allListings = await tradingClient.getAllActiveListings(
        async (current, total) => {
          await this.updateImportRecord(importId, {
            processed_rows: current,
            total_rows: total,
          });
        }
      );

      console.log(`[EbayStockService] Fetched ${allListings.length} listings`);

      // 5. Upsert listings (preserving review data atomically)
      const listingsToUpsert = allListings.map((listing) =>
        this.convertToDbListing(importId, listing)
      );

      const upsertedCount = await this.upsertListingsBatch(importId, listingsToUpsert);
      console.log(`[EbayStockService] Upserted ${upsertedCount} listings`);

      // 6. Delete listings that no longer exist on eBay (but preserve review data in case of re-listing)
      const currentItemIds = new Set(allListings.map((l) => l.platformItemId));
      await this.deleteStaleListings(currentItemIds);

      // 7. Validate SKUs and get issues
      const skuValidation = await this.validateSkus();

      // 8. Complete import
      await this.updateImportRecord(importId, {
        status: 'completed',
        completed_at: new Date().toISOString(),
        total_rows: allListings.length,
        processed_rows: upsertedCount,
        error_count: skuValidation.totalIssueCount,
        error_details: skuValidation.hasIssues ? (skuValidation as unknown as Database['public']['Tables']['platform_listing_imports']['Update']['error_details']) : null,
      });

      const result = await this.getImportStatus(importId);
      if (!result) {
        throw new Error('Failed to retrieve import status');
      }

      return result;
    } catch (error) {
      console.error('[EbayStockService] Import failed:', error);

      // Update import as failed
      await this.updateImportRecord(importId, {
        status: 'failed',
        completed_at: new Date().toISOString(),
        error_message:
          error instanceof EbayTradingApiError
            ? `eBay API Error: ${error.message}`
            : error instanceof Error
              ? error.message
              : 'Unknown error during import',
      });

      throw error;
    }
  }

  /**
   * Convert parsed listing to database insert format
   */
  private convertToDbListing(
    importId: string,
    listing: ParsedEbayListing
  ): PlatformListingInsert {
    return {
      user_id: this.userId,
      platform: 'ebay',
      platform_sku: listing.platformSku,
      platform_item_id: listing.platformItemId,
      title: listing.title,
      quantity: listing.quantity,
      price: listing.price,
      currency: listing.currency,
      listing_status: listing.listingStatus,
      fulfillment_channel: null, // eBay doesn't have FBA/FBM
      ebay_data: listing.ebayData as unknown as Database['public']['Tables']['platform_listings']['Insert']['ebay_data'],
      import_id: importId,
      raw_data: listing.ebayData as unknown as Database['public']['Tables']['platform_listings']['Insert']['raw_data'],
    };
  }

  // ============================================================================
  // UPSERT AND CLEANUP METHODS
  // ============================================================================

  /**
   * Upsert listings in batches, preserving review data (quality_score, quality_grade, last_reviewed_at)
   * Uses ON CONFLICT to update existing records while keeping review fields intact
   */
  private async upsertListingsBatch(
    importId: string,
    listings: PlatformListingInsert[]
  ): Promise<number> {
    if (listings.length === 0) return 0;

    const BATCH_SIZE = 500;
    let totalUpserted = 0;

    for (let i = 0; i < listings.length; i += BATCH_SIZE) {
      const batch = listings.slice(i, i + BATCH_SIZE);

      // Use upsert with onConflict to preserve review data
      // The conflict target is (user_id, platform, platform_item_id)
      const { data, error } = await this.supabase
        .from('platform_listings')
        .upsert(
          batch.map((listing) => ({
            ...listing,
            updated_at: new Date().toISOString(),
          })),
          {
            onConflict: 'user_id,platform,platform_item_id',
            ignoreDuplicates: false, // Update existing records
          }
        )
        .select('id');

      if (error) {
        console.error(`[EbayStockService] Error upserting batch ${i / BATCH_SIZE + 1}:`, error);
        // Continue with other batches
      } else {
        totalUpserted += data?.length || batch.length;
      }
    }

    return totalUpserted;
  }

  /**
   * Delete listings that no longer exist on eBay
   * Only deletes listings not in the current import set
   */
  private async deleteStaleListings(currentItemIds: Set<string>): Promise<void> {
    // Get all existing listing IDs
    const { data: existingListings, error: fetchError } = await this.supabase
      .from('platform_listings')
      .select('id, platform_item_id')
      .eq('user_id', this.userId)
      .eq('platform', 'ebay');

    if (fetchError) {
      console.error('[EbayStockService] Error fetching existing listings for cleanup:', fetchError);
      return;
    }

    // Find IDs to delete (listings that no longer exist on eBay)
    const idsToDelete = (existingListings || [])
      .filter((listing) => !currentItemIds.has(listing.platform_item_id))
      .map((listing) => listing.id);

    if (idsToDelete.length === 0) {
      console.log('[EbayStockService] No stale listings to delete');
      return;
    }

    console.log(`[EbayStockService] Deleting ${idsToDelete.length} stale listings`);

    // Delete in batches
    const BATCH_SIZE = 500;
    for (let i = 0; i < idsToDelete.length; i += BATCH_SIZE) {
      const batch = idsToDelete.slice(i, i + BATCH_SIZE);
      const { error } = await this.supabase
        .from('platform_listings')
        .delete()
        .in('id', batch);

      if (error) {
        console.error(`[EbayStockService] Error deleting stale batch ${i / BATCH_SIZE + 1}:`, error);
      }
    }
  }

  // ============================================================================
  // SKU VALIDATION
  // ============================================================================

  /**
   * Validate SKUs for issues (empty or duplicate)
   */
  async validateSkus(): Promise<SkuValidationResult> {
    // Query platform_listings for eBay listings and check for SKU issues
    // Instead of using the view (which may not be in types), we do it in code
    const { data: allListings, error } = await this.supabase
      .from('platform_listings')
      .select('id, user_id, platform_sku, platform_item_id, title, quantity, price, listing_status, ebay_data, created_at')
      .eq('user_id', this.userId)
      .eq('platform', 'ebay');

    if (error) {
      console.error('[EbayStockService] Error validating SKUs:', error);
      // Return empty result on error - don't fail the import
      return {
        hasIssues: false,
        emptySkuCount: 0,
        duplicateSkuCount: 0,
        totalIssueCount: 0,
        issues: [],
      };
    }

    // Find empty SKUs
    const emptySkuListings = (allListings || []).filter(l => !l.platform_sku || l.platform_sku.trim() === '');

    // Find duplicate SKUs
    const skuCounts = new Map<string, number>();
    for (const listing of allListings || []) {
      if (listing.platform_sku && listing.platform_sku.trim() !== '') {
        const count = skuCounts.get(listing.platform_sku) || 0;
        skuCounts.set(listing.platform_sku, count + 1);
      }
    }

    const duplicateSkuValues = new Set<string>();
    for (const [sku, count] of skuCounts) {
      if (count > 1) {
        duplicateSkuValues.add(sku);
      }
    }

    const duplicateSkuListings = (allListings || []).filter(
      l => l.platform_sku && duplicateSkuValues.has(l.platform_sku)
    );

    // Convert to EbaySkuIssueRow format
    const rows: EbaySkuIssueRow[] = [
      ...emptySkuListings.map(l => ({
        id: l.id,
        user_id: l.user_id,
        platform_sku: l.platform_sku,
        platform_item_id: l.platform_item_id,
        title: l.title,
        quantity: l.quantity ?? 0,
        price: l.price,
        listing_status: l.listing_status,
        ebay_data: l.ebay_data,
        sku_count: 0,
        issue_type: 'empty' as const,
        created_at: l.created_at,
      })),
      ...duplicateSkuListings.map(l => ({
        id: l.id,
        user_id: l.user_id,
        platform_sku: l.platform_sku,
        platform_item_id: l.platform_item_id,
        title: l.title,
        quantity: l.quantity ?? 0,
        price: l.price,
        listing_status: l.listing_status,
        ebay_data: l.ebay_data,
        sku_count: skuCounts.get(l.platform_sku!) || 0,
        issue_type: 'duplicate' as const,
        created_at: l.created_at,
      })),
    ];
    const issues: SkuIssue[] = [];
    const duplicateSkus = new Set<string>();

    // Group duplicates together
    const skuGroups = new Map<string, EbaySkuIssueRow[]>();

    for (const row of rows) {
      if (row.issue_type === 'empty') {
        // Empty SKU - each is a separate issue
        const ebayData = row.ebay_data as EbayListingData | null;
        issues.push({
          id: row.id,
          sku: null,
          itemId: row.platform_item_id,
          title: row.title || '',
          quantity: row.quantity,
          price: row.price,
          listingStatus: row.listing_status,
          issueType: 'empty',
          viewItemUrl: ebayData?.viewItemUrl || null,
        });
      } else if (row.issue_type === 'duplicate' && row.platform_sku) {
        // Group duplicates by SKU
        if (!skuGroups.has(row.platform_sku)) {
          skuGroups.set(row.platform_sku, []);
        }
        skuGroups.get(row.platform_sku)!.push(row);
        duplicateSkus.add(row.platform_sku);
      }
    }

    // Convert duplicate groups to issues
    for (const [sku, groupRows] of skuGroups) {
      const duplicateItems = groupRows.map((r) => ({
        id: r.id,
        itemId: r.platform_item_id,
        title: r.title || '',
      }));

      for (const row of groupRows) {
        const ebayData = row.ebay_data as EbayListingData | null;
        issues.push({
          id: row.id,
          sku,
          itemId: row.platform_item_id,
          title: row.title || '',
          quantity: row.quantity,
          price: row.price,
          listingStatus: row.listing_status,
          issueType: 'duplicate',
          duplicateCount: groupRows.length,
          duplicateItems,
          viewItemUrl: ebayData?.viewItemUrl || null,
        });
      }
    }

    const emptySkuCount = issues.filter((i) => i.issueType === 'empty').length;

    return {
      hasIssues: issues.length > 0,
      emptySkuCount,
      duplicateSkuCount: duplicateSkus.size,
      totalIssueCount: issues.length,
      issues,
    };
  }

  /**
   * Get SKU issues for display
   */
  async getSkuIssues(): Promise<SkuValidationResult> {
    return this.validateSkus();
  }

  // ============================================================================
  // STOCK COMPARISON
  // ============================================================================

  /**
   * Get stock comparison between eBay and inventory
   * Matches on SKU with condition mismatch tracking
   */
  async getStockComparison(filters: ComparisonFilters): Promise<{
    comparisons: EbayStockComparison[];
    summary: ComparisonSummary;
  }> {
    // 1. Get all eBay listings
    const ebayListings = await this.getAllListings();
    console.log(`[EbayStockService] Comparison: ${ebayListings.length} eBay listings`);

    // 2. Get inventory items listed on eBay with SKU
    const { data: inventoryItems, error: invError } = await this.supabase
      .from('inventory_items')
      .select(
        'id, sku, set_number, item_name, condition, listing_value, storage_location, status, created_at'
      )
      .eq('user_id', this.userId)
      .eq('status', 'LISTED')
      .ilike('listing_platform', '%ebay%')
      .not('sku', 'is', null);

    if (invError) {
      console.error('[EbayStockService] Error fetching inventory:', invError);
      throw new Error(`Failed to fetch inventory: ${invError.message}`);
    }

    console.log(`[EbayStockService] Comparison: ${inventoryItems?.length || 0} inventory items`);

    // 3. Also get manual SKU mappings
    const { data: skuMappings } = await this.supabase
      .from('ebay_sku_mappings')
      .select('ebay_sku, inventory_item_id')
      .eq('user_id', this.userId);

    // Create a map of SKU -> inventory item IDs from mappings
    const skuMappingMap = new Map<string, string[]>();
    for (const mapping of skuMappings || []) {
      if (!skuMappingMap.has(mapping.ebay_sku)) {
        skuMappingMap.set(mapping.ebay_sku, []);
      }
      skuMappingMap.get(mapping.ebay_sku)!.push(mapping.inventory_item_id);
    }

    // 4. Build comparison map (keyed by SKU)
    const comparisonMap = new Map<string, EbayStockComparison>();

    // Process eBay listings first
    for (const listing of ebayListings) {
      const sku = listing.platformSku;
      if (!sku) continue; // Skip empty SKUs - handled in SKU issues

      const ebayData = (listing.rawData as unknown as EbayListingData) || {};

      // If SKU already exists, this is a duplicate - sum quantities
      if (comparisonMap.has(sku)) {
        const existing = comparisonMap.get(sku)!;
        existing.platformQuantity += listing.quantity;
        existing.quantityDifference = existing.platformQuantity - existing.inventoryQuantity;
        continue;
      }

      comparisonMap.set(sku, {
        platformItemId: sku, // Use SKU as the key for comparison
        platformTitle: listing.title,
        platformQuantity: listing.quantity,
        platformListingStatus: listing.listingStatus,
        platformFulfillmentChannel: null,
        platformPrice: listing.price,
        platformSku: sku,
        inventoryQuantity: 0,
        inventoryTotalValue: 0,
        inventoryItems: [],
        discrepancyType: 'platform_only',
        quantityDifference: listing.quantity,
        priceDifference: null,
        // eBay-specific fields
        ebayCondition: ebayData.condition || null,
        inventoryCondition: null,
        conditionMismatch: false,
        listingType: ebayData.listingType || null,
        ebayItemId: listing.platformItemId,
        viewItemUrl: ebayData.viewItemUrl || null,
      });
    }

    // Process inventory items
    for (const item of inventoryItems || []) {
      const sku = item.sku;
      if (!sku) continue;

      const comparison = comparisonMap.get(sku);

      if (comparison) {
        // Add to existing comparison (matched)
        comparison.inventoryQuantity += 1;
        comparison.inventoryTotalValue += item.listing_value || 0;
        comparison.inventoryItems.push({
          id: item.id,
          setNumber: item.set_number,
          itemName: item.item_name,
          condition: item.condition,
          listingValue: item.listing_value,
          storageLocation: item.storage_location,
          sku: item.sku,
          status: item.status || '',
          createdAt: item.created_at,
        });

        // Track inventory condition and check for mismatch
        if (!comparison.inventoryCondition) {
          comparison.inventoryCondition = item.condition;
        }

        // Check condition mismatch (New vs Used)
        if (comparison.ebayCondition && item.condition) {
          const ebayIsNew =
            comparison.ebayCondition.toLowerCase().includes('new') &&
            !comparison.ebayCondition.toLowerCase().includes('other');
          const invIsNew =
            item.condition.toLowerCase().includes('new') &&
            !item.condition.toLowerCase().includes('other');

          if (ebayIsNew !== invIsNew) {
            comparison.conditionMismatch = true;
          }
        }
      } else {
        // Inventory only - not listed on eBay platform
        const newComparison: EbayStockComparison = {
          platformItemId: sku,
          platformTitle: null,
          platformQuantity: 0,
          platformListingStatus: null,
          platformFulfillmentChannel: null,
          platformPrice: null,
          platformSku: sku,
          inventoryQuantity: 1,
          inventoryTotalValue: item.listing_value || 0,
          inventoryItems: [
            {
              id: item.id,
              setNumber: item.set_number,
              itemName: item.item_name,
              condition: item.condition,
              listingValue: item.listing_value,
              storageLocation: item.storage_location,
              sku: item.sku,
              status: item.status || '',
              createdAt: item.created_at,
            },
          ],
          discrepancyType: 'inventory_only',
          quantityDifference: -1,
          priceDifference: null,
          ebayCondition: null,
          inventoryCondition: item.condition,
          conditionMismatch: false,
          listingType: null,
          ebayItemId: null,
          viewItemUrl: null,
        };
        comparisonMap.set(sku, newComparison);
      }
    }

    // 5. Calculate discrepancy types and finalize comparisons
    const comparisons: EbayStockComparison[] = [];

    for (const comparison of comparisonMap.values()) {
      // Calculate quantity difference
      comparison.quantityDifference =
        comparison.platformQuantity - comparison.inventoryQuantity;

      // Determine discrepancy type
      if (comparison.platformQuantity === comparison.inventoryQuantity) {
        comparison.discrepancyType = 'match';
      } else if (comparison.platformQuantity > 0 && comparison.inventoryQuantity === 0) {
        comparison.discrepancyType = 'platform_only';
      } else if (comparison.platformQuantity === 0 && comparison.inventoryQuantity > 0) {
        comparison.discrepancyType = 'inventory_only';
      } else {
        comparison.discrepancyType = 'quantity_mismatch';
      }

      // Calculate price difference if both have prices
      if (comparison.platformPrice && comparison.inventoryItems.length > 0) {
        const avgInventoryPrice =
          comparison.inventoryTotalValue / comparison.inventoryItems.length;
        comparison.priceDifference = comparison.platformPrice - avgInventoryPrice;
      }

      comparisons.push(comparison);
    }

    // 6. Apply filters
    let filtered = comparisons;

    if (filters.discrepancyType && filters.discrepancyType !== 'all') {
      filtered = filtered.filter((c) => c.discrepancyType === filters.discrepancyType);
    }

    if (filters.search) {
      const search = filters.search.toLowerCase();
      filtered = filtered.filter(
        (c) =>
          c.platformSku?.toLowerCase().includes(search) ||
          c.platformTitle?.toLowerCase().includes(search) ||
          c.inventoryItems.some(
            (i) =>
              i.setNumber.toLowerCase().includes(search) ||
              i.itemName?.toLowerCase().includes(search)
          )
      );
    }

    if (filters.hideZeroQuantities) {
      filtered = filtered.filter(
        (c) => c.platformQuantity > 0 || c.inventoryQuantity > 0
      );
    }

    // 7. Sort: issues first (platform_only, inventory_only, quantity_mismatch, match)
    const discrepancyOrder: Record<DiscrepancyType, number> = {
      missing_asin: 0, // Not applicable to eBay but needed for type completeness
      platform_only: 1,
      inventory_only: 2,
      quantity_mismatch: 3,
      price_mismatch: 4,
      match: 5,
    };

    filtered.sort((a, b) => {
      const orderDiff =
        (discrepancyOrder[a.discrepancyType] ?? 99) -
        (discrepancyOrder[b.discrepancyType] ?? 99);
      if (orderDiff !== 0) return orderDiff;

      // Secondary sort by title/SKU
      const aTitle = a.platformTitle || a.platformSku || '';
      const bTitle = b.platformTitle || b.platformSku || '';
      return aTitle.localeCompare(bTitle);
    });

    // 8. Calculate summary
    const summary: ComparisonSummary = {
      totalPlatformListings: ebayListings.filter((l) => l.platformSku).length,
      totalPlatformQuantity: ebayListings.reduce((sum, l) => sum + l.quantity, 0),
      totalInventoryItems: inventoryItems?.length || 0,
      matchedItems: comparisons.filter((c) => c.discrepancyType === 'match').length,
      platformOnlyItems: comparisons.filter((c) => c.discrepancyType === 'platform_only')
        .length,
      inventoryOnlyItems: comparisons.filter((c) => c.discrepancyType === 'inventory_only')
        .length,
      quantityMismatches: comparisons.filter(
        (c) => c.discrepancyType === 'quantity_mismatch'
      ).length,
      priceMismatches: comparisons.filter((c) => c.discrepancyType === 'price_mismatch')
        .length,
      missingAsinItems: 0, // Not applicable to eBay (uses SKU matching, not ASIN)
      lastImportAt: (await this.getLatestImport())?.completedAt || null,
    };

    return { comparisons: filtered, summary };
  }
}
