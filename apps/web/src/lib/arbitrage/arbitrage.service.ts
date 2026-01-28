/**
 * Arbitrage Service
 *
 * Main service for arbitrage tracking functionality.
 * Coordinates between Amazon inventory, Amazon pricing, BrickLink pricing,
 * and ASIN mapping.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database, Json } from '@hadley-bricks/database';
import type {
  ArbitrageItem,
  ArbitrageFilterOptions,
  ArbitrageDataResponse,
  ExcludedAsin,
  UnmappedAsin,
  ArbitrageSyncStatus,
  SyncJobType,
  EbayListing,
} from './types';

/**
 * Service for arbitrage tracking operations
 */
export class ArbitrageService {
  constructor(private supabase: SupabaseClient<Database>) {}

  // ============================================
  // Data Fetching
  // ============================================

  /**
   * Get arbitrage data with filtering and pagination
   */
  async getArbitrageData(
    userId: string,
    options: ArbitrageFilterOptions = {}
  ): Promise<ArbitrageDataResponse> {
    const {
      minMargin = 30,
      maxCog = 50,
      show = 'all',
      sortField = 'margin',
      sortDirection = 'desc',
      search,
      page = 1,
      pageSize = 50,
    } = options;

    // Fetch user's excluded eBay listings for recalculating stats
    const { data: excludedEbayListings } = await this.supabase
      .from('excluded_ebay_listings')
      .select('ebay_item_id, set_number')
      .eq('user_id', userId);

    // Create a lookup: set_number -> Set of excluded item IDs
    const excludedBySet = new Map<string, Set<string>>();
    for (const row of excludedEbayListings ?? []) {
      if (!excludedBySet.has(row.set_number)) {
        excludedBySet.set(row.set_number, new Set());
      }
      excludedBySet.get(row.set_number)!.add(row.ebay_item_id);
    }

    // For eBay sorting, use raw SQL to sort by exclusion-adjusted values
    // This ensures consistent sorting across pagination
    if (sortField === 'ebay_margin' || sortField === 'ebay_price') {
      return this.getArbitrageDataWithAdjustedEbaySort(
        userId,
        excludedBySet,
        options
      );
    }

    // Use the view for denormalized data (non-eBay sorting)
    let query = this.supabase
      .from('arbitrage_current_view')
      .select('*', { count: 'exact' })
      .eq('user_id', userId);

    // Apply show filter
    // Note: COG% = 100 - margin%, so maxCog filter uses gte on margin: margin >= (100 - maxCog)
    const minMarginFromCog = 100 - maxCog;
    switch (show) {
      case 'opportunities':
        query = query.gte('margin_percent', minMargin);
        break;
      case 'ebay_opportunities':
        // Filter by COG%: items with COG <= maxCog have margin >= (100 - maxCog)
        query = query.gte('ebay_margin_percent', minMarginFromCog);
        break;
      case 'with_ebay_data':
        query = query.not('ebay_min_price', 'is', null);
        break;
      case 'no_ebay_data':
        query = query.is('ebay_min_price', null);
        break;
      case 'in_stock':
        query = query.gt('your_qty', 0);
        break;
      case 'zero_qty':
        query = query.eq('your_qty', 0);
        break;
      case 'pending_review':
        query = query.eq('status', 'pending_review');
        break;
      // 'all' - no additional filter
    }

    // Apply search filter
    if (search) {
      query = query.or(`name.ilike.%${search}%,asin.ilike.%${search}%,bricklink_set_number.ilike.%${search}%`);
    }

    // Apply sorting
    const sortColumn = this.getSortColumn(sortField);
    query = query.order(sortColumn, { ascending: sortDirection === 'asc', nullsFirst: false });

    // Apply pagination
    const from = (page - 1) * pageSize;
    const to = from + pageSize - 1;
    query = query.range(from, to);

    const { data, count, error } = await query;

    if (error) {
      console.error('[ArbitrageService.getArbitrageData] Error:', error);
      throw new Error(`Failed to fetch arbitrage data: ${error.message}`);
    }

    // Transform to ArbitrageItem type and recalculate eBay stats excluding user's excluded listings
    const items = (data ?? []).map((row) => {
      const item = this.transformToArbitrageItem(row);
      return this.recalculateEbayStats(item, excludedBySet);
    });

    // Count opportunities
    const { count: opportunityCount } = await this.supabase
      .from('arbitrage_current_view')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', userId)
      .gte('margin_percent', minMargin);

    return {
      items,
      totalCount: count ?? 0,
      opportunityCount: opportunityCount ?? 0,
      hasMore: (count ?? 0) > from + items.length,
    };
  }

