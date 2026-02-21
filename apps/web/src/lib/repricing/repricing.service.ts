/**
 * Repricing Service
 *
 * Aggregates data from platform_listings, inventory_items, and Amazon Pricing API
 * to provide a unified view for repricing decisions and price updates.
 *
 * Key features:
 * - Fetches ALL listings at once (not per-page)
 * - Caches pricing data for 3 hours
 * - Manual sync bypasses cache
 * - Falls back to lowest offer price when buy box is not present
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@hadley-bricks/database';
import type { AmazonCredentials } from '../amazon/types';
import { createAmazonPricingClient } from '../amazon/amazon-pricing.client';
import { createAmazonListingsClient } from '../amazon/amazon-listings.client';
import { CredentialsRepository } from '../repositories';
import type {
  RepricingItem,
  RepricingFilters,
  RepricingDataResponse,
  PushPriceResponse,
} from './types';

// ============================================================================
// CONSTANTS
// ============================================================================

const UK_MARKETPLACE_ID = 'A1F83G8C2ARO7P';
const PLATFORM_AMAZON = 'amazon';
const CACHE_DURATION_HOURS = 3;
const CACHE_DURATION_MS = CACHE_DURATION_HOURS * 60 * 60 * 1000;

// ============================================================================
// CACHE TYPES (simplified for storage - subset of full API types)
// ============================================================================

/**
 * Simplified pricing data for cache storage
 */
interface CachedPricingData {
  asin: string;
  buyBoxPrice: number | null;
  buyBoxIsYours: boolean;
  newOfferCount: number | null;
  salesRank: number | null;
  salesRankCategory: string | null;
}

/**
 * Simplified competitive summary data for cache storage
 */
interface CachedSummaryData {
  asin: string;
  wasPrice: number | null;
  lowestOffer: {
    listingPrice: number;
    shippingPrice: number;
    totalPrice: number;
    condition: string;
  } | null;
}

// ============================================================================
// SERVICE CLASS
// ============================================================================

/**
 * Repricing Service
 *
 * Provides methods to fetch repricing data and push price updates to Amazon.
 */
export class RepricingService {
  private supabase: SupabaseClient<Database>;
  private userId: string;
  private credentialsRepo: CredentialsRepository;

  constructor(supabase: SupabaseClient<Database>, userId: string) {
    this.supabase = supabase;
    this.userId = userId;
    this.credentialsRepo = new CredentialsRepository(supabase);
  }

  // ==========================================================================
  // PUBLIC METHODS
  // ==========================================================================

