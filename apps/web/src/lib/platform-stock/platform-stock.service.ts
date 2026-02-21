/**
 * Platform Stock Service
 *
 * Abstract base class for platform-specific stock services.
 * Provides common functionality for listing management and comparison.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@hadley-bricks/database';
import type {
  StockPlatform,
  PlatformListing,
  ListingImport,
  StockComparison,
  ComparisonSummary,
  ComparisonFilters,
  ListingFilters,
  PaginatedResponse,
  ListingStatus,
} from './types';

// Use Supabase generated types for database operations
type PlatformListingInsert = Database['public']['Tables']['platform_listings']['Insert'];
type PlatformListingImportInsert =
  Database['public']['Tables']['platform_listing_imports']['Insert'];
type PlatformListingImportUpdate =
  Database['public']['Tables']['platform_listing_imports']['Update'];
type PlatformListingImportRow = Database['public']['Tables']['platform_listing_imports']['Row'];
type PlatformListingRow = Database['public']['Tables']['platform_listings']['Row'];

// ============================================================================
// ABSTRACT BASE CLASS
// ============================================================================

/**
 * Abstract base class for platform stock services
 *
 * Each platform (Amazon, eBay, BrickLink) extends this class
 * and implements platform-specific import and comparison logic.
 */
export abstract class PlatformStockService {
  protected supabase: SupabaseClient<Database>;
  protected userId: string;

  /** Platform identifier - must be implemented by subclasses */
  abstract readonly platform: StockPlatform;

  constructor(supabase: SupabaseClient<Database>, userId: string) {
    this.supabase = supabase;
    this.userId = userId;
  }

  // ==========================================================================
  // ABSTRACT METHODS (Must be implemented by subclasses)
  // ==========================================================================

  /**
   * Trigger a new import from the platform
   * Each platform has its own import mechanism (API, CSV, etc.)
   */
  abstract triggerImport(): Promise<ListingImport>;

  /**
   * Get stock comparison between platform and inventory
   * Each platform may have different matching logic
   */
  abstract getStockComparison(filters: ComparisonFilters): Promise<{
    comparisons: StockComparison[];
    summary: ComparisonSummary;
  }>;

  // ==========================================================================
  // COMMON METHODS
  // ==========================================================================

  /**
   * Get the latest import for this platform
   */
  async getLatestImport(): Promise<ListingImport | null> {
    const { data, error } = await this.supabase
      .from('platform_listing_imports')
      .select('*')
      .eq('user_id', this.userId)
      .eq('platform', this.platform)
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    if (error) {
      if (error.code === 'PGRST116') {
        return null; // No import found
      }
      console.error('[PlatformStockService] Error fetching latest import:', error);
      return null;
    }

    return this.mapImportRow(data);
  }

  /**
   * Get import status by ID
   */
  async getImportStatus(importId: string): Promise<ListingImport | null> {
    const { data, error } = await this.supabase
      .from('platform_listing_imports')
      .select('*')
      .eq('id', importId)
      .eq('user_id', this.userId)
      .single();

    if (error) {
      if (error.code === 'PGRST116') {
        return null;
      }
      throw new Error(`Failed to get import status: ${error.message}`);
    }

    return this.mapImportRow(data);
  }

  /**
   * Get listings with pagination and filtering
   */
  async getListings(
    filters: ListingFilters,
    page: number = 1,
    pageSize: number = 50
  ): Promise<PaginatedResponse<PlatformListing>> {
    // Build query
    let query = this.supabase
      .from('platform_listings')
      .select('*', { count: 'exact' })
      .eq('user_id', this.userId)
      .eq('platform', this.platform);

    // Apply filters
    if (filters.listingStatus && filters.listingStatus !== 'all') {
      query = query.eq('listing_status', filters.listingStatus);
    }

    if (filters.fulfillmentChannel && filters.fulfillmentChannel !== 'all') {
      query = query.eq('fulfillment_channel', filters.fulfillmentChannel);
    }

    if (filters.hasQuantity) {
      query = query.gt('quantity', 0);
    }

    if (filters.search) {
      // Search in title, SKU, and item ID
      query = query.or(
        `title.ilike.%${filters.search}%,platform_sku.ilike.%${filters.search}%,platform_item_id.ilike.%${filters.search}%`
      );
    }

    // Apply sorting
    if (filters.sort) {
      const columnMap: Record<string, string> = {
        sku: 'platform_sku',
        itemId: 'platform_item_id',
        title: 'title',
        quantity: 'quantity',
        price: 'price',
        status: 'listing_status',
        condition: 'listing_status', // Fallback - condition sorting done client-side for eBay
      };
      const dbColumn = columnMap[filters.sort.column] || 'title';
      query = query.order(dbColumn, {
        ascending: filters.sort.direction === 'asc',
        nullsFirst: false,
      });
    } else {
      // Default sort by title
      query = query.order('title', { ascending: true });
    }

    // Apply pagination
    const from = (page - 1) * pageSize;
    const to = from + pageSize - 1;
    query = query.range(from, to);

    const { data, error, count } = await query;

    if (error) {
      throw new Error(`Failed to fetch listings: ${error.message}`);
    }

    const listings = (data || []).map((row) => this.mapListingRow(row as PlatformListingRow));

    return {
      items: listings,
      pagination: {
        page,
        pageSize,
        total: count || 0,
        totalPages: Math.ceil((count || 0) / pageSize),
      },
    };
  }