  /**
   * Get arbitrage data with eBay sorting using exclusion-adjusted values
   * Uses RPC function to calculate adjusted eBay min price considering user exclusions
   */
  private async getArbitrageDataWithAdjustedEbaySort(
    userId: string,
    excludedBySet: Map<string, Set<string>>,
    options: ArbitrageFilterOptions
  ): Promise<ArbitrageDataResponse> {
    const {
      minMargin = 30,
      maxCog = 50,
      show = 'all',
      sortField = 'ebay_margin',
      sortDirection = 'asc',
      search,
      page = 1,
      pageSize = 50,
    } = options;

    const offset = (page - 1) * pageSize;

    // Call the RPC function that handles adjusted eBay sorting
    const { data, error } = await this.supabase.rpc('get_arbitrage_with_adjusted_ebay', {
      p_user_id: userId,
      p_show: show,
      p_max_cog: maxCog,
      p_min_margin: minMargin,
      p_search: search ?? undefined,
      p_sort_field: sortField,
      p_sort_direction: sortDirection,
      p_page_size: pageSize,
      p_offset: offset,
    });

    if (error) {
      console.error('[ArbitrageService.getArbitrageDataWithAdjustedEbaySort] Error:', error);
      throw new Error(`Failed to fetch arbitrage data: ${error.message}`);
    }

    // Get the count using the count RPC
    const { data: countData, error: countError } = await this.supabase.rpc('get_arbitrage_adjusted_count', {
      p_user_id: userId,
      p_show: show,
      p_max_cog: maxCog,
      p_min_margin: minMargin,
      p_search: search ?? undefined,
    });

    if (countError) {
      console.error('[ArbitrageService.getArbitrageDataWithAdjustedEbaySort] Count error:', countError);
    }

    const totalCount = countData ?? 0;

    // Transform RPC results and use the adjusted values from the RPC directly
    // The RPC already calculated exclusion-adjusted eBay stats - use those instead of recalculating
    const items = (data ?? []).map((row: Record<string, unknown>) => {
      const item = this.transformToArbitrageItem(row);

      // Use the RPC's pre-calculated adjusted values if available
      const adjustedMinPrice = row.adjusted_ebay_min_price as number | null;
      const adjustedCogPercent = row.adjusted_cog_percent as number | null;

      if (adjustedMinPrice !== null || adjustedCogPercent !== null) {
        // Get excluded listings count to update ebayTotalListings
        const excludedIds = excludedBySet.get(item.bricklinkSetNumber ?? '');
        const originalListings = item.ebayListings as EbayListing[] | null;
        const activeListings = originalListings?.filter(
          (l) => !excludedIds?.has(l.itemId)
        ) ?? originalListings;

        return {
          ...item,
          ebayMinPrice: adjustedMinPrice ?? item.ebayMinPrice,
          ebayCogPercent: adjustedCogPercent,
          ebayTotalListings: activeListings?.length ?? item.ebayTotalListings,
          ebayListings: activeListings,
        };
      }

      // Fallback to client-side recalculation if RPC didn't return adjusted values
      return this.recalculateEbayStats(item, excludedBySet);
    });

    // Count opportunities (BrickLink-based)
    const { count: opportunityCount } = await this.supabase
      .from('arbitrage_current_view')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', userId)
      .gte('margin_percent', minMargin);

    return {
      items,
      totalCount,
      opportunityCount: opportunityCount ?? 0,
      hasMore: totalCount > offset + items.length,
    };
  }

