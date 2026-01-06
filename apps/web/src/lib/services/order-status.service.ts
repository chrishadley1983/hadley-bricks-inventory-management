/**
 * Order Status Service
 *
 * Manages order status workflow with validation and history tracking.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type {
  Database,
  PlatformOrder,
  PlatformOrderUpdate,
  OrderStatusHistory,
  OrderStatus,
} from '@hadley-bricks/database';

/**
 * Valid status transitions for order workflow
 */
const STATUS_TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  Pending: ['Paid', 'Cancelled'],
  Paid: ['Packed', 'Cancelled'],
  Packed: ['Shipped', 'Paid'], // Can go back to Paid if unpacked
  Shipped: ['Completed', 'Packed'], // Can go back if shipment issue
  Completed: [], // Terminal state
  Cancelled: [], // Terminal state
};

/**
 * Shipping information for status updates
 */
export interface ShippingInfo {
  carrier?: string;
  trackingNumber?: string;
  method?: string;
  actualCost?: number;
}

/**
 * Status update result
 */
export interface StatusUpdateResult {
  success: boolean;
  order: PlatformOrder;
  historyEntry: OrderStatusHistory;
  errors?: string[];
}

/**
 * Bulk status update result
 */
export interface BulkStatusUpdateResult {
  success: boolean;
  updated: number;
  failed: number;
  results: Array<{
    orderId: string;
    success: boolean;
    error?: string;
  }>;
}

export class OrderStatusService {
  constructor(private supabase: SupabaseClient<Database>) {}

  /**
   * Get the internal status or derive from platform status
   */
  getEffectiveStatus(order: PlatformOrder): OrderStatus {
    if (order.internal_status) {
      return order.internal_status as OrderStatus;
    }
    return this.normalizeStatus(order.status);
  }

  /**
   * Normalize platform-specific status to our internal status
   */
  normalizeStatus(platformStatus: string | null): OrderStatus {
    if (!platformStatus) return 'Pending';

    const normalized = platformStatus.toLowerCase();

    if (normalized.includes('completed') || normalized.includes('received')) {
      return 'Completed';
    }
    if (normalized.includes('shipped') || normalized.includes('dispatched')) {
      return 'Shipped';
    }
    if (normalized.includes('packed') || normalized.includes('ready')) {
      return 'Packed';
    }
    if (normalized.includes('paid') || normalized.includes('payment')) {
      return 'Paid';
    }
    if (normalized.includes('cancel') || normalized.includes('npb')) {
      return 'Cancelled';
    }

    return 'Pending';
  }

  /**
   * Check if a status transition is valid
   */
  isValidTransition(fromStatus: OrderStatus, toStatus: OrderStatus): boolean {
    const allowedTransitions = STATUS_TRANSITIONS[fromStatus] || [];
    return allowedTransitions.includes(toStatus);
  }

  /**
   * Get allowed next statuses from current status
   */
  getAllowedNextStatuses(currentStatus: OrderStatus): OrderStatus[] {
    return STATUS_TRANSITIONS[currentStatus] || [];
  }

  /**
   * Update order status with history tracking
   */
  async updateStatus(
    orderId: string,
    newStatus: OrderStatus,
    options?: {
      notes?: string;
      changedBy?: string;
      shipping?: ShippingInfo;
      force?: boolean;
    }
  ): Promise<StatusUpdateResult> {
    const { notes, changedBy = 'user', shipping, force = false } = options || {};

    // Fetch the order
    const { data: order, error: fetchError } = await this.supabase
      .from('platform_orders')
      .select('*')
      .eq('id', orderId)
      .single();

    if (fetchError || !order) {
      throw new Error(`Order not found: ${orderId}`);
    }

    const currentStatus = this.getEffectiveStatus(order as PlatformOrder);

    // Check transition validity
    if (!force && !this.isValidTransition(currentStatus, newStatus)) {
      throw new Error(
        `Invalid status transition from ${currentStatus} to ${newStatus}. ` +
          `Allowed transitions: ${this.getAllowedNextStatuses(currentStatus).join(', ') || 'none'}`
      );
    }

    // Build update object
    const now = new Date().toISOString();
    const updateData: PlatformOrderUpdate = {
      internal_status: newStatus,
    };

    // Set timestamp fields based on status
    if (newStatus === 'Packed') {
      updateData.packed_at = now;
    } else if (newStatus === 'Shipped') {
      updateData.shipped_at = now;
      if (shipping) {
        if (shipping.carrier) updateData.shipping_carrier = shipping.carrier;
        if (shipping.trackingNumber) updateData.tracking_number = shipping.trackingNumber;
        if (shipping.method) updateData.shipping_method = shipping.method;
        if (shipping.actualCost !== undefined) updateData.shipping_cost_actual = shipping.actualCost;
      }
    } else if (newStatus === 'Completed') {
      updateData.completed_at = now;
    } else if (newStatus === 'Cancelled') {
      updateData.cancelled_at = now;
    }

    // Update the order
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: updatedOrder, error: updateError } = await (this.supabase as any)
      .from('platform_orders')
      .update(updateData)
      .eq('id', orderId)
      .select()
      .single();

