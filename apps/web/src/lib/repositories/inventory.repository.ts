import type { SupabaseClient } from '@supabase/supabase-js';
import type {
  Database,
  InventoryItem,
  InventoryItemInsert,
  InventoryItemUpdate,
  InventoryStatus,
  ItemCondition,
} from '@hadley-bricks/database';
import { BaseRepository, PaginationOptions, PaginatedResult } from './base.repository';
import { getDualWriteService, isDualWriteEnabled } from '@/lib/migration';
import { createPerfLogger } from '@/lib/perf';

/**
 * Numeric range filter
 */
export interface NumericRangeFilter {
  min?: number;
  max?: number;
}

/**
 * Date range filter
 */
export interface DateRangeFilter {
  from?: string;
  to?: string;
}

/**
 * Empty/non-empty filter
 */
export type EmptyFilter = 'empty' | 'not_empty';

/**
 * Filter options for inventory queries
 */
export interface InventoryFilters {
  status?: InventoryStatus | InventoryStatus[];
  condition?: ItemCondition;
  platform?: string; // listing_platform
  salePlatform?: string; // sold_platform
  source?: string; // purchase source
  linkedLot?: string;
  purchaseId?: string;
  searchTerm?: string;
  excludeLinkedToOrders?: boolean;
  // Advanced numeric range filters
  costRange?: NumericRangeFilter;
  listingValueRange?: NumericRangeFilter;
  soldGrossRange?: NumericRangeFilter;
  soldNetRange?: NumericRangeFilter;
  profitRange?: NumericRangeFilter;
  soldFeesRange?: NumericRangeFilter;
  soldPostageRange?: NumericRangeFilter;
  // Date range filters
  purchaseDateRange?: DateRangeFilter;
  listingDateRange?: DateRangeFilter;
  soldDateRange?: DateRangeFilter;
  // Empty/non-empty filters
  storageLocationFilter?: EmptyFilter;
  amazonAsinFilter?: EmptyFilter;
  linkedLotEmptyFilter?: EmptyFilter;
  linkedOrderFilter?: EmptyFilter; // sold_order_id
  notesFilter?: EmptyFilter;
  skuFilter?: EmptyFilter;
  ebayListingFilter?: EmptyFilter; // ebay_listing_id
  archiveLocationFilter?: EmptyFilter;
}

/**
 * Repository for inventory item operations
 */
export class InventoryRepository extends BaseRepository<
  InventoryItem,
  InventoryItemInsert,
  InventoryItemUpdate