  /**
   * Get repricing data with cached or fresh Amazon pricing
   *
   * @param filters - Optional filters
   * @param page - Page number (1-indexed) for display pagination
   * @param pageSize - Items per page for display pagination
   * @param forceSync - If true, bypasses cache and fetches fresh data
   * @returns Combined repricing data with pagination
   */
  async getRepricingData(
    filters: RepricingFilters = {},
    page: number = 1,
    pageSize: number = 50,
    forceSync: boolean = false
  ): Promise<RepricingDataResponse> {
    // 1. Get ALL Amazon listings with qty >= minQuantity (default 1)
    const allListings = await this.getAllAmazonListings(filters);

    if (allListings.length === 0) {
      return {
        items: [],
        summary: {
          totalListings: 0,
          withCostData: 0,
          buyBoxOwned: 0,
          buyBoxLost: 0,
          pricingDataAge: 'No data',
          pricingCachedAt: null,
          isCached: false,
        },
        pagination: {
          page: 1,
          pageSize,
          total: 0,
          totalPages: 0,
        },
      };
    }

    // 2. Get UNIQUE ASINs for pricing lookup (multiple SKUs can share the same ASIN)
    const allAsins = allListings.map((l) => l.platformItemId);
    const uniqueAsins = [...new Set(allAsins)];
    console.log(
      `[RepricingService] ${allListings.length} listings, ${uniqueAsins.length} unique ASINs`
    );

    // 3. Get inventory costs by ASIN (for all listings)
    const costMap = await this.getInventoryCosts(uniqueAsins);

    // 4. Check cache or fetch pricing data
    // Use cached types that work with both cache and API data
    let pricingMap: Map<string, CachedPricingData> = new Map();
    let summaryMap: Map<string, CachedSummaryData> = new Map();
    let cacheTimestamp: Date | null = null;
    let isCached = false;

    // Check if we have valid cached data
    const cachedData = await this.getCachedPricingData(uniqueAsins);
    const cacheAge = cachedData.oldestFetchedAt
      ? Date.now() - new Date(cachedData.oldestFetchedAt).getTime()
      : Infinity;
    const cacheValid = cacheAge < CACHE_DURATION_MS && cachedData.coverage > 0.9; // 90% coverage

    if (cacheValid && !forceSync) {
      // Use cached data
      console.log('[RepricingService] Using cached pricing data');
      pricingMap = cachedData.pricingMap;
      summaryMap = cachedData.summaryMap;
      cacheTimestamp = cachedData.oldestFetchedAt ? new Date(cachedData.oldestFetchedAt) : null;
      isCached = true;
    } else {
      // Fetch fresh data from Amazon API
      console.log('[RepricingService] Fetching fresh pricing data from Amazon API...');
      const credentials = await this.getAmazonCredentials();

      if (credentials) {
        const pricingClient = createAmazonPricingClient(credentials);

        try {
          // Fetch competitive pricing (faster API - 2.5s delay between batches)
          console.log('[RepricingService] Fetching competitive pricing...');
          const pricingData = await pricingClient.getCompetitivePricing(
            uniqueAsins,
            UK_MARKETPLACE_ID
          );
          // Convert full API response to cached format
          pricingMap = new Map(
            pricingData.map((p) => [
              p.asin,
              {
                asin: p.asin,
                buyBoxPrice: p.buyBoxPrice,
                buyBoxIsYours: p.buyBoxIsYours,
                newOfferCount: p.newOfferCount,
                salesRank: p.salesRank,
                salesRankCategory: p.salesRankCategory,
              },
            ])
          );

          // Fetch competitive summary (slower API - 0.033 req/sec rate limit)
          console.log('[RepricingService] Fetching competitive summary (slower API)...');
          const summaryData = await pricingClient.getCompetitiveSummary(
            uniqueAsins,
            UK_MARKETPLACE_ID
          );
          // Convert full API response to cached format
          summaryMap = new Map(
            summaryData.map((s) => [
              s.asin,
              {
                asin: s.asin,
                wasPrice: s.wasPrice,
                lowestOffer: s.lowestOffer
                  ? {
                      listingPrice: s.lowestOffer.listingPrice,
                      shippingPrice: s.lowestOffer.shippingPrice,
                      totalPrice: s.lowestOffer.totalPrice,
                      condition: s.lowestOffer.condition,
                    }
                  : null,
              },
            ])
          );

          // Save to cache
          await this.savePricingCache(uniqueAsins, pricingMap, summaryMap);
          cacheTimestamp = new Date();
        } catch (error) {
          console.error('[RepricingService] Error fetching pricing data:', error);
          // Try to use stale cache if available
          if (cachedData.coverage > 0) {
            console.log('[RepricingService] Falling back to stale cache');
            pricingMap = cachedData.pricingMap;
            summaryMap = cachedData.summaryMap;
            cacheTimestamp = cachedData.oldestFetchedAt
              ? new Date(cachedData.oldestFetchedAt)
              : null;
            isCached = true;
          }
        }
      }
    }

    // 5. Merge ALL data into RepricingItems
    const now = cacheTimestamp?.toISOString() ?? new Date().toISOString();
    const allItems: RepricingItem[] = allListings.map((listing) => {
      const pricing = pricingMap.get(listing.platformItemId);
      const summary = summaryMap.get(listing.platformItemId);
      // Try multiple matching strategies for cost: ASIN -> SKU -> set number from title
      const costData = this.getCostForListing(
        listing.platformItemId,
        listing.platformSku,
        listing.title,
        costMap
      );

      const buyBoxPrice = pricing?.buyBoxPrice ?? null;
      const lowestOfferPrice = summary?.lowestOffer?.totalPrice ?? null;
      const yourPrice = listing.price ?? 0;

      // Determine effective price and source
      let effectivePrice: number | null = null;
      let priceSource: 'buybox' | 'lowest' | 'none' = 'none';

      if (buyBoxPrice !== null) {
        effectivePrice = buyBoxPrice;
        priceSource = 'buybox';
      } else if (lowestOfferPrice !== null) {
        effectivePrice = lowestOfferPrice;
        priceSource = 'lowest';
      }

      const buyBoxDiff = effectivePrice !== null ? yourPrice - effectivePrice : null;

      return {
        asin: listing.platformItemId,
        sku: listing.platformSku ?? '',
        title: listing.title,
        inventoryItemId: costData?.id ?? null,
        inventoryCost: costData?.cost ?? null,
        quantity: listing.quantity,
        yourPrice,
        listingStatus: listing.listingStatus,
        fulfillmentChannel: listing.fulfillmentChannel,
        buyBoxPrice,
        buyBoxIsYours: pricing?.buyBoxIsYours ?? false,
        wasPrice: summary?.wasPrice ?? null,
        lowestOfferPrice,
        offerCount: pricing?.newOfferCount ?? null,
        salesRank: pricing?.salesRank ?? null,
        salesRankCategory: pricing?.salesRankCategory ?? null,
        pricingFetchedAt: now,
        buyBoxDiff,
        effectivePrice,
        priceSource,
      };
    });

    // 6. Apply client-side filters
    let filteredItems = allItems;

    if (filters.search) {
      const searchLower = filters.search.toLowerCase();
      filteredItems = filteredItems.filter(
        (i) =>
          i.asin.toLowerCase().includes(searchLower) ||
          i.sku.toLowerCase().includes(searchLower) ||
          (i.title?.toLowerCase().includes(searchLower) ?? false)
      );
    }

    if (filters.showOnlyWithCost) {
      filteredItems = filteredItems.filter((i) => i.inventoryCost !== null);
    }

    if (filters.showOnlyBuyBoxLost) {
      filteredItems = filteredItems.filter((i) => i.buyBoxPrice !== null && !i.buyBoxIsYours);
    }

    // 7. Calculate summary from ALL items (before pagination)
    const summary = {
      totalListings: allItems.length,
      withCostData: allItems.filter((i) => i.inventoryCost !== null).length,
      buyBoxOwned: allItems.filter((i) => i.buyBoxIsYours).length,
      buyBoxLost: allItems.filter((i) => i.buyBoxPrice !== null && !i.buyBoxIsYours).length,
      pricingDataAge: this.formatCacheAge(cacheTimestamp),
      pricingCachedAt: cacheTimestamp?.toISOString() ?? null,
      isCached,
    };

    // 8. Apply pagination to filtered results
    const totalFiltered = filteredItems.length;
    const totalPages = Math.ceil(totalFiltered / pageSize);
    const startIdx = (page - 1) * pageSize;
    const endIdx = startIdx + pageSize;
    const paginatedItems = filteredItems.slice(startIdx, endIdx);

    return {
      items: paginatedItems,
      summary,
      pagination: {
        page,
        pageSize,
        total: totalFiltered,
        totalPages,
      },
    };
  }