    if (updateError) {
      throw new Error(`Failed to update order status: ${updateError.message}`);
    }

    // Create status history entry
    const historyEntry = {
      order_id: orderId,
      status: newStatus,
      previous_status: currentStatus,
      changed_by: changedBy,
      notes,
    };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: history, error: historyError } = await (this.supabase as any)
      .from('order_status_history')
      .insert(historyEntry)
      .select()
      .single();

    if (historyError) {
      console.error('Failed to create status history:', historyError);
    }

    return {
      success: true,
      order: updatedOrder as unknown as PlatformOrder,
      historyEntry: (history || {}) as unknown as OrderStatusHistory,
    };
  }

  /**
   * Bulk update order statuses
   */
  async bulkUpdateStatus(
    orderIds: string[],
    newStatus: OrderStatus,
    options?: {
      notes?: string;
      changedBy?: string;
      shipping?: ShippingInfo;
    }
  ): Promise<BulkStatusUpdateResult> {
    const results: BulkStatusUpdateResult['results'] = [];
    let updated = 0;
    let failed = 0;

    for (const orderId of orderIds) {
      try {
        await this.updateStatus(orderId, newStatus, options);
        results.push({ orderId, success: true });
        updated++;
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        results.push({ orderId, success: false, error: errorMessage });
        failed++;
      }
    }

    return {
      success: failed === 0,
      updated,
      failed,
      results,
    };
  }

  /**
   * Get status history for an order
   */
  async getStatusHistory(orderId: string): Promise<OrderStatusHistory[]> {
    const { data, error } = await this.supabase
      .from('order_status_history')
      .select('*')
      .eq('order_id', orderId)
      .order('created_at', { ascending: false });

    if (error) {
      throw new Error(`Failed to fetch status history: ${error.message}`);
    }

    return (data || []) as OrderStatusHistory[];
  }

  /**
   * Mark order as shipped with tracking info
   */
  async markAsShipped(
    orderId: string,
    shipping: ShippingInfo,
    notes?: string
  ): Promise<StatusUpdateResult> {
    return this.updateStatus(orderId, 'Shipped', {
      notes,
      shipping,
    });
  }

  /**
   * Mark order as completed
   */
  async markAsCompleted(orderId: string, notes?: string): Promise<StatusUpdateResult> {
    return this.updateStatus(orderId, 'Completed', { notes });
  }

  /**
   * Cancel order
   */
  async cancelOrder(orderId: string, reason?: string): Promise<StatusUpdateResult> {
    return this.updateStatus(orderId, 'Cancelled', {
      notes: reason,
      force: true, // Allow cancellation from any status
    });
  }

  /**
   * Get orders by status
   */
  async getOrdersByStatus(
    userId: string,
    status: OrderStatus,
    options?: {
      platform?: string;
      limit?: number;
      offset?: number;
    }
  ): Promise<PlatformOrder[]> {
    let query = this.supabase
      .from('platform_orders')
      .select('*')
      .eq('user_id', userId)
      .eq('internal_status', status);

    if (options?.platform) {
      query = query.eq('platform', options.platform);
    }

    query = query.order('order_date', { ascending: false });

    if (options?.limit) {
      query = query.limit(options.limit);
    }

    if (options?.offset) {
      query = query.range(options.offset, options.offset + (options.limit || 50) - 1);
    }

    const { data, error } = await query;

    if (error) {
      throw new Error(`Failed to fetch orders by status: ${error.message}`);
    }

    return (data || []) as PlatformOrder[];
  }

  /**
   * Get order status summary for dashboard
   * Uses pagination to handle >1000 records
   * Supports optional date range filtering
   */
  async getStatusSummary(
    userId: string,
    platform?: string,
    options?: {
      startDate?: Date;
      endDate?: Date;
    }
  ): Promise<Record<OrderStatus, number>> {
    const summary: Record<OrderStatus, number> = {
      Pending: 0,
      Paid: 0,
      Packed: 0,
      Shipped: 0,
      Completed: 0,
      Cancelled: 0,
    };

    const pageSize = 1000;
    let page = 0;
    let hasMore = true;

    while (hasMore) {
      let query = this.supabase
        .from('platform_orders')
        .select('internal_status, status')
        .eq('user_id', userId)
        .range(page * pageSize, (page + 1) * pageSize - 1);

      if (platform) {
        query = query.eq('platform', platform);
      }

      if (options?.startDate) {
        query = query.gte('order_date', options.startDate.toISOString().split('T')[0]);
      }

      if (options?.endDate) {
        query = query.lte('order_date', options.endDate.toISOString().split('T')[0]);
      }

      const { data, error } = await query;

      if (error) {
        throw new Error(`Failed to get status summary: ${error.message}`);
      }

      const orders = (data || []) as Array<{ internal_status: string | null; status: string | null }>;
      for (const order of orders) {
        // Use internal_status if set, otherwise normalize the raw status field
        const status = order.internal_status
          ? (order.internal_status as OrderStatus)
          : this.normalizeStatus(order.status);
        summary[status] = (summary[status] || 0) + 1;
      }

      hasMore = orders.length === pageSize;
      page++;
    }

    return summary;
  }
}
