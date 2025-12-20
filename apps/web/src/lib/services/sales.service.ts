/**
 * Sales Service
 *
 * Business logic for sales management and recording.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type {
  Database,
  SaleInsert,
  SaleItemInsert,
  OrderItem,
} from '@hadley-bricks/database';
import { SalesRepository, SaleWithItems } from '../repositories/sales.repository';
import { OrderRepository } from '../repositories/order.repository';

/**
 * Input for creating a sale from an order
 */
export interface CreateSaleFromOrderInput {
  orderId: string;
  platformFees?: number;
  shippingCost?: number;
  otherCosts?: number;
  notes?: string;
}

/**
 * Input for creating a manual sale
 */
export interface CreateManualSaleInput {
  saleDate: string;
  platform: string;
  saleAmount: number;
  shippingCharged?: number;
  shippingCost?: number;
  platformFees?: number;
  otherCosts?: number;
  costOfGoods?: number;
  buyerName?: string;
  buyerEmail?: string;
  description?: string;
  notes?: string;
  currency?: string;
  items?: Array<{
    itemNumber: string;
    itemName?: string;
    itemType?: string;
    colorName?: string;
    condition?: 'New' | 'Used';
    quantity: number;
    unitPrice: number;
    unitCost?: number;
  }>;
}

/**
 * Sale creation result
 */
export interface SaleResult {
  success: boolean;
  sale?: SaleWithItems;
  error?: string;
}

export class SalesService {
  private salesRepo: SalesRepository;
  private orderRepo: OrderRepository;

  constructor(private supabase: SupabaseClient<Database>) {
    this.salesRepo = new SalesRepository(supabase);
    this.orderRepo = new OrderRepository(supabase);
  }

  /**
   * Create a sale record from a completed order
   */
  async createFromOrder(
    userId: string,
    input: CreateSaleFromOrderInput
  ): Promise<SaleResult> {
    try {
      // Fetch the order with items
      const order = await this.orderRepo.findByIdWithItems(input.orderId);

      if (!order) {
        return { success: false, error: 'Order not found' };
      }

      // Check if sale already exists for this order
      const existingSale = await this.salesRepo.findByOrderId(input.orderId);
      if (existingSale) {
        return { success: false, error: 'Sale already exists for this order' };
      }

      // Calculate totals
      const saleAmount = order.subtotal || order.total || 0;
      const shippingCharged = order.shipping || 0;
      const platformFees = input.platformFees ?? (order.fees || 0);
      const shippingCost = input.shippingCost ?? 0;
      const otherCosts = input.otherCosts ?? 0;

      // Calculate cost of goods from order items if linked to inventory
      let costOfGoods = 0;
      const saleItems: Omit<SaleItemInsert, 'sale_id'>[] = [];

      for (const item of order.items) {
        const unitCost = await this.getItemCost(item);
        const totalCost = unitCost * (item.quantity || 1);
        costOfGoods += totalCost;

        saleItems.push({
          item_number: item.item_number,
          item_name: item.item_name,
          item_type: item.item_type,
          color_name: item.color_name,
          condition: item.condition,
          quantity: item.quantity || 1,
          unit_price: item.unit_price || 0,
          total_price: item.total_price || (item.unit_price || 0) * (item.quantity || 1),
          unit_cost: unitCost || null,
          inventory_item_id: item.inventory_item_id,
        });
      }

      // Create the sale
      const saleData: SaleInsert = {
        user_id: userId,
        order_id: input.orderId,
        sale_date: order.order_date
          ? new Date(order.order_date).toISOString().split('T')[0]
          : new Date().toISOString().split('T')[0],
        platform: order.platform,
        platform_order_id: order.platform_order_id,
        sale_amount: saleAmount,
        shipping_charged: shippingCharged,
        shipping_cost: shippingCost,
        platform_fees: platformFees,
        other_costs: otherCosts,
        cost_of_goods: costOfGoods,
        buyer_name: order.buyer_name,
        buyer_email: order.buyer_email,
        notes: input.notes,
        currency: order.currency,
      };

      const sale = await this.salesRepo.createWithItems(saleData, saleItems);

      return { success: true, sale };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return { success: false, error: message };
    }
  }