  /**
   * Sync pricing data manually (bypasses cache)
   */
  async syncPricing(): Promise<{ success: boolean; message: string }> {
    try {
      // Clear existing cache for this user
      await this.clearPricingCache();

      // Force fresh fetch will happen on next getRepricingData call
      return {
        success: true,
        message: 'Cache cleared. Fresh pricing data will be fetched.',
      };
    } catch (error) {
      console.error('[RepricingService] Error clearing cache:', error);
      return {
        success: false,
        message: error instanceof Error ? error.message : 'Failed to clear cache',
      };
    }
  }

  /**
   * Push price update to Amazon instantly
   *
   * @param sku - Seller SKU
   * @param newPrice - New price in GBP
   * @param productType - Product type (will be fetched from listing if not provided)
   * @returns Push result
   */
  async pushPrice(sku: string, newPrice: number, productType?: string): Promise<PushPriceResponse> {
    // Get current price for comparison
    const currentListing = await this.getListingBySku(sku);
    const previousPrice = currentListing?.price ?? 0;

    // Get credentials
    const credentials = await this.getAmazonCredentials();
    if (!credentials) {
      return {
        success: false,
        sku,
        previousPrice,
        newPrice,
        message: 'Amazon credentials not configured',
      };
    }

    // Create client and push update
    const listingsClient = createAmazonListingsClient(credentials);

    try {
      // If no product type provided, fetch it from the listing
      let actualProductType = productType;
      if (!actualProductType) {
        console.log(`[RepricingService] Fetching product type for SKU: ${sku}`);
        const listingDetails = await listingsClient.getListing(sku, UK_MARKETPLACE_ID, [
          'summaries',
        ]);

        if (listingDetails?.summaries?.[0]?.productType) {
          actualProductType = listingDetails.summaries[0].productType;
          console.log(`[RepricingService] Found product type: ${actualProductType}`);
        } else {
          // Fallback to TOY if we can't determine the product type
          actualProductType = 'TOY';
          console.log(
            `[RepricingService] Could not determine product type, using fallback: ${actualProductType}`
          );
        }
      }

      const response = await listingsClient.updatePrice(
        sku,
        newPrice,
        actualProductType,
        UK_MARKETPLACE_ID
      );

      const success = response.status === 'ACCEPTED' || response.status === 'VALID';

      // If successful, update the platform_listings table to keep data aligned
      if (success) {
        await this.updateListingPrice(sku, newPrice);
      }

      return {
        success,
        sku,
        previousPrice,
        newPrice,
        message: success
          ? `Price updated to £${newPrice.toFixed(2)}`
          : `Update status: ${response.status}`,
        validationIssues: response.issues?.map((issue) => ({
          code: issue.code,
          message: issue.message,
          severity: issue.severity,
        })),
      };
    } catch (error) {
      return {
        success: false,
        sku,
        previousPrice,
        newPrice,
        message: error instanceof Error ? error.message : 'Unknown error occurred',
      };
    }
  }

