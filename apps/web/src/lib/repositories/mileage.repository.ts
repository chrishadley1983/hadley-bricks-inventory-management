import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@hadley-bricks/database';
import { BaseRepository, PaginationOptions, PaginatedResult } from './base.repository';

type MileageTracking = Database['public']['Tables']['mileage_tracking']['Row'];
type MileageInsert = Database['public']['Tables']['mileage_tracking']['Insert'];
type MileageUpdate = Database['public']['Tables']['mileage_tracking']['Update'];

export type ExpenseType = 'mileage' | 'parking' | 'toll' | 'other';

/**
 * Filter options for mileage queries
 */
export interface MileageFilters {
  purchaseId?: string;
  expenseType?: ExpenseType;
  dateFrom?: string;
  dateTo?: string;
}

/**
 * Repository for mileage tracking operations
 */
export class MileageRepository extends BaseRepository<
  MileageTracking,
  MileageInsert,
  MileageUpdate
> {
  constructor(supabase: SupabaseClient<Database>) {
    super(supabase, 'mileage_tracking');
  }

  /**
   * Find all mileage entries for a user with optional filters and pagination
   */
  async findAllFiltered(
    userId: string,
    filters?: MileageFilters,
    pagination?: PaginationOptions
  ): Promise<PaginatedResult<MileageTracking>> {
    const page = pagination?.page ?? 1;
    const pageSize = pagination?.pageSize ?? 50;
    const from = (page - 1) * pageSize;
    const to = from + pageSize - 1;

    let query = this.supabase
      .from(this.tableName)
      .select('*', { count: 'exact' })
      .eq('user_id', userId);

    // Apply filters
    if (filters?.purchaseId) {
      query = query.eq('purchase_id', filters.purchaseId);
    }

    if (filters?.expenseType) {
      query = query.eq('expense_type', filters.expenseType);
    }

    if (filters?.dateFrom) {
      query = query.gte('tracking_date', filters.dateFrom);
    }

    if (filters?.dateTo) {
      query = query.lte('tracking_date', filters.dateTo);
    }

    // Apply pagination and ordering
    query = query.range(from, to).order('tracking_date', { ascending: false });

    const { data, count, error } = await query;

    if (error) {
      throw new Error(`Failed to find mileage entries: ${error.message}`);
    }

    const total = count ?? 0;

    return {
      data: (data ?? []) as MileageTracking[],
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
    };
  }

  /**
   * Find all mileage entries for a specific purchase
   */
  async findByPurchaseId(purchaseId: string): Promise<MileageTracking[]> {
    const { data, error } = await this.supabase
      .from(this.tableName)
      .select('*')
      .eq('purchase_id', purchaseId)
      .order('tracking_date', { ascending: false });

    if (error) {
      throw new Error(`Failed to find mileage for purchase: ${error.message}`);
    }

    return (data ?? []) as MileageTracking[];
  }

  /**
   * Find mileage entries by date range
   */
  async findByDateRange(
    userId: string,
    dateFrom: string,
    dateTo: string,
    pagination?: PaginationOptions
  ): Promise<PaginatedResult<MileageTracking>> {
    return this.findAllFiltered(userId, { dateFrom, dateTo }, pagination);
  }

  /**
   * Get total mileage cost for a period
   */
  async getTotalForPeriod(
    userId: string,
    dateFrom: string,
    dateTo: string,
    expenseType?: ExpenseType
  ): Promise<{ totalMiles: number; totalAmount: number }> {
    let query = this.supabase
      .from(this.tableName)
      .select('miles_travelled, amount_claimed')
      .eq('user_id', userId)
      .gte('tracking_date', dateFrom)
      .lte('tracking_date', dateTo);

    if (expenseType) {
      query = query.eq('expense_type', expenseType);
    }

    const { data, error } = await query;

    if (error) {
      throw new Error(`Failed to get mileage totals: ${error.message}`);
    }

    const items = data ?? [];
    return {
      totalMiles: items.reduce((sum, item) => sum + (item.miles_travelled ?? 0), 0),
      totalAmount: items.reduce((sum, item) => sum + (item.amount_claimed ?? 0), 0),
    };
  }

  /**
   * Get total mileage for a specific purchase
   */
  async getTotalForPurchase(
    purchaseId: string
  ): Promise<{ totalMiles: number; totalAmount: number }> {
    const { data, error } = await this.supabase
      .from(this.tableName)
      .select('miles_travelled, amount_claimed')
      .eq('purchase_id', purchaseId);

    if (error) {
      throw new Error(`Failed to get mileage totals for purchase: ${error.message}`);
    }

    const items = data ?? [];
    return {
      totalMiles: items.reduce((sum, item) => sum + (item.miles_travelled ?? 0), 0),
      totalAmount: items.reduce((sum, item) => sum + (item.amount_claimed ?? 0), 0),
    };
  }

  /**
   * Get mileage summary by expense type for a period
   */
  async getSummaryByType(
    userId: string,
    dateFrom: string,
    dateTo: string
  ): Promise<Record<ExpenseType, { totalMiles: number; totalAmount: number; count: number }>> {
    const { data, error } = await this.supabase
      .from(this.tableName)
      .select('expense_type, miles_travelled, amount_claimed')
      .eq('user_id', userId)
      .gte('tracking_date', dateFrom)
      .lte('tracking_date', dateTo);

    if (error) {
      throw new Error(`Failed to get mileage summary: ${error.message}`);
    }

    const summary: Record<ExpenseType, { totalMiles: number; totalAmount: number; count: number }> =
      {
        mileage: { totalMiles: 0, totalAmount: 0, count: 0 },
        parking: { totalMiles: 0, totalAmount: 0, count: 0 },
        toll: { totalMiles: 0, totalAmount: 0, count: 0 },
        other: { totalMiles: 0, totalAmount: 0, count: 0 },
      };

    for (const item of data ?? []) {
      const type = (item.expense_type as ExpenseType) || 'other';
      summary[type].totalMiles += item.miles_travelled ?? 0;
      summary[type].totalAmount += item.amount_claimed ?? 0;
      summary[type].count += 1;
    }

    return summary;
  }

  /**
   * Create a new mileage entry
   */
  async createEntry(
    userId: string,
    input: Omit<MileageInsert, 'user_id'>
  ): Promise<MileageTracking> {
    return this.create({ ...input, user_id: userId });
  }

  /**
   * Update a mileage entry (only if owned by user)
   */
  async updateEntry(id: string, userId: string, input: MileageUpdate): Promise<MileageTracking> {
    const { data, error } = await this.supabase
      .from(this.tableName)
      .update(input)
      .eq('id', id)
      .eq('user_id', userId)
      .select()
      .single();

    if (error) {
      throw new Error(`Failed to update mileage entry: ${error.message}`);
    }

    return data as MileageTracking;
  }

  /**
   * Delete a mileage entry (only if owned by user)
   */
  async deleteEntry(id: string, userId: string): Promise<void> {
    const { error } = await this.supabase
      .from(this.tableName)
      .delete()
      .eq('id', id)
      .eq('user_id', userId);

    if (error) {
      throw new Error(`Failed to delete mileage entry: ${error.message}`);
    }
  }
}
