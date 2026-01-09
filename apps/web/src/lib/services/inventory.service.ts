import type { SupabaseClient } from '@supabase/supabase-js';
import type {
  Database,
  InventoryItemInsert,
  InventoryItemUpdate,
  InventoryStatus,
} from '@hadley-bricks/database';
import {
  InventoryRepository,
  InventoryFilters,
  PaginationOptions,
  PaginatedResult,
} from '../repositories';
import type { InventoryItem } from '@hadley-bricks/database';

/**
 * Service for inventory business logic.
 * Wraps the repository and adds business rules.
 */
export class InventoryService {
  private repository: InventoryRepository;
  private userId: string;

  constructor(supabase: SupabaseClient<Database>, userId: string) {
    this.repository = new InventoryRepository(supabase);
    this.userId = userId;
  }

  /**
   * Get a single inventory item by ID
   */
  async getById(id: string): Promise<InventoryItem | null> {
    return this.repository.findById(id);
  }

  /**
   * Get all inventory items with optional filters and pagination
   */
  async getAll(
    filters?: InventoryFilters,
    pagination?: PaginationOptions
  ): Promise<PaginatedResult<InventoryItem>> {
    return this.repository.findAllFiltered(filters, pagination);
  }

  /**
   * Create a new inventory item
   */
  async create(input: Omit<InventoryItemInsert, 'user_id'>): Promise<InventoryItem> {
    // Generate SKU if not provided
    const itemWithUser: InventoryItemInsert = {
      ...input,
      user_id: this.userId,
      sku: input.sku || this.generateSku(input.condition || 'New', input.set_number),
    };

    return this.repository.create(itemWithUser);
  }

  /**
   * Create multiple inventory items
   */
  async createMany(items: Omit<InventoryItemInsert, 'user_id'>[]): Promise<InventoryItem[]> {
    const itemsWithUser: InventoryItemInsert[] = items.map((item, index) => ({
      ...item,
      user_id: this.userId,
      sku: item.sku || this.generateSku(item.condition || 'New', item.set_number, index),
    }));

    return this.repository.createMany(itemsWithUser);
  }

  /**
   * Update an inventory item
   */
  async update(id: string, input: InventoryItemUpdate): Promise<InventoryItem> {
    return this.repository.update(id, input);
  }

  /**
   * Delete an inventory item
   */
  async delete(id: string): Promise<void> {
    return this.repository.delete(id);
  }

  /**
   * Delete multiple inventory items
   */
  async deleteBulk(ids: string[]): Promise<{ count: number }> {
    return this.repository.deleteBulk(ids);
  }

  /**
   * Update status for a single item
   */
  async updateStatus(id: string, status: InventoryStatus): Promise<InventoryItem> {
    return this.repository.update(id, { status });
  }

  /**
   * Update status for multiple items
   */
  async updateStatusBulk(ids: string[], status: InventoryStatus): Promise<void> {
    return this.repository.updateStatusBulk(ids, status);
  }

  /**
   * Bulk update multiple items with the same data
   */
  async updateBulk(ids: string[], input: InventoryItemUpdate): Promise<InventoryItem[]> {
    return this.repository.updateBulk(ids, input);
  }

  /**
   * Get items by status
   */
  async getByStatus(
    status: InventoryStatus | InventoryStatus[],
    pagination?: PaginationOptions
  ): Promise<PaginatedResult<InventoryItem>> {
    return this.repository.findByStatus(status, pagination);
  }

  /**
   * Get items in backlog (ready to list)
   */
  async getBacklog(pagination?: PaginationOptions): Promise<PaginatedResult<InventoryItem>> {
    return this.repository.findByStatus('BACKLOG', pagination);
  }

  /**
   * Get inventory summary statistics
   */
  async getSummary(options?: { excludeSold?: boolean; platform?: string }): Promise<{
    totalItems: number;
    byStatus: Record<string, number>;
    totalCost: number;
    totalListingValue: number;
    valueByStatus: Record<string, { cost: number; listingValue: number; count: number }>;
  }> {
    const excludeStatuses: InventoryStatus[] = options?.excludeSold ? ['SOLD'] : [];
    const platform = options?.platform;

    const [countByStatus, values, valueByStatus] = await Promise.all([
      this.repository.getCountByStatus({ platform }),
      this.repository.getTotalValue({ excludeStatuses, platform }),
      this.repository.getValueByStatus({ platform }),
    ]);

    // Calculate total items (optionally excluding sold)
    let totalItems = 0;
    for (const [status, count] of Object.entries(countByStatus)) {
      if (!excludeStatuses.includes(status as InventoryStatus)) {
        totalItems += count;
      }
    }

    return {
      totalItems,
      byStatus: countByStatus,
      totalCost: values.cost,
      totalListingValue: values.listingValue,
      valueByStatus,
    };
  }

  /**
   * Get distinct listing platforms
   */
  async getDistinctPlatforms(): Promise<string[]> {
    return this.repository.getDistinctPlatforms();
  }

  /**
   * Find item by SKU
   */
  async findBySku(sku: string): Promise<InventoryItem | null> {
    return this.repository.findBySku(sku);
  }

  /**
   * Find item by Amazon ASIN
   */
  async findByAsin(asin: string): Promise<InventoryItem | null> {
    return this.repository.findByAsin(asin);
  }

  /**
   * Get items in a linked lot
   */
  async getLinkedLotItems(linkedLot: string): Promise<InventoryItem[]> {
    return this.repository.findByLinkedLot(linkedLot);
  }

  /**
   * Generate a SKU for an inventory item
   */
  private generateSku(condition: string, setNumber: string, index?: number): string {
    const prefix = condition === 'New' ? 'HB-NEW' : 'HB-USED';
    const timestamp = Date.now().toString(36).toUpperCase();
    const suffix = index !== undefined ? `-${String(index + 1).padStart(3, '0')}` : '';
    return `${prefix}-${setNumber}-${timestamp}${suffix}`;
  }
}
