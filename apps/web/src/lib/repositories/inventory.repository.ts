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

/**
 * Filter options for inventory queries
 */
export interface InventoryFilters {
  status?: InventoryStatus | InventoryStatus[];
  condition?: ItemCondition;
  platform?: string;
  linkedLot?: string;
  searchTerm?: string;
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

    if (filters?.linkedLot) {
      query = query.eq('linked_lot', filters.linkedLot);
    }

    if (filters?.searchTerm) {
      query = query.or(
        `set_number.ilike.%${filters.searchTerm}%,item_name.ilike.%${filters.searchTerm}%,sku.ilike.%${filters.searchTerm}%`
      );
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
            condition: result.condition,
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
            condition: result.condition,
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

    // Dual-write each item to Google Sheets (fire-and-forget)
    if (isDualWriteEnabled()) {
      const dualWriteService = getDualWriteService();
      for (const item of results) {
        dualWriteService
          .writeInventoryToSheets(
            {
              sku: item.sku || '',
              set_number: item.set_number,
              item_name: item.item_name,
              condition: item.condition,
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
          .catch((err) => console.error('[DualWrite] CreateMany failed:', err));
      }
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
   * Get inventory count by status
   */
  async getCountByStatus(): Promise<Record<string, number>> {
    const { data, error } = await this.supabase.from(this.tableName).select('status');

    if (error) {
      throw new Error(`Failed to get inventory count by status: ${error.message}`);
    }

    const counts: Record<string, number> = {};
    (data ?? []).forEach((item) => {
      const status = item.status || 'unknown';
      counts[status] = (counts[status] || 0) + 1;
    });

    return counts;
  }

  /**
   * Get total inventory value
   */
  async getTotalValue(): Promise<{ cost: number; listingValue: number }> {
    const { data, error } = await this.supabase.from(this.tableName).select('cost, listing_value');

    if (error) {
      throw new Error(`Failed to get inventory value: ${error.message}`);
    }

    let cost = 0;
    let listingValue = 0;

    (data ?? []).forEach((item) => {
      cost += item.cost ?? 0;
      listingValue += item.listing_value ?? 0;
    });

    return { cost, listingValue };
  }
}