  // ==========================================================================
  // PRIVATE METHODS - LISTINGS
  // ==========================================================================

  /**
   * Get ALL Amazon listings with qty >= minQuantity (no pagination at DB level)
   */
  private async getAllAmazonListings(filters: RepricingFilters): Promise<PlatformListingRow[]> {
    const pageSize = 1000; // Supabase limit
    let page = 0;
    const allListings: PlatformListingRow[] = [];
    let hasMore = true;

    while (hasMore) {
      const from = page * pageSize;
      const to = from + pageSize - 1;

      const query = this.supabase
        .from('platform_listings')
        .select('*')
        .eq('user_id', this.userId)
        .eq('platform', PLATFORM_AMAZON)
        .gte('quantity', filters.minQuantity ?? 1)
        .range(from, to)
        .order('title', { ascending: true });

      const { data, error } = await query;

      if (error) {
        throw new Error(`Failed to fetch listings: ${error.message}`);
      }

      const items: PlatformListingRow[] = (data || []).map((row) => ({
        id: row.id,
        platformItemId: row.platform_item_id,
        platformSku: row.platform_sku,
        title: row.title,
        quantity: row.quantity ?? 0,
        price: row.price,
        listingStatus: row.listing_status ?? 'Unknown',
        fulfillmentChannel: row.fulfillment_channel,
      }));

      allListings.push(...items);
      hasMore = items.length === pageSize;
      page++;
    }

    return allListings;
  }

  /**
   * Get inventory costs by ASIN, set number, or SKU
   * Returns a map keyed by ASIN for primary lookup,
   * plus secondary maps for set number and SKU fallbacks
   */
  private async getInventoryCosts(
    asins: string[]
  ): Promise<Map<string, { id: string; cost: number | null }>> {
    if (asins.length === 0) {
      return new Map();
    }

    // Query ALL inventory items for this user (we'll match by multiple fields)
    const pageSize = 1000;
    let page = 0;
    const allItems: Array<{
      id: string;
      amazon_asin: string | null;
      set_number: string | null;
      sku: string | null;
      cost: number | null;
    }> = [];
    let hasMore = true;

    while (hasMore) {
      const { data, error } = await this.supabase
        .from('inventory_items')
        .select('id, amazon_asin, set_number, sku, cost')
        .eq('user_id', this.userId)
        .range(page * pageSize, (page + 1) * pageSize - 1)
        .order('created_at', { ascending: false });

      if (error) {
        console.error('[RepricingService] Error fetching inventory costs:', error);
        break;
      }

      allItems.push(...(data || []));
      hasMore = (data?.length ?? 0) === pageSize;
      page++;
    }

    // Create primary map by ASIN (first occurrence wins due to ordering)
    const costMap = new Map<string, { id: string; cost: number | null }>();

    // Also create secondary maps for fallback matching
    const setNumberMap = new Map<string, { id: string; cost: number | null }>();
    const skuMap = new Map<string, { id: string; cost: number | null }>();

    for (const item of allItems) {
      const costEntry = { id: item.id, cost: item.cost };

      // Primary: by ASIN
      if (item.amazon_asin && !costMap.has(item.amazon_asin)) {
        costMap.set(item.amazon_asin, costEntry);
      }

      // Secondary: by set number (for fallback matching from title)
      if (item.set_number && !setNumberMap.has(item.set_number)) {
        setNumberMap.set(item.set_number, costEntry);
      }

      // Tertiary: by SKU
      if (item.sku && !skuMap.has(item.sku)) {
        skuMap.set(item.sku, costEntry);
      }
    }

    // Store secondary maps for use in merging
    this._setNumberCostMap = setNumberMap;
    this._skuCostMap = skuMap;

    return costMap;
  }