  /**
   * Create a manual sale (not from an order)
   */
  async createManualSale(userId: string, input: CreateManualSaleInput): Promise<SaleResult> {
    try {
      // Calculate cost of goods from items if provided
      let costOfGoods = input.costOfGoods ?? 0;
      const saleItems: Omit<SaleItemInsert, 'sale_id'>[] = [];

      if (input.items && input.items.length > 0) {
        for (const item of input.items) {
          const totalPrice = item.unitPrice * item.quantity;
          const unitCost = item.unitCost ?? 0;
          const totalCost = unitCost * item.quantity;

          if (!input.costOfGoods) {
            costOfGoods += totalCost;
          }

          saleItems.push({
            item_number: item.itemNumber,
            item_name: item.itemName,
            item_type: item.itemType,
            color_name: item.colorName,
            condition: item.condition,
            quantity: item.quantity,
            unit_price: item.unitPrice,
            total_price: totalPrice,
            unit_cost: unitCost || null,
          });
        }
      }

      const saleData: SaleInsert = {
        user_id: userId,
        sale_date: input.saleDate,
        platform: input.platform,
        sale_amount: input.saleAmount,
        shipping_charged: input.shippingCharged ?? 0,
        shipping_cost: input.shippingCost ?? 0,
        platform_fees: input.platformFees ?? 0,
        other_costs: input.otherCosts ?? 0,
        cost_of_goods: costOfGoods,
        buyer_name: input.buyerName,
        buyer_email: input.buyerEmail,
        description: input.description,
        notes: input.notes,
        currency: input.currency ?? 'GBP',
      };

      const sale = await this.salesRepo.createWithItems(saleData, saleItems);

      return { success: true, sale };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return { success: false, error: message };
    }
  }

  /**
   * Update inventory status to SOLD when sale is recorded
   */
  async updateInventoryStatus(saleId: string): Promise<void> {
    const saleItems = await this.salesRepo.getSaleItems(saleId);

    for (const item of saleItems) {
      if (item.inventory_item_id) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await (this.supabase as any)
          .from('inventory_items')
          .update({ status: 'SOLD' })
          .eq('id', item.inventory_item_id);
      }
    }
  }

  /**
   * Get cost for an order item from linked inventory
   */
  private async getItemCost(item: OrderItem): Promise<number> {
    if (!item.inventory_item_id) {
      return 0;
    }

    const { data } = await this.supabase
      .from('inventory_items')
      .select('cost')
      .eq('id', item.inventory_item_id)
      .single();

    const inventoryItem = data as { cost: number | null } | null;
    return inventoryItem?.cost || 0;
  }

  /**
   * Get sales for a user
   */
  async getSales(
    userId: string,
    options?: {
      platform?: string;
      startDate?: Date;
      endDate?: Date;
      page?: number;
      pageSize?: number;
    }
  ) {
    return this.salesRepo.findByUser(
      userId,
      {
        platform: options?.platform,
        startDate: options?.startDate,
        endDate: options?.endDate,
      },
      {
        page: options?.page,
        pageSize: options?.pageSize,
      }
    );
  }

  /**
   * Get sale with items
   */
  async getSaleWithItems(saleId: string): Promise<SaleWithItems | null> {
    return this.salesRepo.findByIdWithItems(saleId);
  }

  /**
   * Get sales statistics
   */
  async getStats(
    userId: string,
    options?: {
      platform?: string;
      startDate?: Date;
      endDate?: Date;
    }
  ) {
    return this.salesRepo.getStats(userId, options);
  }

  /**
   * Get monthly summary
   */
  async getMonthlySummary(userId: string, year: number) {
    return this.salesRepo.getMonthlySummary(userId, year);
  }

  /**
   * Delete a sale
   */
  async deleteSale(saleId: string): Promise<boolean> {
    try {
      // First delete items
      await this.salesRepo.deleteSaleItems(saleId);

      // Then delete the sale
      await this.salesRepo.delete(saleId);

      return true;
    } catch (error) {
      console.error('Failed to delete sale:', error);
      return false;
    }
  }
}
