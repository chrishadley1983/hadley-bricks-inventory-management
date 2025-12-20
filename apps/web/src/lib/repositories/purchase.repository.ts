import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database, Purchase, PurchaseInsert, PurchaseUpdate } from '@hadley-bricks/database';
import { BaseRepository, PaginationOptions, PaginatedResult } from './base.repository';

/**
 * Filter options for purchase queries
 */
export interface PurchaseFilters {
  source?: string;
  paymentMethod?: string;
  dateFrom?: string;
  dateTo?: string;
  searchTerm?: string;
}

/**
 * Repository for purchase operations
 */
export class PurchaseRepository extends BaseRepository<Purchase, PurchaseInsert, PurchaseUpdate> {
  constructor(supabase: SupabaseClient<Database>) {
    super(supabase, 'purchases');
  }

  /**
   * Find all purchases with optional filters and pagination
   */
  async findAllFiltered(
    filters?: PurchaseFilters,
    pagination?: PaginationOptions
  ): Promise<PaginatedResult<Purchase>> {
    const page = pagination?.page ?? 1;
    const pageSize = pagination?.pageSize ?? 50;
    const from = (page - 1) * pageSize;
    const to = from + pageSize - 1;

    // Build the query
    let query = this.supabase.from(this.tableName).select('*', { count: 'exact' });

    // Apply filters
    if (filters?.source) {
      query = query.eq('source', filters.source);
    }

    if (filters?.paymentMethod) {
      query = query.eq('payment_method', filters.paymentMethod);
    }

    if (filters?.dateFrom) {
      query = query.gte('purchase_date', filters.dateFrom);
    }

    if (filters?.dateTo) {
      query = query.lte('purchase_date', filters.dateTo);
    }

    if (filters?.searchTerm) {
      query = query.or(
        `short_description.ilike.%${filters.searchTerm}%,description.ilike.%${filters.searchTerm}%,reference.ilike.%${filters.searchTerm}%`
      );
    }

    // Apply pagination
    query = query.range(from, to).order('purchase_date', { ascending: false });

    const { data, count, error } = await query;

    if (error) {
      throw new Error(`Failed to find purchases: ${error.message}`);
    }

    const total = count ?? 0;

    return {
      data: (data ?? []) as Purchase[],
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
    };
  }

  /**
   * Find purchases within a date range
   */
  async findByDateRange(
    dateFrom: string,
    dateTo: string,
    pagination?: PaginationOptions
  ): Promise<PaginatedResult<Purchase>> {
    return this.findAllFiltered({ dateFrom, dateTo }, pagination);
  }

  /**
   * Find purchases by source
   */
  async findBySource(
    source: string,
    pagination?: PaginationOptions
  ): Promise<PaginatedResult<Purchase>> {
    return this.findAllFiltered({ source }, pagination);
  }

  /**
   * Get total purchases for a given month
   */
  async getMonthlyTotal(year: number, month: number): Promise<number> {
    const startDate = `${year}-${String(month).padStart(2, '0')}-01`;
    const endDate = new Date(year, month, 0).toISOString().split('T')[0]; // Last day of month

    const { data, error } = await this.supabase
      .from(this.tableName)
      .select('cost')
      .gte('purchase_date', startDate)
      .lte('purchase_date', endDate);

    if (error) {
      throw new Error(`Failed to get monthly total: ${error.message}`);
    }

    return (data ?? []).reduce((sum, item) => sum + (item.cost ?? 0), 0);
  }

  /**
   * Get rolling 12-month purchase total
   */
  async getRolling12MonthTotal(): Promise<number> {
    const today = new Date();
    const oneYearAgo = new Date(today.getFullYear() - 1, today.getMonth(), today.getDate());
    const startDate = oneYearAgo.toISOString().split('T')[0];

    const { data, error } = await this.supabase
      .from(this.tableName)
      .select('cost')
      .gte('purchase_date', startDate);

    if (error) {
      throw new Error(`Failed to get rolling 12-month total: ${error.message}`);
    }

    return (data ?? []).reduce((sum, item) => sum + (item.cost ?? 0), 0);
  }

  /**
   * Get purchases grouped by source with totals
   */
  async getTotalsBySource(): Promise<Record<string, number>> {
    const { data, error } = await this.supabase.from(this.tableName).select('source, cost');

    if (error) {
      throw new Error(`Failed to get totals by source: ${error.message}`);
    }

    const totals: Record<string, number> = {};
    (data ?? []).forEach((item) => {
      const source = item.source || 'Unknown';
      totals[source] = (totals[source] || 0) + (item.cost ?? 0);
    });

    return totals;
  }

  /**
   * Get recent purchases (last N)
   */
  async getRecent(limit: number = 10): Promise<Purchase[]> {
    const { data, error } = await this.supabase
      .from(this.tableName)
      .select('*')
      .order('purchase_date', { ascending: false })
      .limit(limit);

    if (error) {
      throw new Error(`Failed to get recent purchases: ${error.message}`);
    }

    return (data ?? []) as Purchase[];
  }
}