  /**
   * Get all listings without pagination (for comparison)
   * Uses pagination internally to handle Supabase's 1000 row limit
   */
  protected async getAllListings(): Promise<PlatformListing[]> {
    const allListings: PlatformListing[] = [];
    const pageSize = 1000;
    let page = 0;
    let hasMore = true;

    while (hasMore) {
      const { data, error } = await this.supabase
        .from('platform_listings')
        .select('*')
        .eq('user_id', this.userId)
        .eq('platform', this.platform)
        .range(page * pageSize, (page + 1) * pageSize - 1);

      if (error) {
        throw new Error(`Failed to fetch listings: ${error.message}`);
      }

      const listings = (data || []).map((row) => this.mapListingRow(row as PlatformListingRow));
      allListings.push(...listings);

      hasMore = (data?.length ?? 0) === pageSize;
      page++;
    }

    return allListings;
  }

  /**
   * Get import history
   */
  async getImportHistory(limit: number = 10): Promise<ListingImport[]> {
    const { data, error } = await this.supabase
      .from('platform_listing_imports')
      .select('*')
      .eq('user_id', this.userId)
      .eq('platform', this.platform)
      .order('created_at', { ascending: false })
      .limit(limit);

    if (error) {
      throw new Error(`Failed to fetch import history: ${error.message}`);
    }

    return (data || []).map((row) => this.mapImportRow(row));
  }

  /**
   * Delete old listings before a new import
   */
  protected async deleteOldListings(): Promise<void> {
    const { error } = await this.supabase
      .from('platform_listings')
      .delete()
      .eq('user_id', this.userId)
      .eq('platform', this.platform);

    if (error) {
      throw new Error(`Failed to delete old listings: ${error.message}`);
    }
  }

  /**
   * Create an import record
   */
  protected async createImportRecord(
    additionalData?: Partial<PlatformListingImportInsert>
  ): Promise<string> {
    const insertData: PlatformListingImportInsert = {
      user_id: this.userId,
      platform: this.platform,
      import_type: 'full',
      status: 'processing',
      started_at: new Date().toISOString(),
      ...additionalData,
    };

    const { data, error } = await this.supabase
      .from('platform_listing_imports')
      .insert(insertData)
      .select('id')
      .single();

    if (error) {
      throw new Error(`Failed to create import record: ${error.message}`);
    }

    return data.id;
  }

  /**
   * Update import record status
   */
  protected async updateImportRecord(
    importId: string,
    update: PlatformListingImportUpdate
  ): Promise<void> {
    const { error } = await this.supabase
      .from('platform_listing_imports')
      .update(update)
      .eq('id', importId);

    if (error) {
      throw new Error(`Failed to update import record: ${error.message}`);
    }
  }

  /**
   * Insert listings in batches
   */
  protected async insertListingsBatch(
    importId: string,
    listings: PlatformListingInsert[]
  ): Promise<number> {
    const batchSize = 100;
    let inserted = 0;

    for (let i = 0; i < listings.length; i += batchSize) {
      const batch = listings.slice(i, i + batchSize);

      const { error } = await this.supabase.from('platform_listings').insert(batch);

      if (error) {
        console.error(`[PlatformStockService] Error inserting batch ${i / batchSize + 1}:`, error);
        continue;
      }

      inserted += batch.length;

      // Update progress
      await this.updateImportRecord(importId, {
        processed_rows: inserted,
      });
    }

    return inserted;
  }

  // ==========================================================================
  // MAPPING HELPERS
  // ==========================================================================

  /**
   * Map database row to import object
   */
  protected mapImportRow(row: PlatformListingImportRow): ListingImport {
    return {
      id: row.id,
      userId: row.user_id,
      platform: row.platform as StockPlatform,
      importType: row.import_type as 'full' | 'incremental',
      status: row.status as 'pending' | 'processing' | 'completed' | 'failed',
      totalRows: row.total_rows,
      processedRows: row.processed_rows,
      errorCount: row.error_count,
      amazonReportId: row.amazon_report_id,
      amazonReportDocumentId: row.amazon_report_document_id,
      amazonReportType: row.amazon_report_type,
      startedAt: row.started_at,
      completedAt: row.completed_at,
      errorMessage: row.error_message,
      errorDetails: row.error_details,
      createdAt: row.created_at,
    };
  }

  /**
   * Map database row to listing object
   */
  protected mapListingRow(row: PlatformListingRow): PlatformListing {
    return {
      id: row.id,
      userId: row.user_id,
      platform: row.platform as StockPlatform,
      platformSku: row.platform_sku,
      platformItemId: row.platform_item_id,
      title: row.title,
      quantity: row.quantity ?? 0,
      price: row.price ? Number(row.price) : null,
      currency: row.currency,
      listingStatus: (row.listing_status as ListingStatus) || 'Unknown',
      fulfillmentChannel: row.fulfillment_channel,
      importId: row.import_id,
      rawData: row.raw_data,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }
}
