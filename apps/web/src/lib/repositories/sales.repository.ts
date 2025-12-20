/**
 * Sales Repository
 *
 * Data access layer for sales records.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type {
  Database,
  Sale,
  SaleInsert,
  SaleUpdate,
  SaleItem,
  SaleItemInsert,
} from '@hadley-bricks/database';
import { BaseRepository, PaginationOptions, PaginatedResult } from './base.repository';

export interface SaleFilters {
  platform?: string;
  startDate?: Date;
  endDate?: Date;
  minAmount?: number;
  maxAmount?: number;
}

export interface SaleWithItems extends Sale {
  items: SaleItem[];
}

/**
 * Repository for sales records
 */
export class SalesRepository extends BaseRepository<Sale, SaleInsert, SaleUpdate> {
  constructor(supabase: SupabaseClient<Database>) {
    super(supabase, 'sales');
  }

  /**
   * Find sales by user with optional filters
   */
  async findByUser(
    userId: string,
    filters?: SaleFilters,
    options?: PaginationOptions
  ): Promise<PaginatedResult<Sale>> {
    const page = options?.page ?? 1;
    const pageSize = options?.pageSize ?? 50;
    const from = (page - 1) * pageSize;
    const to = from + pageSize - 1;

    let query = this.supabase
      .from('sales')
      .select('*', { count: 'exact' })
      .eq('user_id', userId);

    if (filters?.platform) {
      query = query.eq('platform', filters.platform);
    }

    if (filters?.startDate) {
      query = query.gte('sale_date', filters.startDate.toISOString().split('T')[0]);
    }

    if (filters?.endDate) {
      query = query.lte('sale_date', filters.endDate.toISOString().split('T')[0]);
    }

    if (filters?.minAmount !== undefined) {
      query = query.gte('sale_amount', filters.minAmount);
    }

    if (filters?.maxAmount !== undefined) {
      query = query.lte('sale_amount', filters.maxAmount);
    }

    const { data, count, error } = await query
      .order('sale_date', { ascending: false })
      .range(from, to);

    if (error) {
      throw new Error(`Failed to fetch sales: ${error.message}`);
    }

    const total = count ?? 0;

    return {
      data: (data ?? []) as Sale[],
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
    };
  }

  /**
   * Find a sale by order ID
   */
  async findByOrderId(orderId: string): Promise<Sale | null> {
    const { data, error } = await this.supabase
      .from('sales')
      .select('*')
      .eq('order_id', orderId)
      .single();

    if (error) {
      if (error.code === 'PGRST116') {
        return null;
      }
      throw new Error(`Failed to find sale: ${error.message}`);
    }

    return data as Sale;
  }

  /**
   * Get sale with items
   */
  async findByIdWithItems(id: string): Promise<SaleWithItems | null> {
    const [sale, items] = await Promise.all([this.findById(id), this.getSaleItems(id)]);

    if (!sale) {
      return null;
    }

    return { ...sale, items };
  }

  /**
   * Get items for a sale
   */
  async getSaleItems(saleId: string): Promise<SaleItem[]> {
    const { data, error } = await this.supabase
      .from('sale_items')
      .select('*')
      .eq('sale_id', saleId)
      .order('created_at', { ascending: true });

    if (error) {
      throw new Error(`Failed to fetch sale items: ${error.message}`);
    }

    return (data ?? []) as SaleItem[];
  }

  /**
   * Create a sale with items
   */
  async createWithItems(
    sale: SaleInsert,
    items?: Omit<SaleItemInsert, 'sale_id'>[]
  ): Promise<SaleWithItems> {
    // Insert the sale
    const { data: createdSale, error: saleError } = await this.supabase
      .from('sales')
      .insert(sale)
      .select()
      .single();

    if (saleError) {
      throw new Error(`Failed to create sale: ${saleError.message}`);
    }

    const saleWithItems: SaleWithItems = {
      ...(createdSale as Sale),
      items: [],
    };

    // Insert items if provided
    if (items && items.length > 0) {
      const itemsWithSaleId = items.map((item) => ({
        ...item,
        sale_id: createdSale.id,
      }));

      const { data: createdItems, error: itemsError } = await this.supabase
        .from('sale_items')
        .insert(itemsWithSaleId)
        .select();

      if (itemsError) {
        console.error('Failed to create sale items:', itemsError);
      } else {
        saleWithItems.items = (createdItems || []) as SaleItem[];
      }
    }

    return saleWithItems;
  }