> {
  constructor(supabase: SupabaseClient<Database>) {
    super(supabase, 'inventory_items');
  }

  /**
   * Find all inventory items with optional filters and pagination
   */
  async findAllFiltered(
    filters?: InventoryFilters,
    pagination?: PaginationOptions
  ): Promise<PaginatedResult<InventoryItem>> {
    const page = pagination?.page ?? 1;
    const pageSize = pagination?.pageSize ?? 50;
    const from = (page - 1) * pageSize;
    const to = from + pageSize - 1;

    // If excluding items linked to orders, get the linked IDs first
    let linkedInventoryIds: string[] = [];
    if (filters?.excludeLinkedToOrders) {
      const { data: linkedItems } = await this.supabase
        .from('order_items')
        .select('inventory_item_id')
        .not('inventory_item_id', 'is', null);

      linkedInventoryIds = (linkedItems || [])
        .map((item) => item.inventory_item_id)
        .filter((id): id is string => id !== null);
    }

    // Build the query
    let query = this.supabase.from(this.tableName).select('*', { count: 'exact' });

    // Apply filters
    if (filters?.status) {
      if (Array.isArray(filters.status)) {
        query = query.in('status', filters.status);
      } else {
        query = query.eq('status', filters.status);
      }
    }

    if (filters?.condition) {
      query = query.eq('condition', filters.condition);
    }

    if (filters?.platform) {
      query = query.eq('listing_platform', filters.platform);
    }

    if (filters?.salePlatform) {
      query = query.ilike('sold_platform', filters.salePlatform);
    }

    if (filters?.source) {
      query = query.ilike('source', filters.source);
    }

    if (filters?.linkedLot) {
      query = query.eq('linked_lot', filters.linkedLot);
    }

    if (filters?.purchaseId) {
      query = query.eq('purchase_id', filters.purchaseId);
    }

    if (filters?.searchTerm) {
      query = query.or(
        `set_number.ilike.%${filters.searchTerm}%,item_name.ilike.%${filters.searchTerm}%,sku.ilike.%${filters.searchTerm}%`
      );
    }

    // Exclude inventory items already linked to orders
    if (filters?.excludeLinkedToOrders && linkedInventoryIds.length > 0) {
      // Supabase doesn't support NOT IN directly, so we use .not().in()
      // However, this has a limit on array size. For large arrays, we'll need a different approach.
      // For now, this should work for reasonable data sizes.
      query = query.not('id', 'in', `(${linkedInventoryIds.join(',')})`);
    }

    // Numeric range filters
    if (filters?.costRange?.min !== undefined) {
      query = query.gte('cost', filters.costRange.min);
    }
    if (filters?.costRange?.max !== undefined) {
      query = query.lte('cost', filters.costRange.max);
    }
    if (filters?.listingValueRange?.min !== undefined) {
      query = query.gte('listing_value', filters.listingValueRange.min);
    }
    if (filters?.listingValueRange?.max !== undefined) {
      query = query.lte('listing_value', filters.listingValueRange.max);
    }
    if (filters?.soldGrossRange?.min !== undefined) {
      query = query.gte('sold_gross_amount', filters.soldGrossRange.min);
    }
    if (filters?.soldGrossRange?.max !== undefined) {
      query = query.lte('sold_gross_amount', filters.soldGrossRange.max);
    }
    if (filters?.soldNetRange?.min !== undefined) {
      query = query.gte('sold_net_amount', filters.soldNetRange.min);
    }
    if (filters?.soldNetRange?.max !== undefined) {
      query = query.lte('sold_net_amount', filters.soldNetRange.max);
    }
    if (filters?.soldFeesRange?.min !== undefined) {
      query = query.gte('sold_fees_amount', filters.soldFeesRange.min);
    }
    if (filters?.soldFeesRange?.max !== undefined) {
      query = query.lte('sold_fees_amount', filters.soldFeesRange.max);
    }
    if (filters?.soldPostageRange?.min !== undefined) {
      query = query.gte('sold_postage_received', filters.soldPostageRange.min);
    }
    if (filters?.soldPostageRange?.max !== undefined) {
      query = query.lte('sold_postage_received', filters.soldPostageRange.max);
    }
    // Note: profit filtering requires post-processing as it's a computed field (sold_net_amount - cost)
    // We'll handle this separately if needed, or filter on the client side for now

    // Date range filters
    if (filters?.purchaseDateRange?.from) {
      query = query.gte('purchase_date', filters.purchaseDateRange.from);
    }
    if (filters?.purchaseDateRange?.to) {
      query = query.lte('purchase_date', filters.purchaseDateRange.to);
    }
    if (filters?.listingDateRange?.from) {
      query = query.gte('listing_date', filters.listingDateRange.from);
    }
    if (filters?.listingDateRange?.to) {
      query = query.lte('listing_date', filters.listingDateRange.to);
    }
    if (filters?.soldDateRange?.from) {
      query = query.gte('sold_date', filters.soldDateRange.from);
    }
    if (filters?.soldDateRange?.to) {
      query = query.lte('sold_date', filters.soldDateRange.to);
    }

    // Empty/non-empty filters
    if (filters?.storageLocationFilter === 'empty') {
      query = query.is('storage_location', null);
    } else if (filters?.storageLocationFilter === 'not_empty') {
      query = query.not('storage_location', 'is', null);
    }
    if (filters?.amazonAsinFilter === 'empty') {
      query = query.is('amazon_asin', null);
    } else if (filters?.amazonAsinFilter === 'not_empty') {
      query = query.not('amazon_asin', 'is', null);
    }
    if (filters?.linkedLotEmptyFilter === 'empty') {
      query = query.is('linked_lot', null);
    } else if (filters?.linkedLotEmptyFilter === 'not_empty') {
      query = query.not('linked_lot', 'is', null);
    }
    if (filters?.notesFilter === 'empty') {
      query = query.is('notes', null);
    } else if (filters?.notesFilter === 'not_empty') {
      query = query.not('notes', 'is', null);
    }
    if (filters?.skuFilter === 'empty') {
      query = query.is('sku', null);
    } else if (filters?.skuFilter === 'not_empty') {
      query = query.not('sku', 'is', null);
    }
    if (filters?.linkedOrderFilter === 'empty') {
      query = query.is('sold_order_id', null);
    } else if (filters?.linkedOrderFilter === 'not_empty') {
      query = query.not('sold_order_id', 'is', null);
    }
    if (filters?.ebayListingFilter === 'empty') {
      query = query.is('ebay_listing_id', null);
    } else if (filters?.ebayListingFilter === 'not_empty') {
      query = query.not('ebay_listing_id', 'is', null);
    }
    if (filters?.archiveLocationFilter === 'empty') {
      query = query.is('archive_location', null);
    } else if (filters?.archiveLocationFilter === 'not_empty') {
      query = query.not('archive_location', 'is', null);
    }

    // Apply pagination
    query = query.range(from, to).order('created_at', { ascending: false });

    const { data, count, error } = await query;

    if (error) {
      throw new Error(`Failed to find inventory items: ${error.message}`);
    }

    const total = count ?? 0;

    return {
      data: (data ?? []) as InventoryItem[],
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
    };
  }

  /**
   * Find inventory items by status
   */
  async findByStatus(
    status: InventoryStatus | InventoryStatus[],
    pagination?: PaginationOptions
  ): Promise<PaginatedResult<InventoryItem>> {
    return this.findAllFiltered({ status }, pagination);
  }

  /**
   * Find inventory items by condition (New/Used)
   */
  async findByCondition(
    condition: ItemCondition,
    pagination?: PaginationOptions
  ): Promise<PaginatedResult<InventoryItem>> {
    return this.findAllFiltered({ condition }, pagination);
  }

  /**
   * Find inventory items by linked lot
   */
  async findByLinkedLot(linkedLot: string): Promise<InventoryItem[]> {
    const { data, error } = await this.supabase
      .from(this.tableName)
      .select('*')
      .eq('linked_lot', linkedLot)
      .order('created_at', { ascending: false });

    if (error) {
      throw new Error(`Failed to find inventory by linked lot: ${error.message}`);
    }

    return (data ?? []) as InventoryItem[];
  }

  /**
   * Find inventory item by SKU
   */
  async findBySku(sku: string): Promise<InventoryItem | null> {
    const { data, error } = await this.supabase
      .from(this.tableName)
      .select('*')
      .eq('sku', sku)
      .single();

    if (error) {
      if (error.code === 'PGRST116') {
        return null;
      }
      throw new Error(`Failed to find inventory by SKU: ${error.message}`);
    }

    return data as InventoryItem;
  }

  /**
   * Find inventory item by Amazon ASIN
   */
  async findByAsin(asin: string): Promise<InventoryItem | null> {
    const { data, error } = await this.supabase
      .from(this.tableName)
      .select('*')
      .eq('amazon_asin', asin)
      .single();

    if (error) {
      if (error.code === 'PGRST116') {
        return null;
      }
      throw new Error(`Failed to find inventory by ASIN: ${error.message}`);
    }

    return data as InventoryItem;
  }

  /**
   * Create a single inventory item (with dual-write to Google Sheets)
   */
  async create(data: InventoryItemInsert): Promise<InventoryItem> {
    // First, create in Supabase (primary)
    const result = await super.create(data);

    // Then, dual-write to Google Sheets (fire-and-forget)
    if (isDualWriteEnabled()) {
      getDualWriteService()
        .writeInventoryToSheets(
          {
            sku: result.sku || '',
            set_number: result.set_number,
            item_name: result.item_name,
            condition: result.condition as 'New' | 'Used' | null | undefined,
            status: result.status,
            source: result.source,
            purchase_date: result.purchase_date,
            cost: result.cost,
            listing_date: result.listing_date,
            listing_value: result.listing_value,
            storage_location: result.storage_location,
            linked_lot: result.linked_lot,
            amazon_asin: result.amazon_asin,
            listing_platform: result.listing_platform,
            notes: result.notes,
          },
          'create'
        )
        .catch((err) => console.error('[DualWrite] Create failed:', err));
    }

    return result;
  }

  /**
   * Update an inventory item (with dual-write to Google Sheets)
   */
  async update(id: string, data: InventoryItemUpdate): Promise<InventoryItem> {
    // First, update in Supabase (primary)
    const result = await super.update(id, data);

    // Then, dual-write to Google Sheets (fire-and-forget)
    if (isDualWriteEnabled()) {
      getDualWriteService()
        .writeInventoryToSheets(
          {
            sku: result.sku || '',
            set_number: result.set_number,
            item_name: result.item_name,
            condition: result.condition as 'New' | 'Used' | null | undefined,
            status: result.status,
            source: result.source,
            purchase_date: result.purchase_date,
            cost: result.cost,
            listing_date: result.listing_date,
            listing_value: result.listing_value,
            storage_location: result.storage_location,
            linked_lot: result.linked_lot,
            amazon_asin: result.amazon_asin,
            listing_platform: result.listing_platform,
            notes: result.notes,
          },
          'update'
        )
        .catch((err) => console.error('[DualWrite] Update failed:', err));
    }

    return result;
  }

  /**
   * Bulk create inventory items
   */
  async createMany(items: InventoryItemInsert[]): Promise<InventoryItem[]> {
    const { data, error } = await this.supabase.from(this.tableName).insert(items).select();

    if (error) {
      throw new Error(`Failed to create inventory items: ${error.message}`);
    }

    const results = (data ?? []) as InventoryItem[];

    // Dual-write items to Google Sheets in parallel batches (fire-and-forget)
    if (isDualWriteEnabled()) {
      const dualWriteService = getDualWriteService();
      const BATCH_SIZE = 5; // Process 5 items concurrently to avoid rate limits

      // Process in background without blocking
      (async () => {
        for (let i = 0; i < results.length; i += BATCH_SIZE) {
          const batch = results.slice(i, i + BATCH_SIZE);
          await Promise.all(
            batch.map((item) =>
              dualWriteService
                .writeInventoryToSheets(
                  {
                    sku: item.sku || '',
                    set_number: item.set_number,
                    item_name: item.item_name,
                    condition: item.condition as 'New' | 'Used' | null | undefined,
                    status: item.status,
                    source: item.source,
                    purchase_date: item.purchase_date,
                    cost: item.cost,
                    listing_date: item.listing_date,
                    listing_value: item.listing_value,
                    storage_location: item.storage_location,
                    linked_lot: item.linked_lot,
                    amazon_asin: item.amazon_asin,
                    listing_platform: item.listing_platform,
                    notes: item.notes,
                  },
                  'create'
                )
                .catch((err) => console.error('[DualWrite] CreateMany batch item failed:', err))
            )
          );
        }
      })().catch((err) => console.error('[DualWrite] CreateMany batch processing failed:', err));
    }

    return results;
  }

  /**
   * Update status for multiple items
   */
  async updateStatusBulk(ids: string[], status: InventoryStatus): Promise<void> {
    const { error } = await this.supabase.from(this.tableName).update({ status }).in('id', ids);

    if (error) {
      throw new Error(`Failed to update inventory status: ${error.message}`);
    }
  }

  /**
   * Bulk update multiple items with the same data
   */
  async updateBulk(ids: string[], data: InventoryItemUpdate): Promise<InventoryItem[]> {
    const { data: results, error } = await this.supabase
      .from(this.tableName)
      .update(data)
      .in('id', ids)
      .select();

    if (error) {
      throw new Error(`Failed to bulk update inventory items: ${error.message}`);
    }

    const items = (results ?? []) as InventoryItem[];

    // Dual-write updated items to Google Sheets in parallel batches (fire-and-forget)
    if (isDualWriteEnabled()) {
      const dualWriteService = getDualWriteService();
      const BATCH_SIZE = 5; // Process 5 items concurrently to avoid rate limits

      // Process in background without blocking
      (async () => {
        for (let i = 0; i < items.length; i += BATCH_SIZE) {
          const batch = items.slice(i, i + BATCH_SIZE);
          await Promise.all(
            batch.map((item) =>
              dualWriteService
                .writeInventoryToSheets(
                  {
                    sku: item.sku || '',
                    set_number: item.set_number,
                    item_name: item.item_name,
                    condition: item.condition as 'New' | 'Used' | null | undefined,
                    status: item.status,
                    source: item.source,
                    purchase_date: item.purchase_date,
                    cost: item.cost,
                    listing_date: item.listing_date,
                    listing_value: item.listing_value,
                    storage_location: item.storage_location,
                    linked_lot: item.linked_lot,
                    amazon_asin: item.amazon_asin,
                    listing_platform: item.listing_platform,
                    notes: item.notes,
                  },
                  'update'
                )
                .catch((err) => console.error('[DualWrite] BulkUpdate batch item failed:', err))
            )
          );
        }
      })().catch((err) => console.error('[DualWrite] BulkUpdate batch processing failed:', err));
    }

    return items;
  }

  /**
   * Bulk delete multiple inventory items
   */
  async deleteBulk(ids: string[]): Promise<{ count: number }> {
    const { error, count } = await this.supabase.from(this.tableName).delete().in('id', ids);

    if (error) {
      throw new Error(`Failed to bulk delete inventory items: ${error.message}`);
    }

    return { count: count || 0 };
  }

  /**
   * Get inventory count by status
   * Uses pagination to handle >1000 records
   */
  async getCountByStatus(options?: { platform?: string }): Promise<Record<string, number>> {
    const perf = createPerfLogger('InventoryRepo.getCountByStatus');

    const pageSize = 1000;
    let page = 0;
    let hasMore = true;
    const counts: Record<string, number> = {};
    let totalRows = 0;

    while (hasMore) {
      const endPage = perf.start(`page ${page + 1}`);
      let query = this.supabase
        .from(this.tableName)
        .select('status')
        .range(page * pageSize, (page + 1) * pageSize - 1);

      if (options?.platform) {
        query = query.eq('listing_platform', options.platform);
      }

      const { data, error } = await query;
      endPage();

      if (error) {
        throw new Error(`Failed to get inventory count by status: ${error.message}`);
      }

      const items = data ?? [];
      totalRows += items.length;
      items.forEach((item) => {
        const status = item.status || 'unknown';
        counts[status] = (counts[status] || 0) + 1;
      });

      hasMore = items.length === pageSize;
      page++;
    }

    perf.log('complete', { pages: page, rows: totalRows });
    perf.end();
    return counts;
  }

  /**
   * Get total inventory value
   * Uses pagination to handle >1000 records
   * Optionally exclude certain statuses (e.g., 'SOLD')
   */
  async getTotalValue(options?: {
    excludeStatuses?: InventoryStatus[];
    platform?: string;
  }): Promise<{ cost: number; listingValue: number }> {
    const perf = createPerfLogger('InventoryRepo.getTotalValue');

    const pageSize = 1000;
    let page = 0;
    let hasMore = true;
    let cost = 0;
    let listingValue = 0;
    let totalRows = 0;

    while (hasMore) {
      const endPage = perf.start(`page ${page + 1}`);
      let query = this.supabase
        .from(this.tableName)
        .select('cost, listing_value, status')
        .range(page * pageSize, (page + 1) * pageSize - 1);

      if (options?.platform) {
        query = query.eq('listing_platform', options.platform);
      }

      const { data, error } = await query;
      endPage();

      if (error) {
        throw new Error(`Failed to get inventory value: ${error.message}`);
      }

      const items = data ?? [];
      totalRows += items.length;
      items.forEach((item) => {
        // Skip excluded statuses
        if (options?.excludeStatuses?.includes(item.status as InventoryStatus)) {
          return;
        }
        cost += item.cost ?? 0;
        listingValue += item.listing_value ?? 0;
      });

      hasMore = items.length === pageSize;
      page++;
    }

    perf.log('complete', { pages: page, rows: totalRows });
    perf.end();
    return { cost, listingValue };
  }

  /**
   * Get inventory value breakdown by status
   * Uses pagination to handle >1000 records
   */
  async getValueByStatus(options?: {
    platform?: string;
  }): Promise<Record<string, { cost: number; listingValue: number; count: number }>> {
    const perf = createPerfLogger('InventoryRepo.getValueByStatus');

    const pageSize = 1000;
    let page = 0;
    let hasMore = true;
    const byStatus: Record<string, { cost: number; listingValue: number; count: number }> = {};
    let totalRows = 0;

    while (hasMore) {
      const endPage = perf.start(`page ${page + 1}`);
      let query = this.supabase
        .from(this.tableName)
        .select('cost, listing_value, status')
        .range(page * pageSize, (page + 1) * pageSize - 1);

      if (options?.platform) {
        query = query.eq('listing_platform', options.platform);
      }

      const { data, error } = await query;
      endPage();

      if (error) {
        throw new Error(`Failed to get inventory value by status: ${error.message}`);
      }

      const items = data ?? [];
      totalRows += items.length;
      items.forEach((item) => {
        let status = item.status || 'unknown';

        // Split BACKLOG into valued and unvalued
        if (status === 'BACKLOG') {
          const hasValue = item.listing_value !== null && item.listing_value > 0;
          status = hasValue ? 'BACKLOG_VALUED' : 'BACKLOG_UNVALUED';
        }

        if (!byStatus[status]) {
          byStatus[status] = { cost: 0, listingValue: 0, count: 0 };
        }
        byStatus[status].cost += item.cost ?? 0;
        byStatus[status].listingValue += item.listing_value ?? 0;
        byStatus[status].count += 1;
      });

      hasMore = items.length === pageSize;
      page++;
    }

    perf.log('complete', { pages: page, rows: totalRows });
    perf.end();
    return byStatus;
  }

  /**
   * Get distinct listing platforms
   * Uses pagination to handle >1000 records
   */
  async getDistinctPlatforms(): Promise<string[]> {
    const pageSize = 1000;
    let page = 0;
    let hasMore = true;
    const platforms = new Set<string>();

    while (hasMore) {
      const { data, error } = await this.supabase
        .from(this.tableName)
        .select('listing_platform')
        .not('listing_platform', 'is', null)
        .range(page * pageSize, (page + 1) * pageSize - 1);

      if (error) {
        throw new Error(`Failed to get distinct platforms: ${error.message}`);
      }

      const items = data ?? [];
      items.forEach((item) => {
        if (item.listing_platform) {
          platforms.add(item.listing_platform);
        }
      });

      hasMore = items.length === pageSize;
      page++;
    }

    return Array.from(platforms).sort();
  }
}
