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

    // Build query
    let query = this.supabase
      .from('platform_orders')
      .select('*', { count: 'exact' })
      .eq('user_id', userId);

    if (filters?.platform) {
      query = query.eq('platform', filters.platform);
    }

    if (filters?.status) {
      query = query.eq('status', filters.status);
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
   */
  async replaceOrderItems(orderId: string, items: Omit<OrderItemInsert, 'order_id'>[]): Promise<OrderItem[]> {
    await this.deleteOrderItems(orderId);

    const itemsWithOrderId = items.map((item) => ({
      ...item,
      order_id: orderId,
    }));

    return this.insertOrderItems(itemsWithOrderId);
  }

  /**
   * Get order statistics for a user
   */
  async getStats(
    userId: string,
    platform?: string
  ): Promise<{
    totalOrders: number;
    totalRevenue: number;
    ordersByStatus: Record<string, number>;
  }> {
    let query = this.supabase
      .from('platform_orders')
      .select('status, total')
      .eq('user_id', userId);

    if (platform) {
      query = query.eq('platform', platform);
    }

    const { data, error } = await query;

    if (error) {
      throw new Error(`Failed to get order stats: ${error.message}`);
    }

    const orders = data ?? [];
    const ordersByStatus: Record<string, number> = {};
    let totalRevenue = 0;

    for (const order of orders) {
      const status = order.status || 'Unknown';
      ordersByStatus[status] = (ordersByStatus[status] || 0) + 1;
      totalRevenue += order.total || 0;
    }

    return {
      totalOrders: orders.length,
      totalRevenue,
      ordersByStatus,
    };
  }
}