  /**
   * Get a single arbitrage item by ASIN
   */
  async getArbitrageItem(userId: string, asin: string): Promise<ArbitrageItem | null> {
    const { data, error } = await this.supabase
      .from('arbitrage_current_view')
      .select('*')
      .eq('user_id', userId)
      .eq('asin', asin)
      .maybeSingle();

    if (error) {
      console.error('[ArbitrageService.getArbitrageItem] Error:', error);
      throw new Error(`Failed to fetch arbitrage item: ${error.message}`);
    }

    if (!data) return null;

    const item = this.transformToArbitrageItem(data);

    // Fetch user's excluded eBay listings for this item's set
    if (item.bricklinkSetNumber) {
      const { data: excludedEbayListings } = await this.supabase
        .from('excluded_ebay_listings')
        .select('ebay_item_id')
        .eq('user_id', userId)
        .eq('set_number', item.bricklinkSetNumber);

      if (excludedEbayListings && excludedEbayListings.length > 0) {
        const excludedBySet = new Map<string, Set<string>>();
        excludedBySet.set(
          item.bricklinkSetNumber,
          new Set(excludedEbayListings.map((r) => r.ebay_item_id))
        );
        return this.recalculateEbayStats(item, excludedBySet);
      }
    }

    return item;
  }

  // ============================================
  // Exclusion Management
  // ============================================

  /**
   * Exclude an ASIN from tracking
   */
  async excludeAsin(userId: string, asin: string, reason?: string): Promise<void> {
    const { error } = await this.supabase
      .from('tracked_asins')
      .update({
        status: 'excluded',
        excluded_at: new Date().toISOString(),
        exclusion_reason: reason || null,
      })
      .eq('user_id', userId)
      .eq('asin', asin);

    if (error) {
      console.error('[ArbitrageService.excludeAsin] Error:', error);
      throw new Error(`Failed to exclude ASIN: ${error.message}`);
    }
  }

  /**
   * Restore an excluded ASIN to active tracking
   */
  async restoreAsin(userId: string, asin: string): Promise<void> {
    const { error } = await this.supabase
      .from('tracked_asins')
      .update({
        status: 'active',
        excluded_at: null,
        exclusion_reason: null,
      })
      .eq('user_id', userId)
      .eq('asin', asin);

    if (error) {
      console.error('[ArbitrageService.restoreAsin] Error:', error);
      throw new Error(`Failed to restore ASIN: ${error.message}`);
    }
  }

  /**
   * Set or clear the minimum BrickLink price override for an ASIN
   * When set, COG% will use MAX(actual_bl_min, override) for calculations
   */
  async setBlPriceOverride(userId: string, asin: string, override: number | null): Promise<void> {
    const { error } = await this.supabase
      .from('asin_bricklink_mapping')
      .update({ min_bl_price_override: override })
      .eq('user_id', userId)
      .eq('asin', asin);

    if (error) {
      console.error('[ArbitrageService.setBlPriceOverride] Error:', error);
      throw new Error(`Failed to set BL price override: ${error.message}`);
    }
  }

  /**
   * Get all excluded ASINs
   */
  async getExcludedAsins(userId: string): Promise<ExcludedAsin[]> {
    // Get excluded tracked ASINs
    const { data: excludedAsins, error: asinsError } = await this.supabase
      .from('tracked_asins')
      .select('asin, name, excluded_at, exclusion_reason')
      .eq('user_id', userId)
      .eq('status', 'excluded')
      .order('excluded_at', { ascending: false });

    if (asinsError) {
      console.error('[ArbitrageService.getExcludedAsins] Error fetching excluded ASINs:', asinsError);
      throw new Error(`Failed to fetch excluded ASINs: ${asinsError.message}`);
    }

    if (!excludedAsins || excludedAsins.length === 0) {
      return [];
    }

    // Get mappings for these ASINs
    const asins = excludedAsins.map((a) => a.asin);
    const { data: mappings, error: mappingsError } = await this.supabase
      .from('asin_bricklink_mapping')
      .select('asin, bricklink_set_number')
      .eq('user_id', userId)
      .in('asin', asins);

    if (mappingsError) {
      console.error('[ArbitrageService.getExcludedAsins] Error fetching mappings:', mappingsError);
      throw new Error(`Failed to fetch mappings: ${mappingsError.message}`);
    }

    // Create mapping lookup
    const mappingLookup = new Map(
      (mappings ?? []).map((m) => [m.asin, m.bricklink_set_number])
    );

    return excludedAsins.map((row) => ({
      asin: row.asin,
      name: row.name,
      bricklinkSetNumber: mappingLookup.get(row.asin) ?? null,
      excludedAt: row.excluded_at ?? '',
      exclusionReason: row.exclusion_reason,
    }));
  }