  /**
   * Insert sale items
   */
  async insertSaleItems(items: SaleItemInsert[]): Promise<SaleItem[]> {
    if (items.length === 0) {
      return [];
    }

    const { data, error } = await this.supabase.from('sale_items').insert(items).select();

    if (error) {
      throw new Error(`Failed to insert sale items: ${error.message}`);
    }

    return (data ?? []) as SaleItem[];
  }

  /**
   * Delete sale items
   */
  async deleteSaleItems(saleId: string): Promise<void> {
    const { error } = await this.supabase.from('sale_items').delete().eq('sale_id', saleId);

    if (error) {
      throw new Error(`Failed to delete sale items: ${error.message}`);
    }
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
  ): Promise<{
    totalSales: number;
    totalRevenue: number;
    totalProfit: number;
    averageSale: number;
    platformBreakdown: Record<string, { count: number; revenue: number; profit: number }>;
  }> {
    let query = this.supabase
      .from('sales')
      .select('platform, sale_amount, gross_profit')
      .eq('user_id', userId);

    if (options?.platform) {
      query = query.eq('platform', options.platform);
    }

    if (options?.startDate) {
      query = query.gte('sale_date', options.startDate.toISOString().split('T')[0]);
    }

    if (options?.endDate) {
      query = query.lte('sale_date', options.endDate.toISOString().split('T')[0]);
    }

    const { data, error } = await query;

    if (error) {
      throw new Error(`Failed to get sales stats: ${error.message}`);
    }

    const sales = data || [];
    const platformBreakdown: Record<string, { count: number; revenue: number; profit: number }> =
      {};

    let totalRevenue = 0;
    let totalProfit = 0;

    for (const sale of sales) {
      totalRevenue += sale.sale_amount || 0;
      totalProfit += sale.gross_profit || 0;

      const platform = sale.platform || 'Unknown';
      if (!platformBreakdown[platform]) {
        platformBreakdown[platform] = { count: 0, revenue: 0, profit: 0 };
      }
      platformBreakdown[platform].count++;
      platformBreakdown[platform].revenue += sale.sale_amount || 0;
      platformBreakdown[platform].profit += sale.gross_profit || 0;
    }

    return {
      totalSales: sales.length,
      totalRevenue,
      totalProfit,
      averageSale: sales.length > 0 ? totalRevenue / sales.length : 0,
      platformBreakdown,
    };
  }

  /**
   * Get monthly sales summary
   */
  async getMonthlySummary(
    userId: string,
    year: number
  ): Promise<
    Array<{
      month: number;
      sales: number;
      revenue: number;
      profit: number;
    }>
  > {
    const startDate = `${year}-01-01`;
    const endDate = `${year}-12-31`;

    const { data, error } = await this.supabase
      .from('sales')
      .select('sale_date, sale_amount, gross_profit')
      .eq('user_id', userId)
      .gte('sale_date', startDate)
      .lte('sale_date', endDate);

    if (error) {
      throw new Error(`Failed to get monthly summary: ${error.message}`);
    }

    // Initialize months
    const monthlyData: Array<{
      month: number;
      sales: number;
      revenue: number;
      profit: number;
    }> = Array.from({ length: 12 }, (_, i) => ({
      month: i + 1,
      sales: 0,
      revenue: 0,
      profit: 0,
    }));

    for (const sale of data || []) {
      const saleDate = new Date(sale.sale_date);
      const month = saleDate.getMonth(); // 0-indexed
      monthlyData[month].sales++;
      monthlyData[month].revenue += sale.sale_amount || 0;
      monthlyData[month].profit += sale.gross_profit || 0;
    }

    return monthlyData;
  }
}
