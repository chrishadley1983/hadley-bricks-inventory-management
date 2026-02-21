/**
 * eBay Listing Refresh Service
 *
 * Main service for the listing refresh feature that ends old listings
 * and recreates them to boost eBay algorithm visibility.
 */

import { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@hadley-bricks/database';
import { EbayTradingClient } from '@/lib/platform-stock/ebay/ebay-trading.client';
import { EbayAnalyticsClient } from './ebay-analytics.client';
import { ebayAuthService } from './ebay-auth.service';
import type { ParsedEbayListing, AddFixedPriceItemRequest } from '@/lib/platform-stock/ebay/types';
import { rowToRefreshJob, rowToRefreshJobItem, calculateListingAge } from './listing-refresh.types';
import type {
  EligibleListing,
  EligibleListingFilters,
  RefreshJob,
  RefreshJobRow,
  RefreshItemRow,
  RefreshProgressCallback,
  RefreshResult,
  RefreshError,
  RefreshJobStatus,
  RefreshItemStatus,
  ViewsEnrichmentCallback,
} from './listing-refresh.types';

// ============================================================================
// Constants
// ============================================================================

const DEFAULT_MIN_AGE_DAYS = 90;
const RATE_LIMIT_DELAY_MS = 150; // 150ms between API calls

/**
 * eBay Analytics API allows a maximum of 90-day date range.
 * We use 89 days because eBay counts inclusively (start + end dates both count),
 * so 89 days actually spans a 90-day range.
 */
const ANALYTICS_DATE_RANGE_DAYS = 89;

/**
 * Default eBay marketplace ID for API calls
 * TODO: Make this configurable per user via their eBay connection settings
 */
const DEFAULT_MARKETPLACE_ID = 'EBAY_GB';

/**
 * Default eBay Trading API site ID
 * TODO: Make this configurable per user via their eBay connection settings
 */
const DEFAULT_SITE_ID = 3; // UK

// ============================================================================
// Service Class
// ============================================================================

export class EbayListingRefreshService {
  private supabase: SupabaseClient<Database>;
  private userId: string;
  private tradingClient: EbayTradingClient | null = null;
  private analyticsClient: EbayAnalyticsClient | null = null;

  constructor(supabase: SupabaseClient<Database>, userId: string) {
    this.supabase = supabase;
    this.userId = userId;
  }

  // ============================================================================
  // Trading Client Management
  // ============================================================================

  /**
   * Get or create a Trading API client with valid access token
   */
  private async getTradingClient(): Promise<EbayTradingClient> {
    const accessToken = await ebayAuthService.getAccessToken(this.userId);
    if (!accessToken) {
      throw new Error('Not connected to eBay or token expired');
    }

    if (!this.tradingClient) {
      this.tradingClient = new EbayTradingClient({
        accessToken,
        siteId: DEFAULT_SITE_ID,
      });
    } else {
      this.tradingClient.setAccessToken(accessToken);
    }

    return this.tradingClient;
  }

  /**
   * Get or create an Analytics API client with valid access token
   */
  private async getAnalyticsClient(): Promise<EbayAnalyticsClient> {
    const accessToken = await ebayAuthService.getAccessToken(this.userId);
    if (!accessToken) {
      throw new Error('Not connected to eBay or token expired');
    }

    if (!this.analyticsClient) {
      this.analyticsClient = new EbayAnalyticsClient({
        accessToken,
        marketplaceId: DEFAULT_MARKETPLACE_ID,
      });
    } else {
      this.analyticsClient.setAccessToken(accessToken);
    }

    return this.analyticsClient;
  }

  // ============================================================================
  // Eligible Listings Discovery
  // ============================================================================

  /**
   * Get listings eligible for refresh (older than specified days)
   */
  async getEligibleListings(filters?: EligibleListingFilters): Promise<EligibleListing[]> {
    const minAge = filters?.minAge ?? DEFAULT_MIN_AGE_DAYS;

    // Fetch all active listings from eBay
    const client = await this.getTradingClient();
    const listings = await client.getAllActiveListings();

    // Filter by age and other criteria
    const eligibleListings = listings
      .filter((listing) => {
        const startDate = new Date(listing.ebayData.listingStartDate);
        const age = calculateListingAge(startDate);

        // Must be older than minimum age
        if (age < minAge) return false;

        // Apply optional filters
        if (filters?.maxPrice !== undefined && listing.price > filters.maxPrice) return false;
        if (filters?.minPrice !== undefined && listing.price < filters.minPrice) return false;
        if (filters?.condition && listing.ebayData.condition !== filters.condition) return false;
        if (filters?.hasWatchers && listing.ebayData.watchers === 0) return false;
        if (filters?.minWatchers !== undefined && listing.ebayData.watchers < filters.minWatchers) {
          return false;
        }
        if (
          filters?.search &&
          !listing.title.toLowerCase().includes(filters.search.toLowerCase())
        ) {
          return false;
        }

        return true;
      })
      .map((listing) => this.parseToEligibleListing(listing))
      .sort((a, b) => b.listingAge - a.listingAge); // Oldest first

    return eligibleListings;
  }

  /**
   * Enrich eligible listings with views data using the Sell Analytics API
   * Uses getTrafficReport to get LISTING_VIEWS_TOTAL for all listings in one batch
   */
  async enrichListingsWithViews(
    listings: EligibleListing[],
    onProgress?: ViewsEnrichmentCallback
  ): Promise<EligibleListing[]> {
    if (listings.length === 0) return listings;

    // Progress: starting
    if (onProgress) {
      onProgress({
        current: 0,
        total: listings.length,
        currentItemId: '',
        currentItemTitle: 'Connecting to eBay Analytics...',
      });
    }

    const client = await this.getAnalyticsClient();
    const enrichedListings = [...listings];

    // Calculate date range for analytics query
    const endDate = new Date();
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - ANALYTICS_DATE_RANGE_DAYS);

    const formatDate = (d: Date) => {
      const year = d.getFullYear();
      const month = String(d.getMonth() + 1).padStart(2, '0');
      const day = String(d.getDate()).padStart(2, '0');
      return `${year}${month}${day}`;
    };

    const startDateStr = formatDate(startDate);
    const endDateStr = formatDate(endDate);

    // Progress: fetching
    if (onProgress) {
      onProgress({
        current: 0,
        total: listings.length,
        currentItemId: '',
        currentItemTitle: 'Fetching views from Analytics API...',
      });
    }

    try {
      // Get listing IDs
      const listingIds = listings.map((l) => String(l.itemId));

      // Fetch views data in batches (20 per batch due to eBay API limit)
      const viewsData = await client.getBatchListingViews(
        listingIds,
        startDateStr,
        endDateStr,
        (currentBatch, totalBatches) => {
          if (onProgress) {
            onProgress({
              current: currentBatch,
              total: totalBatches,
              currentItemId: '',
              currentItemTitle: `Fetching batch ${currentBatch} of ${totalBatches}...`,
            });
          }
        }
      );

      console.log(
        `[EbayListingRefreshService] Analytics API returned views for ${viewsData.size} listings`
      );

      // Update listings with views data
      for (let i = 0; i < listings.length; i++) {
        const listing = listings[i];
        const listingId = String(listing.itemId);
        const data = viewsData.get(listingId);

        if (data) {
          enrichedListings[i] = {
            ...listing,
            views: data.views,
          };
        }
        // If no data found, views remains null (listing may not have traffic data)
      }

      // Final progress update
      if (onProgress) {
        onProgress({
          current: listings.length,
          total: listings.length,
          currentItemId: '',
          currentItemTitle: 'Views data loaded',
        });
      }
    } catch (error) {
      console.error('[EbayListingRefreshService] Analytics API error:', error);
      // On error, return listings as-is (views will remain null)
      // The error will be visible in the console but we don't fail the entire operation
    }

    return enrichedListings;
  }

  /**
   * Convert ParsedEbayListing to EligibleListing
   */
  private parseToEligibleListing(listing: ParsedEbayListing): EligibleListing {
    const startDate = new Date(listing.ebayData.listingStartDate);
    const endDate = listing.ebayData.listingEndDate
      ? new Date(listing.ebayData.listingEndDate)
      : null;
    const now = new Date();
    const twelveHoursFromNow = new Date(now.getTime() + 12 * 60 * 60 * 1000);
    const endsWithin12Hours = endDate ? endDate <= twelveHoursFromNow : false;

    return {
      itemId: listing.platformItemId,
      title: listing.title,
      price: listing.price,
      currency: listing.currency,
      quantity: listing.quantity,
      quantityAvailable: listing.ebayData.quantityAvailable,
      quantitySold: listing.ebayData.quantitySold,
      condition: listing.ebayData.condition,
      conditionId: listing.ebayData.conditionId,
      watchers: listing.ebayData.watchers,
      views: listing.ebayData.hitCount,
      listingStartDate: startDate,
      listingEndDate: endDate,
      listingAge: calculateListingAge(startDate),
      galleryUrl: listing.ebayData.galleryUrl,
      viewItemUrl: listing.ebayData.viewItemUrl,
      sku: listing.platformSku,
      categoryId: listing.ebayData.categoryId,
      categoryName: listing.ebayData.categoryName,
      listingType: listing.ebayData.listingType,
      bestOfferEnabled: listing.ebayData.bestOfferEnabled,
      // Pending offers will be enriched by the API route
      pendingOfferCount: 0,
      endsWithin12Hours,
    };
  }

  /**
   * Enrich listings with pending offer counts
   */
  async enrichWithPendingOffers(listings: EligibleListing[]): Promise<EligibleListing[]> {
    if (listings.length === 0) return listings;

    const itemIds = listings.map((l) => l.itemId);

    // Get pending offers for all listings
    const { data: pendingOffers } = await this.supabase
      .from('negotiation_offers')
      .select('ebay_listing_id')
      .eq('user_id', this.userId)
      .in('ebay_listing_id', itemIds)
      .eq('status', 'PENDING');

    if (!pendingOffers || pendingOffers.length === 0) {
      return listings;
    }

    // Count offers per listing
    const offerCounts: Record<string, number> = {};
    for (const offer of pendingOffers) {
      const listingId = offer.ebay_listing_id;
      offerCounts[listingId] = (offerCounts[listingId] || 0) + 1;
    }

    // Update listings with counts
    return listings.map((listing) => ({
      ...listing,
      pendingOfferCount: offerCounts[listing.itemId] || 0,
    }));
  }

  // ============================================================================
  // Refresh Job Management
  // ============================================================================

  /**
   * Create a new refresh job with selected listings
   */
  async createRefreshJob(
    eligibleListings: EligibleListing[],
    reviewMode: boolean
  ): Promise<RefreshJob> {
    // Create the job record
    const { data: jobRow, error: jobError } = await this.supabase
      .from('ebay_listing_refreshes')
      .insert({
        user_id: this.userId,
        status: 'pending',
        total_listings: eligibleListings.length,
        review_mode: reviewMode,
      })
      .select()
      .single();

    if (jobError || !jobRow) {
      throw new Error(`Failed to create refresh job: ${jobError?.message}`);
    }

    // Create item records for each listing
    const itemInserts = eligibleListings.map((listing) => ({
      refresh_id: jobRow.id,
      user_id: this.userId,
      original_item_id: listing.itemId,
      original_title: listing.title,
      original_price: listing.price,
      original_quantity: listing.quantity,
      original_condition: listing.condition,
      original_condition_id: listing.conditionId,
      original_category_id: listing.categoryId,
      original_category_name: listing.categoryName,
      original_listing_type: listing.listingType,
      original_listing_start_date: listing.listingStartDate.toISOString(),
      original_watchers: listing.watchers,
      original_views: listing.views,
      original_quantity_sold: listing.quantitySold,
      original_sku: listing.sku,
      original_gallery_url: listing.galleryUrl,
      original_view_item_url: listing.viewItemUrl,
      original_best_offer_enabled: listing.bestOfferEnabled,
      status: reviewMode ? 'pending_review' : 'pending',
    }));

    const { error: itemsError } = await this.supabase
      .from('ebay_listing_refresh_items')
      .insert(itemInserts);

    if (itemsError) {
      // Clean up the job if items failed
      await this.supabase.from('ebay_listing_refreshes').delete().eq('id', jobRow.id);
      throw new Error(`Failed to create refresh items: ${itemsError.message}`);
    }

    return this.getRefreshJob(jobRow.id) as Promise<RefreshJob>;
  }

  /**
   * Get a refresh job by ID with items
   */
  async getRefreshJob(jobId: string): Promise<RefreshJob | null> {
    const { data: jobRow, error: jobError } = await this.supabase
      .from('ebay_listing_refreshes')
      .select('*')
      .eq('id', jobId)
      .eq('user_id', this.userId)
      .single();

    if (jobError || !jobRow) {
      return null;
    }

    const { data: itemRows, error: itemsError } = await this.supabase
      .from('ebay_listing_refresh_items')
      .select('*')
      .eq('refresh_id', jobId)
      .order('created_at', { ascending: true });

    if (itemsError) {
      throw new Error(`Failed to fetch refresh items: ${itemsError.message}`);
    }

    const job = rowToRefreshJob(jobRow as RefreshJobRow);
    job.items = (itemRows as RefreshItemRow[]).map(rowToRefreshJobItem);

    return job;
  }

  /**
   * Get refresh job history for user
   */
  async getRefreshHistory(limit = 20): Promise<RefreshJob[]> {
    const { data: rows, error } = await this.supabase
      .from('ebay_listing_refreshes')
      .select('*')
      .eq('user_id', this.userId)
      .order('created_at', { ascending: false })
      .limit(limit);

    if (error) {
      throw new Error(`Failed to fetch refresh history: ${error.message}`);
    }

    return (rows as RefreshJobRow[]).map(rowToRefreshJob);
  }

  // ============================================================================
  // Item Management
  // ============================================================================

  /**
   * Update an item before refresh (title, price, quantity)
   */
  async updateItemBeforeRefresh(
    itemId: string,
    updates: { title?: string; price?: number; quantity?: number }
  ): Promise<void> {
    const updateData: Record<string, unknown> = {};

    if (updates.title !== undefined) {
      updateData.modified_title = updates.title;
    }
    if (updates.price !== undefined) {
      updateData.modified_price = updates.price;
    }
    if (updates.quantity !== undefined) {
      updateData.modified_quantity = updates.quantity;
    }

    const { error } = await this.supabase
      .from('ebay_listing_refresh_items')
      .update(updateData)
      .eq('id', itemId)
      .eq('user_id', this.userId);

    if (error) {
      throw new Error(`Failed to update item: ${error.message}`);
    }
  }

  /**
   * Approve items for refresh (in review mode)
   */
  async approveItems(refreshId: string, itemIds: string[]): Promise<void> {
    const { error } = await this.supabase
      .from('ebay_listing_refresh_items')
      .update({ status: 'approved' })
      .eq('refresh_id', refreshId)
      .eq('user_id', this.userId)
      .in('id', itemIds);

    if (error) {
      throw new Error(`Failed to approve items: ${error.message}`);
    }
  }

  /**
   * Skip items (exclude from refresh)
   */
  async skipItems(refreshId: string, itemIds: string[]): Promise<void> {
    const { error } = await this.supabase
      .from('ebay_listing_refresh_items')
      .update({ status: 'skipped' })
      .eq('refresh_id', refreshId)
      .eq('user_id', this.userId)
      .in('id', itemIds);

    if (error) {
      throw new Error(`Failed to skip items: ${error.message}`);
    }

    // Update skipped count on job
    await this.updateJobCounts(refreshId);
  }

  // ============================================================================
  // Refresh Execution
  // ============================================================================

  /**
   * Execute the refresh operation for a job
   */
  async executeRefresh(
    jobId: string,
    onProgress?: RefreshProgressCallback
  ): Promise<RefreshResult> {
    const job = await this.getRefreshJob(jobId);
    if (!job) {
      throw new Error('Refresh job not found');
    }

    if (!job.items || job.items.length === 0) {
      throw new Error('No items in refresh job');
    }

    // Filter items that should be processed
    const itemsToProcess = job.items.filter(
      (item) => item.status === 'pending' || item.status === 'approved'
    );

    if (itemsToProcess.length === 0) {
      throw new Error('No items to process');
    }

    const errors: RefreshError[] = [];
    let fetchedCount = 0;
    let endedCount = 0;
    let createdCount = 0;
    let failedCount = 0;
    const skippedCount = job.items.filter((i) => i.status === 'skipped').length;

    // Update job status to fetching
    await this.updateJobStatus(jobId, 'fetching', { startedAt: new Date() });

    // Phase 1: Fetch full details for each item
    // Refresh token at the start of each phase to prevent expiry during long operations
    let client = await this.getTradingClient();
    for (let i = 0; i < itemsToProcess.length; i++) {
      const item = itemsToProcess[i];

      if (onProgress) {
        onProgress({
          phase: 'fetching',
          current: i + 1,
          total: itemsToProcess.length,
          currentItemId: item.originalItemId,
          currentItemTitle: item.originalTitle,
          fetchedCount,
          endedCount,
          createdCount,
          failedCount,
          skippedCount,
        });
      }

      try {
        await this.updateItemStatus(item.id, 'fetching');

        const fullDetails = await client.getItem(item.originalItemId);

        // Store full details for recreation
        await this.supabase
          .from('ebay_listing_refresh_items')
          .update({
            status: 'fetched',
            original_description: fullDetails.description,
            original_image_urls: fullDetails.pictureUrls,
            original_shipping_policy_id: fullDetails.shippingProfileId,
            original_return_policy_id: fullDetails.returnProfileId,
            original_payment_policy_id: fullDetails.paymentProfileId,
            cached_listing_data: JSON.parse(JSON.stringify(fullDetails)),
            fetch_completed_at: new Date().toISOString(),
          })
          .eq('id', item.id)
          .eq('user_id', this.userId);

        // Update item in memory
        item.cachedListingData = fullDetails;
        item.status = 'fetched';
        fetchedCount++;

        await this.delay(RATE_LIMIT_DELAY_MS);
      } catch (error) {
        failedCount++;
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        errors.push({
          itemId: item.originalItemId,
          title: item.originalTitle,
          phase: 'fetch',
          errorCode: null,
          errorMessage,
        });
        await this.recordItemError(item.id, 'fetch', null, errorMessage);
      }
    }

    // Update job after fetch phase
    await this.updateJobStatus(jobId, 'ending', {
      fetchPhaseCompletedAt: new Date(),
      fetchedCount,
      failedCount,
    });

    // Phase 2: End listings
    // Refresh token before ending phase to prevent expiry during long operations
    client = await this.getTradingClient();
    const fetchedItems = itemsToProcess.filter((item) => item.status === 'fetched');

    for (let i = 0; i < fetchedItems.length; i++) {
      const item = fetchedItems[i];

      if (onProgress) {
        onProgress({
          phase: 'ending',
          current: i + 1,
          total: fetchedItems.length,
          currentItemId: item.originalItemId,
          currentItemTitle: item.originalTitle,
          fetchedCount,
          endedCount,
          createdCount,
          failedCount,
          skippedCount,
        });
      }

      try {
        await this.updateItemStatus(item.id, 'ending');

        const result = await client.endFixedPriceItem(item.originalItemId, 'NotAvailable');

        if (result.success) {
          await this.supabase
            .from('ebay_listing_refresh_items')
            .update({
              status: 'ended',
              end_completed_at: new Date().toISOString(),
            })
            .eq('id', item.id)
            .eq('user_id', this.userId);

          item.status = 'ended';
          endedCount++;
        } else {
          throw new Error(result.errorMessage || 'Failed to end listing');
        }

        await this.delay(RATE_LIMIT_DELAY_MS);
      } catch (error) {
        failedCount++;
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        errors.push({
          itemId: item.originalItemId,
          title: item.originalTitle,
          phase: 'end',
          errorCode: null,
          errorMessage,
        });
        await this.recordItemError(item.id, 'end', null, errorMessage);
      }
    }

    // Update job after end phase
    await this.updateJobStatus(jobId, 'creating', {
      endPhaseCompletedAt: new Date(),
      endedCount,
      failedCount,
    });

    // Phase 3: Create new listings
    // Refresh token before creation phase to prevent expiry during long operations
    client = await this.getTradingClient();
    const endedItems = fetchedItems.filter((item) => item.status === 'ended');

    for (let i = 0; i < endedItems.length; i++) {
      const item = endedItems[i];
      const cachedData = item.cachedListingData;

      if (!cachedData) {
        failedCount++;
        errors.push({
          itemId: item.originalItemId,
          title: item.originalTitle,
          phase: 'create',
          errorCode: null,
          errorMessage: 'No cached listing data available',
        });
        await this.recordItemError(item.id, 'create', null, 'No cached listing data available');
        continue;
      }

      if (onProgress) {
        onProgress({
          phase: 'creating',
          current: i + 1,
          total: endedItems.length,
          currentItemId: item.originalItemId,
          currentItemTitle: item.modifiedTitle || item.originalTitle,
          fetchedCount,
          endedCount,
          createdCount,
          failedCount,
          skippedCount,
        });
      }

      try {
        await this.updateItemStatus(item.id, 'creating');

        // Build add item request using cached data with any modifications
        const addRequest: AddFixedPriceItemRequest = {
          title: item.modifiedTitle || cachedData.title,
          description: cachedData.description,
          sku: cachedData.sku || undefined,
          startPrice: item.modifiedPrice || cachedData.startPrice,
          quantity: item.modifiedQuantity || cachedData.quantity,
          currency: cachedData.currency,
          conditionId: cachedData.conditionId || undefined,
          conditionDescription: cachedData.conditionDescription || undefined,
          categoryId: cachedData.categoryId,
          storeCategoryId: cachedData.storeCategoryId || undefined,
          listingDuration: cachedData.listingDuration || 'GTC',
          pictureUrls: cachedData.pictureUrls,

          // Best offer settings
          bestOfferEnabled: cachedData.bestOfferEnabled,
          bestOfferAutoAcceptPrice: cachedData.bestOfferAutoAcceptPrice || undefined,
          minimumBestOfferPrice: cachedData.minimumBestOfferPrice || undefined,

          // Business policies
          shippingProfileId: cachedData.shippingProfileId || undefined,
          returnProfileId: cachedData.returnProfileId || undefined,
          paymentProfileId: cachedData.paymentProfileId || undefined,

          // Fallback shipping/return details
          shippingServiceOptions:
            cachedData.shippingServiceOptions.length > 0
              ? cachedData.shippingServiceOptions
              : undefined,
          dispatchTimeMax: cachedData.dispatchTimeMax || undefined,
          returnsAccepted: cachedData.returnsAccepted,
          returnsWithin: cachedData.returnsWithin || undefined,
          refundOption: cachedData.refundOption || undefined,
          shippingCostPaidBy: cachedData.shippingCostPaidBy || undefined,

          // Item specifics
          itemSpecifics: cachedData.itemSpecifics.length > 0 ? cachedData.itemSpecifics : undefined,

          // Location
          location: cachedData.location || undefined,
          country: cachedData.country || undefined,
          postalCode: cachedData.postalCode || undefined,
        };

        const result = await client.addFixedPriceItem(addRequest);

        if (result.success && result.itemId) {
          await this.supabase
            .from('ebay_listing_refresh_items')
            .update({
              status: 'created',
              new_item_id: result.itemId,
              new_listing_url: `https://www.ebay.co.uk/itm/${result.itemId}`,
              new_listing_start_date: result.startTime,
              create_completed_at: new Date().toISOString(),
            })
            .eq('id', item.id)
            .eq('user_id', this.userId);

          createdCount++;
        } else {
          throw new Error(result.errorMessage || 'Failed to create listing');
        }

        await this.delay(RATE_LIMIT_DELAY_MS);
      } catch (error) {
        failedCount++;
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        errors.push({
          itemId: item.originalItemId,
          title: item.originalTitle,
          phase: 'create',
          errorCode: null,
          errorMessage,
        });
        await this.recordItemError(item.id, 'create', null, errorMessage);
      }
    }

    // Update job to completed
    const completedAt = new Date();
    await this.updateJobStatus(
      jobId,
      errors.length > 0 && createdCount === 0 ? 'failed' : 'completed',
      {
        completedAt,
        fetchedCount,
        endedCount,
        createdCount,
        failedCount,
        skippedCount,
      }
    );

    return {
      success: errors.length === 0 || createdCount > 0,
      jobId,
      totalProcessed: itemsToProcess.length,
      fetchedCount,
      endedCount,
      createdCount,
      failedCount,
      skippedCount,
      errors,
      completedAt,
    };
  }

  /**
   * Cancel a refresh job
   */
  async cancelRefresh(jobId: string): Promise<void> {
    // Check if job exists first
    const job = await this.getRefreshJob(jobId);
    if (!job) {
      throw new Error('Refresh job not found');
    }
    await this.updateJobStatus(jobId, 'cancelled', { completedAt: new Date() });
  }

  // ============================================================================
  // Private Helpers
  // ============================================================================

  /**
   * Update job status and optional fields
   */
  private async updateJobStatus(
    jobId: string,
    status: RefreshJobStatus,
    updates?: {
      startedAt?: Date;
      fetchPhaseCompletedAt?: Date;
      endPhaseCompletedAt?: Date;
      completedAt?: Date;
      fetchedCount?: number;
      endedCount?: number;
      createdCount?: number;
      failedCount?: number;
      skippedCount?: number;
      errorMessage?: string;
    }
  ): Promise<void> {
    const updateData: Record<string, unknown> = { status };

    if (updates?.startedAt) {
      updateData.started_at = updates.startedAt.toISOString();
    }
    if (updates?.fetchPhaseCompletedAt) {
      updateData.fetch_phase_completed_at = updates.fetchPhaseCompletedAt.toISOString();
    }
    if (updates?.endPhaseCompletedAt) {
      updateData.end_phase_completed_at = updates.endPhaseCompletedAt.toISOString();
    }
    if (updates?.completedAt) {
      updateData.completed_at = updates.completedAt.toISOString();
    }
    if (updates?.fetchedCount !== undefined) {
      updateData.fetched_count = updates.fetchedCount;
    }
    if (updates?.endedCount !== undefined) {
      updateData.ended_count = updates.endedCount;
    }
    if (updates?.createdCount !== undefined) {
      updateData.created_count = updates.createdCount;
    }
    if (updates?.failedCount !== undefined) {
      updateData.failed_count = updates.failedCount;
    }
    if (updates?.skippedCount !== undefined) {
      updateData.skipped_count = updates.skippedCount;
    }
    if (updates?.errorMessage) {
      updateData.error_message = updates.errorMessage;
    }

    await this.supabase
      .from('ebay_listing_refreshes')
      .update(updateData)
      .eq('id', jobId)
      .eq('user_id', this.userId);
  }

  /**
   * Update item status
   */
  private async updateItemStatus(itemId: string, status: RefreshItemStatus): Promise<void> {
    await this.supabase
      .from('ebay_listing_refresh_items')
      .update({ status })
      .eq('id', itemId)
      .eq('user_id', this.userId);
  }

  /**
   * Record an error on an item
   */
  private async recordItemError(
    itemId: string,
    phase: 'fetch' | 'end' | 'create',
    errorCode: string | null,
    errorMessage: string
  ): Promise<void> {
    await this.supabase
      .from('ebay_listing_refresh_items')
      .update({
        status: 'failed',
        error_phase: phase,
        error_code: errorCode,
        error_message: errorMessage,
      })
      .eq('id', itemId)
      .eq('user_id', this.userId);
  }

  /**
   * Update job counts from items
   */
  private async updateJobCounts(jobId: string): Promise<void> {
    const { data: items } = await this.supabase
      .from('ebay_listing_refresh_items')
      .select('status')
      .eq('refresh_id', jobId)
      .eq('user_id', this.userId);

    if (!items) return;

    const counts = {
      skipped_count: items.filter((i) => i.status === 'skipped').length,
      failed_count: items.filter((i) => i.status === 'failed').length,
      fetched_count: items.filter((i) =>
        ['fetched', 'ending', 'ended', 'creating', 'created'].includes(i.status)
      ).length,
      ended_count: items.filter((i) => ['ended', 'creating', 'created'].includes(i.status)).length,
      created_count: items.filter((i) => i.status === 'created').length,
    };

    await this.supabase
      .from('ebay_listing_refreshes')
      .update(counts)
      .eq('id', jobId)
      .eq('user_id', this.userId);
  }

  /**
   * Delay execution
   */
  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