  // ============================================
  // Unmapped ASINs (Manual Mapping)
  // ============================================

  /**
   * Get ASINs that need manual mapping
   */
  async getUnmappedAsins(userId: string): Promise<UnmappedAsin[]> {
    // Get all active tracked ASINs
    const { data: allAsins, error: asinsError } = await this.supabase
      .from('tracked_asins')
      .select('asin, name, image_url, added_at')
      .eq('user_id', userId)
      .eq('status', 'active')
      .order('added_at', { ascending: false });

    if (asinsError) {
      console.error('[ArbitrageService.getUnmappedAsins] Error fetching ASINs:', asinsError);
      throw new Error(`Failed to fetch ASINs: ${asinsError.message}`);
    }

    // Get all existing mappings
    const { data: mappings, error: mappingsError } = await this.supabase
      .from('asin_bricklink_mapping')
      .select('asin')
      .eq('user_id', userId);

    if (mappingsError) {
      console.error('[ArbitrageService.getUnmappedAsins] Error fetching mappings:', mappingsError);
      throw new Error(`Failed to fetch mappings: ${mappingsError.message}`);
    }

    // Filter to get only unmapped ASINs
    const mappedAsins = new Set(mappings?.map((m) => m.asin) ?? []);
    const unmapped = (allAsins ?? []).filter((a) => !mappedAsins.has(a.asin));

    // For each unmapped ASIN, try to detect set number from name
    return unmapped.map((row) => ({
      asin: row.asin,
      name: row.name,
      imageUrl: row.image_url,
      detectedSetNumber: this.extractSetNumberFromTitle(row.name),
      suggestedMatch: null, // Could be populated from BrickLink search
      addedAt: row.added_at,
    }));
  }

  /**
   * Get count of unmapped ASINs
   */
  async getUnmappedCount(userId: string): Promise<number> {
    // Get count of all active ASINs
    const { count: totalCount, error: totalError } = await this.supabase
      .from('tracked_asins')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', userId)
      .eq('status', 'active');

    if (totalError) {
      console.error('[ArbitrageService.getUnmappedCount] Error getting total:', totalError);
      return 0;
    }

    // Get count of mapped ASINs
    const { count: mappedCount, error: mappedError } = await this.supabase
      .from('asin_bricklink_mapping')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', userId);

    if (mappedError) {
      console.error('[ArbitrageService.getUnmappedCount] Error getting mapped:', mappedError);
      return 0;
    }

    return (totalCount ?? 0) - (mappedCount ?? 0);
  }

  /**
   * Create a manual ASIN to BrickLink mapping
   */
  async createManualMapping(
    userId: string,
    asin: string,
    bricklinkSetNumber: string
  ): Promise<void> {
    const { error } = await this.supabase
      .from('asin_bricklink_mapping')
      .upsert({
        asin,
        user_id: userId,
        bricklink_set_number: bricklinkSetNumber,
        match_confidence: 'manual',
        match_method: 'user_manual_entry',
        verified_at: new Date().toISOString(),
      });

    if (error) {
      console.error('[ArbitrageService.createManualMapping] Error:', error);
      throw new Error(`Failed to create mapping: ${error.message}`);
    }
  }

  // ============================================
  // Sync Status
  // ============================================

