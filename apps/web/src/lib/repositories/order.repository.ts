import type { SupabaseClient } from '@supabase/supabase-js';
import type {
  Database,
  PlatformOrder,
  PlatformOrderInsert,
  PlatformOrderUpdate,
  OrderItem,
  OrderItemInsert,
} from '@hadley-bricks/database';
import { BaseRepository, PaginationOptions, PaginatedResult } from './base.repository';

export interface OrderFilters {
  platform?: string;
  status?: string;
  startDate?: Date;
  endDate?: Date;
}

export interface OrderWithItems extends PlatformOrder {
  items: OrderItem[];
}

/**
 * Repository for platform orders
 */
export class OrderRepository extends BaseRepository<
  PlatformOrder,
  PlatformOrderInsert,
  PlatformOrderUpdate
> {
  constructor(supabase: SupabaseClient<Database>) {
    super(supabase, 'platform_orders');
  }

  /**
   * Get status patterns for filtering raw status field
   * Matches the normalizeStatus logic in OrderStatusService
   */
  private getStatusPatterns(status: string): string[] {
    switch (status) {
      case 'Completed':
        return ['completed', 'received'];
      case 'Shipped':
        return ['shipped', 'dispatched'];
      case 'Packed':
        return ['packed', 'ready'];
      case 'Paid':
        return ['paid', 'payment'];
      case 'Cancelled':
        return ['cancel', 'npb'];
      case 'Pending':
      default:
        // Pending is the default - no specific patterns (handled separately)
        return [];
    }
  }

  /**
   * Find orders by user with optional filters
   */
  async findByUser(
    userId: string,
    filters?: OrderFilters,
    options?: PaginationOptions
  ): Promise<PaginatedResult<PlatformOrder>> {
    const page = options?.page ?? 1;
    const pageSize = options?.pageSize ?? 50;
    const from = (page - 1) * pageSize;
    const to = from + pageSize - 1;

    // Build query - include order_items for display
    let query = this.supabase
      .from('platform_orders')
      .select('*, order_items(id, item_name, item_number, inventory_item_id)', { count: 'exact' })
      .eq('user_id', userId);

    if (filters?.platform) {
      query = query.eq('platform', filters.platform);
    }

    if (filters?.status) {
      // Filter by internal_status OR by raw status patterns (matching normalizeStatus logic)
      // This matches the counting logic in OrderStatusService.getStatusSummary
      const statusPatterns = this.getStatusPatterns(filters.status);

      if (statusPatterns.length > 0) {
        // Build OR condition: internal_status = X OR (internal_status is null AND status matches patterns)
        const patternConditions = statusPatterns.map((p) => `status.ilike.%${p}%`).join(',');
        query = query.or(
          `internal_status.eq.${filters.status},and(internal_status.is.null,or(${patternConditions}))`
        );
      } else {
        // For Pending: match internal_status=Pending OR (internal_status is null AND status doesn't match other patterns)
        // We need to exclude orders where status contains patterns that would normalize to other statuses
        // All patterns that would NOT be Pending:
        const nonPendingPatterns = [
          'completed',
          'received',
          'shipped',
          'dispatched',
          'packed',
          'ready',
          'paid',
          'payment',
          'cancel',
          'npb',
        ];
        const excludeConditions = nonPendingPatterns.map((p) => `status.not.ilike.%${p}%`).join(',');
        query = query.or(
          `internal_status.eq.Pending,and(internal_status.is.null,${excludeConditions})`
        );
      }
    }

    if (filters?.startDate) {
      query = query.gte('order_date', filters.startDate.toISOString());
    }

    if (filters?.endDate) {
      query = query.lte('order_date', filters.endDate.toISOString());
    }

    const { data, count, error } = await query
      .order('order_date', { ascending: false })
      .range(from, to);

    if (error) {
      throw new Error(`Failed to fetch orders: ${error.message}`);
    }

    const total = count ?? 0;

    return {
      data: (data ?? []) as PlatformOrder[],
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
    };
  }

  /**
   * Find an order by platform and platform order ID
   */
  async findByPlatformOrderId(
    userId: string,
    platform: string,
    platformOrderId: string
  ): Promise<PlatformOrder | null> {
    const { data, error } = await this.supabase
      .from('platform_orders')
      .select('*')
      .eq('user_id', userId)
      .eq('platform', platform)
      .eq('platform_order_id', platformOrderId)
      .single();

    if (error) {
      if (error.code === 'PGRST116') {
        return null;
      }
      throw new Error(`Failed to find order: ${error.message}`);
    }

    return data as PlatformOrder;
  }

  /**
   * Get order with items
   */
  async findByIdWithItems(id: string): Promise<OrderWithItems | null> {
    const [order, items] = await Promise.all([this.findById(id), this.getOrderItems(id)]);

    if (!order) {
      return null;
    }

    return { ...order, items };
  }

  /**
   * Get items for an order
   */
  async getOrderItems(orderId: string): Promise<OrderItem[]> {
    const { data, error } = await this.supabase
      .from('order_items')
      .select('*')
      .eq('order_id', orderId)
      .order('created_at', { ascending: true });

    if (error) {
      throw new Error(`Failed to fetch order items: ${error.message}`);
    }

    return (data ?? []) as OrderItem[];
  }

  /**
   * Upsert an order (insert or update based on platform + platform_order_id)
   */
  async upsert(order: PlatformOrderInsert): Promise<PlatformOrder> {
    const { data, error } = await this.supabase
      .from('platform_orders')
      .upsert(order, {
        onConflict: 'user_id,platform,platform_order_id',
        ignoreDuplicates: false,
      })
      .select()
      .single();

    if (error) {
      throw new Error(`Failed to upsert order: ${error.message}`);
    }

    return data as PlatformOrder;
  }

  /**
   * Upsert multiple orders
   */
  async upsertMany(orders: PlatformOrderInsert[]): Promise<PlatformOrder[]> {
    if (orders.length === 0) {
      return [];
    }

    const { data, error } = await this.supabase
      .from('platform_orders')
      .upsert(orders, {
        onConflict: 'user_id,platform,platform_order_id',
        ignoreDuplicates: false,
      })
      .select();

    if (error) {
      throw new Error(`Failed to upsert orders: ${error.message}`);
    }

    return (data ?? []) as PlatformOrder[];
  }

  /**
   * Insert order items
   */
  async insertOrderItems(items: OrderItemInsert[]): Promise<OrderItem[]> {
    if (items.length === 0) {
      return [];
    }

    const { data, error } = await this.supabase.from('order_items').insert(items).select();

    if (error) {
      throw new Error(`Failed to insert order items: ${error.message}`);
    }

    return (data ?? []) as OrderItem[];
  }

  /**
   * Delete order items for an order
   */
  async deleteOrderItems(orderId: string): Promise<void> {
    const { error } = await this.supabase.from('order_items').delete().eq('order_id', orderId);

    if (error) {
      throw new Error(`Failed to delete order items: ${error.message}`);
    }
  }

  /**
   * Replace order items (delete existing and insert new)
   * Preserves inventory_item_id links by matching on item_number (ASIN for Amazon)
   */
  async replaceOrderItems(orderId: string, items: Omit<OrderItemInsert, 'order_id'>[]): Promise<OrderItem[]> {
    // First, fetch existing order items to preserve inventory_item_id links
    const existingItems = await this.getOrderItems(orderId);

    // Create a map of item_number -> inventory_item_id for items that have links
    // item_number holds the ASIN for Amazon orders
    const inventoryLinksByItemNumber = new Map<string, string>();
    for (const item of existingItems) {
      if (item.inventory_item_id && item.item_number) {
        inventoryLinksByItemNumber.set(item.item_number, item.inventory_item_id);
      }
    }

    // Delete existing items
    await this.deleteOrderItems(orderId);

    // Insert new items, preserving inventory_item_id where item_number matches
    const itemsWithOrderId = items.map((item) => {
      const preservedInventoryItemId = item.item_number
        ? inventoryLinksByItemNumber.get(item.item_number)
        : undefined;

      return {
        ...item,
        order_id: orderId,
        // Preserve the inventory link if we had one for this item
        inventory_item_id: preservedInventoryItemId ?? item.inventory_item_id ?? null,
      };
    });

    return this.insertOrderItems(itemsWithOrderId);
  }

  /**
   * Get order statistics for a user
   * Uses pagination to handle >1000 orders
   */
  async getStats(
    userId: string,
    platform?: string
  ): Promise<{
    totalOrders: number;
    totalRevenue: number;
    ordersByStatus: Record<string, number>;
  }> {
    const pageSize = 1000;
    let page = 0;
    let hasMore = true;
    const ordersByStatus: Record<string, number> = {};
    let totalRevenue = 0;
    let totalOrders = 0;

    while (hasMore) {
      let query = this.supabase
        .from('platform_orders')
        .select('status, total')
        .eq('user_id', userId)
        .range(page * pageSize, (page + 1) * pageSize - 1);

      if (platform) {
        query = query.eq('platform', platform);
      }

      const { data, error } = await query;

      if (error) {
        throw new Error(`Failed to get order stats: ${error.message}`);
      }

      const orders = data ?? [];

      for (const order of orders) {
        const status = order.status || 'Unknown';
        ordersByStatus[status] = (ordersByStatus[status] || 0) + 1;
        totalRevenue += order.total || 0;
        totalOrders++;
      }

      hasMore = orders.length === pageSize;
      page++;
    }

    return {
      totalOrders,
      totalRevenue,
      ordersByStatus,
    };
  }

  /**
   * Get count of orders by platform
   * Uses accurate count query (no 1000 limit)
   */
  async countByPlatform(userId: string, platform: string): Promise<number> {
    const { count, error } = await this.supabase
      .from('platform_orders')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', userId)
      .eq('platform', platform);

    if (error) {
      throw new Error(`Failed to count orders: ${error.message}`);
    }

    return count ?? 0;
  }

  /**
   * Get count of all orders for a user
   * Uses accurate count query (no 1000 limit)
   */
  async countByUser(userId: string): Promise<number> {
    const { count, error } = await this.supabase
      .from('platform_orders')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', userId);

    if (error) {
      throw new Error(`Failed to count orders: ${error.message}`);
    }

    return count ?? 0;
  }

  /**
   * Get existing orders for a platform with their status_changed_at timestamps
   * Used for incremental sync to determine which orders need item fetching
   * Returns a map of platform_order_id -> platform_status_changed_at
   */
  async getOrderStatusTimestamps(
    userId: string,
    platform: string
  ): Promise<Map<string, Date | null>> {
    const pageSize = 1000;
    let page = 0;
    let hasMore = true;
    const timestamps = new Map<string, Date | null>();

    while (hasMore) {
      const { data, error } = await this.supabase
        .from('platform_orders')
        .select('platform_order_id, platform_status_changed_at')
        .eq('user_id', userId)
        .eq('platform', platform)
        .range(page * pageSize, (page + 1) * pageSize - 1);

      if (error) {
        throw new Error(`Failed to get order timestamps: ${error.message}`);
      }

      const orders = data ?? [];
      for (const order of orders) {
        timestamps.set(
          order.platform_order_id,
          order.platform_status_changed_at ? new Date(order.platform_status_changed_at) : null
        );
      }

      hasMore = orders.length === pageSize;
      page++;
    }

    return timestamps;
  }
}