  // Secondary cost maps for fallback matching
  private _setNumberCostMap: Map<string, { id: string; cost: number | null }> = new Map();
  private _skuCostMap: Map<string, { id: string; cost: number | null }> = new Map();

  /**
   * Extract set number from a product title
   * e.g., "LEGO BrickHeadz 40443 Budgie" -> "40443"
   */
  private extractSetNumber(title: string | null): string | null {
    if (!title) return null;
    // Match 4-6 digit numbers that look like LEGO set numbers
    const match = title.match(/\b(\d{4,6})\b/);
    return match ? match[1] : null;
  }

  /**
   * Get cost data for a listing, trying multiple matching strategies
   */
  private getCostForListing(
    asin: string,
    sku: string | null,
    title: string | null,
    primaryCostMap: Map<string, { id: string; cost: number | null }>
  ): { id: string; cost: number | null } | null {
    // 1. Try primary match by ASIN
    const byAsin = primaryCostMap.get(asin);
    if (byAsin) return byAsin;

    // 2. Try match by SKU
    if (sku) {
      const bySku = this._skuCostMap.get(sku);
      if (bySku) return bySku;
    }

    // 3. Try match by set number extracted from title
    const setNumber = this.extractSetNumber(title);
    if (setNumber) {
      const bySetNumber = this._setNumberCostMap.get(setNumber);
      if (bySetNumber) return bySetNumber;
    }

    return null;
  }

  /**
   * Get a single listing by SKU
   */
  private async getListingBySku(sku: string): Promise<{ price: number | null } | null> {
    const { data, error } = await this.supabase
      .from('platform_listings')
      .select('price')
      .eq('user_id', this.userId)
      .eq('platform', PLATFORM_AMAZON)
      .eq('platform_sku', sku)
      .single();

    if (error) {
      if (error.code === 'PGRST116') {
        return null;
      }
      throw new Error(`Failed to fetch listing: ${error.message}`);
    }

    return data;
  }

  /**
   * Update the price of a listing in platform_listings
   */
  private async updateListingPrice(sku: string, newPrice: number): Promise<void> {
    const { error } = await this.supabase
      .from('platform_listings')
      .update({ price: newPrice, updated_at: new Date().toISOString() })
      .eq('user_id', this.userId)
      .eq('platform', PLATFORM_AMAZON)
      .eq('platform_sku', sku);

    if (error) {
      console.error('[RepricingService] Error updating listing price:', error);
      // Don't throw - the Amazon update succeeded, this is just local sync
    }
  }

  // ==========================================================================
  // PRIVATE METHODS - CACHING
  // ==========================================================================

  /**
   * Get cached pricing data for ASINs
   */
  private async getCachedPricingData(asins: string[]): Promise<{
    pricingMap: Map<string, CachedPricingData>;
    summaryMap: Map<string, CachedSummaryData>;
    oldestFetchedAt: string | null;
    coverage: number; // 0 to 1
  }> {
    if (asins.length === 0) {
      return {
        pricingMap: new Map(),
        summaryMap: new Map(),
        oldestFetchedAt: null,
        coverage: 0,
      };
    }

    const pricingMap = new Map<string, CachedPricingData>();
    const summaryMap = new Map<string, CachedSummaryData>();
    let oldestFetchedAt: string | null = null;

    // Fetch cached data in batches
    const pageSize = 1000;
    for (let i = 0; i < asins.length; i += pageSize) {
      const batchAsins = asins.slice(i, i + pageSize);
      const { data, error } = await this.supabase
        .from('repricing_pricing_cache')
        .select('*')
        .eq('user_id', this.userId)
        .in('asin', batchAsins);

      if (error) {
        console.error('[RepricingService] Error fetching cache:', error);
        continue;
      }

      for (const row of data || []) {
        // Track oldest fetch time
        if (!oldestFetchedAt || row.fetched_at < oldestFetchedAt) {
          oldestFetchedAt = row.fetched_at;
        }

        // Build pricing data
        pricingMap.set(row.asin, {
          asin: row.asin,
          buyBoxPrice: row.buy_box_price ? Number(row.buy_box_price) : null,
          buyBoxIsYours: row.buy_box_is_yours ?? false,
          newOfferCount: row.new_offer_count ?? null,
          salesRank: row.sales_rank ?? null,
          salesRankCategory: row.sales_rank_category ?? null,
        });

        // Build summary data
        if (row.was_price !== null || row.lowest_offer_price !== null) {
          summaryMap.set(row.asin, {
            asin: row.asin,
            wasPrice: row.was_price ? Number(row.was_price) : null,
            lowestOffer: row.lowest_offer_price
              ? {
                  listingPrice: Number(row.lowest_offer_price),
                  shippingPrice: row.lowest_offer_shipping ? Number(row.lowest_offer_shipping) : 0,
                  totalPrice:
                    Number(row.lowest_offer_price) +
                    (row.lowest_offer_shipping ? Number(row.lowest_offer_shipping) : 0),
                  condition: row.lowest_offer_condition ?? 'New',
                }
              : null,
          });
        }
      }
    }

    const coverage = asins.length > 0 ? pricingMap.size / asins.length : 0;

    return {
      pricingMap,
      summaryMap,
      oldestFetchedAt,
      coverage,
    };
  }