  /**
   * Get sync status for all job types
   */
  async getSyncStatus(userId: string): Promise<Record<SyncJobType, ArbitrageSyncStatus | null>> {
    const { data, error } = await this.supabase
      .from('arbitrage_sync_status')
      .select('*')
      .eq('user_id', userId);

    if (error) {
      console.error('[ArbitrageService.getSyncStatus] Error:', error);
      throw new Error(`Failed to fetch sync status: ${error.message}`);
    }

    const statusMap: Record<SyncJobType, ArbitrageSyncStatus | null> = {
      inventory_asins: null,
      amazon_pricing: null,
      bricklink_pricing: null,
      ebay_pricing: null,
      asin_mapping: null,
      seeded_discovery: null,
    };

    // Map database job types to UI-expected job types
    const jobTypeMapping: Record<string, SyncJobType> = {
      'bricklink_scheduled_pricing': 'bricklink_pricing',
      'ebay_scheduled_pricing': 'ebay_pricing',
      'pricing_sync': 'amazon_pricing',
    };

    for (const row of data ?? []) {
      const dbJobType = row.job_type as string;
      // Map to UI job type if mapping exists, otherwise use as-is
      const jobType = (jobTypeMapping[dbJobType] ?? dbJobType) as SyncJobType;
      // Only set if it's a valid SyncJobType and not already set (prefer first match)
      if (jobType in statusMap && statusMap[jobType] === null) {
        statusMap[jobType] = this.transformToSyncStatus(row);
      }
    }

    return statusMap;
  }

  /**
   * Update sync status for a job
   */
  async updateSyncStatus(
    userId: string,
    jobType: SyncJobType,
    status: Partial<Omit<ArbitrageSyncStatus, 'id' | 'userId' | 'jobType' | 'createdAt' | 'updatedAt'>>
  ): Promise<void> {
    const { error } = await this.supabase
      .from('arbitrage_sync_status')
      .upsert({
        user_id: userId,
        job_type: jobType,
        status: status.status,
        last_run_at: status.lastRunAt,
        last_success_at: status.lastSuccessAt,
        last_run_duration_ms: status.lastRunDurationMs,
        items_processed: status.itemsProcessed,
        items_failed: status.itemsFailed,
        error_message: status.errorMessage,
        error_details: (status.errorDetails ?? null) as Json,
      }, {
        onConflict: 'user_id,job_type',
      });

    if (error) {
      console.error('[ArbitrageService.updateSyncStatus] Error:', error);
      throw new Error(`Failed to update sync status: ${error.message}`);
    }
  }

  // ============================================
  // Summary Stats
  // ============================================

  /**
   * Get summary statistics
   */
  async getSummaryStats(userId: string, minMargin: number = 30, maxCog: number = 50): Promise<{
    totalItems: number;
    opportunities: number;
    ebayOpportunities: number;
    unmapped: number;
    excluded: number;
  }> {
    // Convert maxCog to equivalent minMargin for eBay: COG% = 100 - margin%
    const ebayMinMarginFromCog = 100 - maxCog;

    const [
      { count: totalItems },
      { count: opportunities },
      { count: ebayOpportunities },
      { count: excluded },
    ] = await Promise.all([
      this.supabase
        .from('tracked_asins')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', userId)
        .eq('status', 'active'),
      this.supabase
        .from('arbitrage_current_view')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', userId)
        .gte('margin_percent', minMargin),
      // eBay opportunities: use COG% (maxCog) converted to margin threshold
      this.supabase
        .from('arbitrage_current_view')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', userId)
        .gte('ebay_margin_percent', ebayMinMarginFromCog),
      this.supabase
        .from('tracked_asins')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', userId)
        .eq('status', 'excluded'),
    ]);

    const unmapped = await this.getUnmappedCount(userId);

    return {
      totalItems: totalItems ?? 0,
      opportunities: opportunities ?? 0,
      ebayOpportunities: ebayOpportunities ?? 0,
      unmapped,
      excluded: excluded ?? 0,
    };
  }

  // ============================================
  // Helper Methods
  // ============================================

  /**
   * Map sort field to database column
   */
  private getSortColumn(sortField: string): string {
    const mapping: Record<string, string> = {
      margin: 'margin_percent',
      cog: 'cog_percent',
      bl_price: 'bl_min_price',
      your_price: 'your_price',
      buy_box: 'buy_box_price',
      was_price: 'was_price_90d',
      sales_rank: 'sales_rank',
      bl_lots: 'bl_total_lots',
      name: 'name',
      ebay_margin: 'ebay_margin_percent',
      ebay_price: 'ebay_min_price',
    };
    return mapping[sortField] ?? 'cog_percent';
  }

