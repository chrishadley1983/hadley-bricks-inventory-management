/**
 * eBay Category Review Service
 *
 * Fetches item categories and store categories from the eBay Inventory API,
 * stores them in ebay_listing_categories table, and provides comparison/update
 * capabilities for auditing category assignments.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { EbayApiAdapter } from './ebay-api.adapter';
import { ebayAuthService } from './ebay-auth.service';
import { EbayTradingClient } from '../platform-stock/ebay/ebay-trading.client';
import type { EbayOfferResponse } from './types';
import type { ParsedEbayListing } from '../platform-stock/ebay/types';
import {
  STORE_CATEGORY_BY_ID,
  getCorrectStoreCategory as getCorrectStoreCategoryShared,
  looksLikeCompleteSet as looksLikeCompleteSetShared,
} from './ebay-store-category-rules';

// ============================================================================
// Types
// ============================================================================

export interface CategorySyncResult {
  synced: number;
  failed: number;
  total: number;
  errors: string[];
}

export interface CategoryComparisonReport {
  missingStoreCategory: CategoryReportItem[];
  categoryMismatch: CategoryMismatchItem[];
  notSynced: CategoryNotSyncedItem[];
  summary: {
    totalSynced: number;
    totalMissingStoreCategory: number;
    totalCategoryMismatch: number;
    totalNotSynced: number;
  };
}

export interface CategoryReportItem {
  offerId: string;
  sku: string;
  title: string | null;
  categoryId: string | null;
  ebayItemId: string | null;
  inventoryItemId: string | null;
}

export interface CategoryMismatchItem {
  offerId: string;
  sku: string;
  title: string | null;
  ebayItemId: string | null;
  inventoryItemId: string | null;
  syncedCategoryId: string | null;
  platformListingCategoryId: string | null;
}

export interface CategoryNotSyncedItem {
  platformListingId: string;
  platformItemId: string | null;
  platformSku: string | null;
  title: string | null;
}

interface PlatformListingUpdate {
  id: string;
  categoryId: string | null;
  storeCategoryNames: string[] | null;
}

// ============================================================================
// Full Audit Types
// ============================================================================

export interface FullAuditResult {
  totalListings: number;
  itemCategoryIssues: ItemCategoryIssue[];
  storeCategoryIssues: StoreCategoryIssueItem[];
  summary: {
    itemCategoryIssueCount: number;
    storeCategoryIssueCount: number;
    storeCategoryDistribution: Record<string, { name: string; count: number }>;
    itemCategoryDistribution: Record<string, { name: string; count: number }>;
  };
}

export interface ItemCategoryIssue {
  itemId: string;
  title: string;
  currentCategoryId: string;
  currentCategoryName: string | null;
  suggestedCategoryId: string;
  suggestedCategoryName: string;
  reason: string;
}

export interface StoreCategoryIssueItem {
  itemId: string;
  title: string;
  currentStoreCategoryId: string;
  currentStoreCategoryName: string;
  suggestedStoreCategoryId: string;
  suggestedStoreCategoryName: string;
  reason: string;
}

// Re-export for internal use
const STORE_CATEGORIES = STORE_CATEGORY_BY_ID;

// ============================================================================
// Service
// ============================================================================

export class EbayCategoryReviewService {
  constructor(
    private supabase: SupabaseClient,
    private userId: string
  ) {}

  /**
   * Fetch all offers from eBay and upsert category data into ebay_listing_categories.
   * Also updates platform_listings.ebay_data with category info.
   */
  async syncCategories(): Promise<CategorySyncResult> {
    // Auth guard
    const accessToken = await ebayAuthService.getAccessToken(this.userId);
    if (!accessToken) {
      return {
        synced: 0,
        failed: 0,
        total: 0,
        errors: ['EBAY_AUTH_REQUIRED: eBay credentials not configured or token expired'],
      };
    }

    const adapter = new EbayApiAdapter({
      accessToken,
      marketplaceId: 'EBAY_GB',
      userId: this.userId,
    });

    // Fetch all offers from eBay (both FIXED_PRICE and AUCTION)
    let allOffers: EbayOfferResponse[];
    try {
      allOffers = await adapter.getAllOffers({ limit: 200 });
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Unknown error';
      return {
        synced: 0,
        failed: 0,
        total: 0,
        errors: [`Failed to fetch offers from eBay: ${msg}`],
      };
    }

    // Build SKU → inventory_item_id lookup
    const skuToInventoryItem = await this.buildSkuLookup();

    // Build SKU → platform_listing (id + title) lookup
    const skuToPlatformListing = await this.buildPlatformListingLookup();

    let synced = 0;
    let failed = 0;
    const errors: string[] = [];
    const platformUpdates: PlatformListingUpdate[] = [];

    for (const offer of allOffers) {
      try {
        const inventoryItemId = skuToInventoryItem.get(offer.sku) ?? null;
        const listingId = offer.listing?.listingId ?? null;
        // Use title from platform_listings (not listingDescription which is HTML body)
        const plEntry = skuToPlatformListing.get(offer.sku);
        const title = plEntry?.title ?? null;

        // Upsert into ebay_listing_categories
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { error: upsertError } = await (this.supabase as any)
          .from('ebay_listing_categories')
          .upsert(
            {
              user_id: this.userId,
              inventory_item_id: inventoryItemId,
              ebay_item_id: listingId,
              offer_id: offer.offerId,
              sku: offer.sku,
              title,
              category_id: offer.categoryId ?? null,
              store_category_names: offer.storeCategoryNames ?? null,
              last_synced_at: new Date().toISOString(),
            },
            { onConflict: 'user_id,offer_id' }
          );

        if (upsertError) {
          failed++;
          errors.push(`Offer ${offer.offerId} (SKU: ${offer.sku}): ${upsertError.message}`);
          continue;
        }

        // Collect platform_listings updates for batching
        if (plEntry && (offer.categoryId || offer.storeCategoryNames)) {
          platformUpdates.push({
            id: plEntry.id,
            categoryId: offer.categoryId ?? null,
            storeCategoryNames: offer.storeCategoryNames ?? null,
          });
        }

        synced++;
      } catch (error) {
        failed++;
        const msg = error instanceof Error ? error.message : 'Unknown error';
        errors.push(`Offer ${offer.offerId} (SKU: ${offer.sku}): ${msg}`);
      }
    }

    // Batch update platform_listings.ebay_data with category info
    if (platformUpdates.length > 0) {
      const updateErrors = await this.batchUpdatePlatformListings(platformUpdates);
      errors.push(...updateErrors);
    }

    return { synced, failed, total: allOffers.length, errors };
  }

  /**
   * Get a comparison report showing category issues.
   */
  async getComparisonReport(): Promise<CategoryComparisonReport> {
    // 1. Get all synced categories (paginated)
    const syncedCategories = await this.paginatedSelect(
      'ebay_listing_categories',
      '*',
      { user_id: this.userId }
    );

    // 2. Get all eBay platform_listings (paginated)
    const platformListings = await this.paginatedSelect(
      'platform_listings',
      'id, platform_item_id, platform_sku, title, ebay_data',
      { user_id: this.userId, platform: 'ebay' }
    );

    const syncedMap = new Map<string, (typeof syncedCategories)[0]>();
    for (const cat of syncedCategories) {
      if (cat.sku) syncedMap.set(cat.sku, cat);
    }

    // Missing store category: synced but no store_category_names
    const missingStoreCategory: CategoryReportItem[] = [];
    for (const cat of syncedCategories) {
      if (!cat.store_category_names || cat.store_category_names.length === 0) {
        missingStoreCategory.push({
          offerId: cat.offer_id,
          sku: cat.sku,
          title: cat.title,
          categoryId: cat.category_id,
          ebayItemId: cat.ebay_item_id,
          inventoryItemId: cat.inventory_item_id,
        });
      }
    }

    // Category mismatch: synced category_id differs from platform_listings.ebay_data.category_id
    const categoryMismatch: CategoryMismatchItem[] = [];
    for (const pl of platformListings) {
      const ebayData = pl.ebay_data as Record<string, unknown> | null;
      const plCategoryId = ebayData?.category_id as string | null;
      const synced = pl.platform_sku ? syncedMap.get(pl.platform_sku) : null;

      if (synced && plCategoryId && synced.category_id && plCategoryId !== synced.category_id) {
        categoryMismatch.push({
          offerId: synced.offer_id,
          sku: synced.sku,
          title: synced.title,
          ebayItemId: synced.ebay_item_id,
          inventoryItemId: synced.inventory_item_id,
          syncedCategoryId: synced.category_id,
          platformListingCategoryId: plCategoryId,
        });
      }
    }

    // Not synced: eBay platform_listings with no matching entry in ebay_listing_categories
    const notSynced: CategoryNotSyncedItem[] = [];
    for (const pl of platformListings) {
      const synced = pl.platform_sku ? syncedMap.get(pl.platform_sku) : null;
      if (!synced) {
        notSynced.push({
          platformListingId: pl.id,
          platformItemId: pl.platform_item_id,
          platformSku: pl.platform_sku,
          title: pl.title,
        });
      }
    }

    return {
      missingStoreCategory,
      categoryMismatch,
      notSynced,
      summary: {
        totalSynced: syncedCategories.length,
        totalMissingStoreCategory: missingStoreCategory.length,
        totalCategoryMismatch: categoryMismatch.length,
        totalNotSynced: notSynced.length,
      },
    };
  }

  /**
   * Update an offer's category on eBay via the Inventory API.
   */
  async updateEbayCategory(
    offerId: string,
    changes: { categoryId?: string; storeCategoryNames?: string[] }
  ): Promise<{ success: boolean; error?: string }> {
    const accessToken = await ebayAuthService.getAccessToken(this.userId);
    if (!accessToken) {
      return { success: false, error: 'EBAY_AUTH_REQUIRED: eBay credentials not configured or token expired' };
    }

    const adapter = new EbayApiAdapter({
      accessToken,
      marketplaceId: 'EBAY_GB',
      userId: this.userId,
    });

    try {
      const currentOffer = await adapter.getOffer(offerId);

      await adapter.updateOffer(offerId, {
        sku: currentOffer.sku,
        marketplaceId: currentOffer.marketplaceId,
        format: currentOffer.format as 'FIXED_PRICE' | 'AUCTION',
        categoryId: changes.categoryId ?? currentOffer.categoryId ?? '',
        listingPolicies: currentOffer.listingPolicies!,
        pricingSummary: currentOffer.pricingSummary!,
        ...(changes.storeCategoryNames && { storeCategoryNames: changes.storeCategoryNames }),
      });

      return { success: true };
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Unknown error';
      return { success: false, error: msg };
    }
  }

  /**
   * Run a full audit of all active eBay listings, checking both item categories
   * and store categories against expected rules. Fetches live data from eBay.
   */
  async runFullAudit(): Promise<FullAuditResult> {
    const accessToken = await ebayAuthService.getAccessToken(this.userId);
    if (!accessToken) {
      throw new Error('EBAY_AUTH_REQUIRED: eBay credentials not configured or token expired');
    }

    const client = new EbayTradingClient({ accessToken, siteId: 3 });
    const listings = await client.getAllActiveListings();

    const itemCategoryIssues: ItemCategoryIssue[] = [];
    const storeCategoryIssues: StoreCategoryIssueItem[] = [];
    const itemCatDist: Record<string, { name: string; count: number }> = {};
    const storeCatDist: Record<string, { name: string; count: number }> = {};

    for (const listing of listings) {
      // Track item category distribution (use String() since XML parser may return numbers)
      const catId = String(listing.ebayData?.categoryId || 'unknown');
      const catName = listing.ebayData?.categoryName || 'Unknown';
      if (!itemCatDist[catId]) itemCatDist[catId] = { name: catName, count: 0 };
      itemCatDist[catId].count++;

      // Track store category distribution
      const storeCatId = String(listing.ebayData?.storeCategoryId || '1');
      const storeCatName = STORE_CATEGORIES[storeCatId] || `Unknown (${storeCatId})`;
      if (!storeCatDist[storeCatId]) storeCatDist[storeCatId] = { name: storeCatName, count: 0 };
      storeCatDist[storeCatId].count++;

      // Check item category: complete sets should not be in 183448
      if (catId === '183448' && this.looksLikeCompleteSet(listing)) {
        itemCategoryIssues.push({
          itemId: listing.platformItemId,
          title: listing.title,
          currentCategoryId: catId,
          currentCategoryName: catName,
          suggestedCategoryId: '19006',
          suggestedCategoryName: 'LEGO Complete Sets & Packs',
          reason: 'Complete set listed in Bricks & Parts category',
        });
      }

      // Check store category
      const correctStore = this.getCorrectStoreCategory(listing);
      if (correctStore.id !== String(storeCatId)) {
        storeCategoryIssues.push({
          itemId: listing.platformItemId,
          title: listing.title,
          currentStoreCategoryId: storeCatId,
          currentStoreCategoryName: storeCatName,
          suggestedStoreCategoryId: correctStore.id,
          suggestedStoreCategoryName: STORE_CATEGORIES[correctStore.id] || correctStore.id,
          reason: correctStore.reason,
        });
      }
    }

    return {
      totalListings: listings.length,
      itemCategoryIssues,
      storeCategoryIssues,
      summary: {
        itemCategoryIssueCount: itemCategoryIssues.length,
        storeCategoryIssueCount: storeCategoryIssues.length,
        storeCategoryDistribution: storeCatDist,
        itemCategoryDistribution: itemCatDist,
      },
    };
  }

  private looksLikeCompleteSet(listing: ParsedEbayListing): boolean {
    return looksLikeCompleteSetShared(listing.title);
  }

  private getCorrectStoreCategory(listing: ParsedEbayListing): { id: string; reason: string } {
    return getCorrectStoreCategoryShared({
      title: listing.title,
      categoryId: listing.ebayData?.categoryId,
      categoryName: listing.ebayData?.categoryName,
      condition: listing.ebayData?.condition,
    });
  }

  // ============================================================================
  // Private Helpers
  // ============================================================================

  /**
   * Generic paginated select that respects Supabase 1,000 row limit.
   */
  private async paginatedSelect(
    table: string,
    columns: string,
    filters: Record<string, string>
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ): Promise<any[]> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const allRows: any[] = [];
    let offset = 0;
    const limit = 1000;

    while (true) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let query = (this.supabase as any).from(table).select(columns);
      for (const [key, value] of Object.entries(filters)) {
        query = query.eq(key, value);
      }
      const { data, error } = await query.range(offset, offset + limit - 1);

      if (error) throw new Error(`Failed to fetch from ${table}: ${error.message}`);
      if (!data || data.length === 0) break;

      allRows.push(...data);
      if (data.length < limit) break;
      offset += limit;
    }

    return allRows;
  }

  private async buildSkuLookup(): Promise<Map<string, string>> {
    const map = new Map<string, string>();
    let offset = 0;
    const limit = 1000;

    while (true) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await (this.supabase as any)
        .from('inventory_items')
        .select('id, sku')
        .eq('user_id', this.userId)
        .not('sku', 'is', null)
        .range(offset, offset + limit - 1);

      if (error) break;
      if (!data || data.length === 0) break;

      for (const item of data) {
        if (item.sku) map.set(item.sku, item.id);
      }

      if (data.length < limit) break;
      offset += limit;
    }

    return map;
  }

  private async buildPlatformListingLookup(): Promise<Map<string, { id: string; title: string | null }>> {
    const map = new Map<string, { id: string; title: string | null }>();
    let offset = 0;
    const limit = 1000;

    while (true) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await (this.supabase as any)
        .from('platform_listings')
        .select('id, platform_sku, title')
        .eq('user_id', this.userId)
        .eq('platform', 'ebay')
        .not('platform_sku', 'is', null)
        .range(offset, offset + limit - 1);

      if (error) break;
      if (!data || data.length === 0) break;

      for (const item of data) {
        if (item.platform_sku) map.set(item.platform_sku, { id: item.id, title: item.title });
      }

      if (data.length < limit) break;
      offset += limit;
    }

    return map;
  }

  /**
   * Batch update platform_listings.ebay_data with category info.
   * First fetches all current ebay_data in one query, then updates each row.
   */
  private async batchUpdatePlatformListings(updates: PlatformListingUpdate[]): Promise<string[]> {
    const errors: string[] = [];
    const ids = updates.map((u) => u.id);

    // Fetch all current ebay_data in one query
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: currentRows, error: fetchError } = await (this.supabase as any)
      .from('platform_listings')
      .select('id, ebay_data')
      .in('id', ids);

    if (fetchError) {
      errors.push(`Failed to fetch platform listings for update: ${fetchError.message}`);
      return errors;
    }

    const currentDataMap = new Map<string, Record<string, unknown>>();
    for (const row of currentRows ?? []) {
      currentDataMap.set(row.id, (row.ebay_data as Record<string, unknown>) ?? {});
    }

    // Update each row
    for (const update of updates) {
      const existingData = currentDataMap.get(update.id) ?? {};
      const updatedData = {
        ...existingData,
        ...(update.categoryId && { category_id: update.categoryId }),
        ...(update.storeCategoryNames && {
          store_category: update.storeCategoryNames[0] ?? null,
          store_category_names: update.storeCategoryNames,
        }),
      };

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error: updateError } = await (this.supabase as any)
        .from('platform_listings')
        .update({ ebay_data: updatedData })
        .eq('id', update.id);

      if (updateError) {
        errors.push(`Failed to update platform listing ${update.id}: ${updateError.message}`);
      }
    }

    return errors;
  }
}