  /**
   * Save pricing data to cache
   */
  private async savePricingCache(
    asins: string[],
    pricingMap: Map<string, CachedPricingData>,
    summaryMap: Map<string, CachedSummaryData>
  ): Promise<void> {
    const now = new Date().toISOString();
    const rows = asins.map((asin) => {
      const pricing = pricingMap.get(asin);
      const summary = summaryMap.get(asin);

      return {
        user_id: this.userId,
        asin,
        buy_box_price: pricing?.buyBoxPrice ?? null,
        buy_box_is_yours: pricing?.buyBoxIsYours ?? false,
        new_offer_count: pricing?.newOfferCount ?? null,
        sales_rank: pricing?.salesRank ?? null,
        sales_rank_category: pricing?.salesRankCategory ?? null,
        was_price: summary?.wasPrice ?? null,
        lowest_offer_price: summary?.lowestOffer?.listingPrice ?? null,
        lowest_offer_shipping: summary?.lowestOffer?.shippingPrice ?? null,
        lowest_offer_condition: summary?.lowestOffer?.condition ?? null,
        fetched_at: now,
      };
    });

    // Upsert in batches
    const batchSize = 100;
    for (let i = 0; i < rows.length; i += batchSize) {
      const batch = rows.slice(i, i + batchSize);
      const { error } = await this.supabase.from('repricing_pricing_cache').upsert(batch, {
        onConflict: 'user_id,asin',
      });

      if (error) {
        console.error('[RepricingService] Error saving cache:', error);
      }
    }

    console.log(`[RepricingService] Cached pricing for ${rows.length} ASINs`);
  }

  /**
   * Clear pricing cache for this user
   */
  private async clearPricingCache(): Promise<void> {
    const { error } = await this.supabase
      .from('repricing_pricing_cache')
      .delete()
      .eq('user_id', this.userId);

    if (error) {
      throw new Error(`Failed to clear cache: ${error.message}`);
    }

    console.log('[RepricingService] Cache cleared');
  }

  // ==========================================================================
  // PRIVATE METHODS - HELPERS
  // ==========================================================================

  /**
   * Get Amazon credentials for the user
   */
  private async getAmazonCredentials(): Promise<AmazonCredentials | null> {
    return this.credentialsRepo.getCredentials<AmazonCredentials>(this.userId, 'amazon');
  }

  /**
   * Format cache age for display
   */
  private formatCacheAge(cachedAt: Date | null): string {
    if (!cachedAt) {
      return 'No data';
    }

    const ageMs = Date.now() - cachedAt.getTime();
    const ageMinutes = Math.floor(ageMs / (60 * 1000));

    if (ageMinutes < 1) {
      return 'fetched just now';
    } else if (ageMinutes < 60) {
      return `${ageMinutes} minute${ageMinutes === 1 ? '' : 's'} ago`;
    } else {
      const ageHours = Math.floor(ageMinutes / 60);
      return `${ageHours} hour${ageHours === 1 ? '' : 's'} ago`;
    }
  }
}

// ============================================================================
// HELPER TYPES
// ============================================================================

interface PlatformListingRow {
  id: string;
  platformItemId: string;
  platformSku: string | null;
  title: string | null;
  quantity: number;
  price: number | null;
  listingStatus: string;
  fulfillmentChannel: string | null;
}

// ============================================================================
// FACTORY FUNCTION
// ============================================================================

/**
 * Create a RepricingService instance
 */
export function createRepricingService(
  supabase: SupabaseClient<Database>,
  userId: string
): RepricingService {
  return new RepricingService(supabase, userId);
}