  /**
   * Extract set number from Amazon product title
   */
  private extractSetNumberFromTitle(title: string | null): string | null {
    if (!title) return null;

    // Try standard format: 40585-1
    const standardMatch = title.match(/(\d{4,6}-\d)/);
    if (standardMatch) return standardMatch[1];

    // Try number only with LEGO prefix: LEGO 40585
    const legoMatch = title.match(/LEGO\s+(\d{4,6})/i);
    if (legoMatch) return `${legoMatch[1]}-1`;

    // Try standalone number (less confident)
    const numberMatch = title.match(/\b(\d{5})\b/);
    if (numberMatch) return `${numberMatch[1]}-1`;

    return null;
  }

  /**
   * Recalculate eBay stats after excluding user's excluded listings
   * Updates min/avg/max prices and margin based on remaining active listings
   */
  private recalculateEbayStats(
    item: ArbitrageItem,
    excludedBySet: Map<string, Set<string>>
  ): ArbitrageItem {
    // If no eBay listings or no set number, return as-is
    if (!item.ebayListings || !item.bricklinkSetNumber) {
      return item;
    }

    // Get excluded item IDs for this set
    const excludedIds = excludedBySet.get(item.bricklinkSetNumber);
    if (!excludedIds || excludedIds.size === 0) {
      // No exclusions for this set, return as-is
      return item;
    }

    // Filter out excluded listings
    const listings = item.ebayListings as EbayListing[];
    const activeListings = listings.filter((l) => !excludedIds.has(l.itemId));

    // If no active listings remain, clear eBay data
    if (activeListings.length === 0) {
      return {
        ...item,
        ebayMinPrice: null,
        ebayAvgPrice: null,
        ebayMaxPrice: null,
        ebayTotalListings: 0,
        ebayMarginPercent: null,
        ebayMarginAbsolute: null,
        ebayListings: [],
      };
    }

    // Recalculate stats from active listings (using totalPrice which includes shipping)
    const prices = activeListings.map((l) => l.totalPrice);
    const minPrice = Math.min(...prices);
    const maxPrice = Math.max(...prices);
    const avgPrice = prices.reduce((sum, p) => sum + p, 0) / prices.length;

    // Recalculate margin and COG% based on buy_box_price first (matching DB logic)
    const sellPrice = item.buyBoxPrice ?? item.yourPrice ?? 0;
    let marginPercent: number | null = null;
    let marginAbsolute: number | null = null;
    let cogPercent: number | null = null;

    if (sellPrice > 0 && minPrice > 0) {
      marginAbsolute = sellPrice - minPrice;
      marginPercent = (marginAbsolute / sellPrice) * 100;
      cogPercent = (minPrice / sellPrice) * 100;
    }

    return {
      ...item,
      ebayMinPrice: minPrice,
      ebayAvgPrice: avgPrice,
      ebayMaxPrice: maxPrice,
      ebayTotalListings: activeListings.length,
      ebayMarginPercent: marginPercent,
      ebayMarginAbsolute: marginAbsolute,
      ebayCogPercent: cogPercent,
      ebayListings: activeListings as EbayListing[],
    };
  }

  /**
   * Transform database row to ArbitrageItem
   */
  private transformToArbitrageItem(row: Record<string, unknown>): ArbitrageItem {
    return {
      asin: row.asin as string,
      userId: row.user_id as string,
      name: row.name as string | null,
      imageUrl: row.image_url as string | null,
      sku: row.sku as string | null,
      source: row.source as ArbitrageItem['source'],
      status: row.status as ArbitrageItem['status'],
      bricklinkSetNumber: row.bricklink_set_number as string | null,
      matchConfidence: row.match_confidence as ArbitrageItem['matchConfidence'] | null,
      yourPrice: row.your_price as number | null,
      yourQty: row.your_qty as number | null,
      buyBoxPrice: row.buy_box_price as number | null,
      buyBoxIsYours: row.buy_box_is_yours as boolean | null,
      offerCount: row.offer_count as number | null,
      wasPrice90d: row.was_price_90d as number | null,
      salesRank: row.sales_rank as number | null,
      salesRankCategory: row.sales_rank_category as string | null,
      amazonSnapshotDate: row.amazon_snapshot_date as string | null,
      // Lowest offer fallback fields
      lowestOfferPrice: row.lowest_offer_price as number | null,
      priceIsLowestOffer: row.price_is_lowest_offer as boolean | null,
      lowestOfferSellerId: row.lowest_offer_seller_id as string | null,
      lowestOfferIsFba: row.lowest_offer_is_fba as boolean | null,
      lowestOfferIsPrime: row.lowest_offer_is_prime as boolean | null,
      offersJson: row.offers_json as ArbitrageItem['offersJson'],
      totalOfferCount: row.total_offer_count as number | null,
      competitivePrice: row.competitive_price as number | null,
      effectiveAmazonPrice: row.effective_amazon_price as number | null,
      blMinPrice: row.bl_min_price as number | null,
      blAvgPrice: row.bl_avg_price as number | null,
      blMaxPrice: row.bl_max_price as number | null,
      blTotalLots: row.bl_total_lots as number | null,
      blTotalQty: row.bl_total_qty as number | null,
      blPriceDetail: row.bl_price_detail as ArbitrageItem['blPriceDetail'],
      blSnapshotDate: row.bl_snapshot_date as string | null,
      // BrickLink price override
      minBlPriceOverride: row.min_bl_price_override as number | null,
      effectiveBlPrice: row.effective_bl_price as number | null,
      cogPercent: row.cog_percent as number | null,
      marginPercent: row.margin_percent as number | null,
      marginAbsolute: row.margin_absolute as number | null,
      amazonUrl: row.amazon_url as string | null,
      // eBay fields
      ebayMinPrice: row.ebay_min_price as number | null,
      ebayAvgPrice: row.ebay_avg_price as number | null,
      ebayMaxPrice: row.ebay_max_price as number | null,
      ebayTotalListings: row.ebay_total_listings as number | null,
      ebayListings: row.ebay_listings as ArbitrageItem['ebayListings'],
      ebaySnapshotDate: row.ebay_snapshot_date as string | null,
      ebayMarginPercent: row.ebay_margin_percent as number | null,
      ebayMarginAbsolute: row.ebay_margin_absolute as number | null,
      // Calculate COG% from margin%: COG% = 100 - margin%
      ebayCogPercent: row.ebay_margin_percent != null
        ? 100 - (row.ebay_margin_percent as number)
        : null,
      // Seeded ASIN fields
      itemType: (row.item_type as ArbitrageItem['itemType']) ?? 'inventory',
      seededAsinId: row.seeded_asin_id as string | null,
      bricksetSetId: row.brickset_set_id as string | null,
      bricksetRrp: row.brickset_rrp as number | null,
      bricksetYear: row.brickset_year as number | null,
      bricksetTheme: row.brickset_theme as string | null,
      bricksetPieces: row.brickset_pieces as number | null,
      seededMatchMethod: row.seeded_match_method as ArbitrageItem['seededMatchMethod'],
      seededMatchConfidence: row.seeded_match_confidence as number | null,
    };
  }

  /**
   * Transform database row to ArbitrageSyncStatus
   */
  private transformToSyncStatus(row: Record<string, unknown>): ArbitrageSyncStatus {
    return {
      id: row.id as string,
      userId: row.user_id as string,
      jobType: row.job_type as SyncJobType,
      status: row.status as ArbitrageSyncStatus['status'],
      lastRunAt: row.last_run_at as string | null,
      lastSuccessAt: row.last_success_at as string | null,
      nextScheduledAt: row.next_scheduled_at as string | null,
      lastRunDurationMs: row.last_run_duration_ms as number | null,
      itemsProcessed: (row.items_processed as number) ?? 0,
      itemsFailed: (row.items_failed as number) ?? 0,
      errorMessage: row.error_message as string | null,
      errorDetails: row.error_details,
      createdAt: row.created_at as string,
      updatedAt: row.updated_at as string,
    };
  }
}
