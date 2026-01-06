import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@hadley-bricks/database';
import { MileageRepository, ExpenseType } from '../repositories';

type MileageTracking = Database['public']['Tables']['mileage_tracking']['Row'];
type MileageInsert = Database['public']['Tables']['mileage_tracking']['Insert'];

/**
 * Default HMRC approved mileage rate (45p per mile for first 10,000 miles)
 */
export const DEFAULT_MILEAGE_RATE = 0.45;

/**
 * Input for creating a mileage entry
 */
export interface CreateMileageInput {
  purchaseId?: string;
  trackingDate: string;
  destinationPostcode: string;
  milesTravelled: number;
  amountClaimed?: number; // If not provided, calculated from miles
  reason: string;
  expenseType: ExpenseType;
  notes?: string;
}

/**
 * Input for updating a mileage entry
 */
export interface UpdateMileageInput {
  trackingDate?: string;
  destinationPostcode?: string;
  milesTravelled?: number;
  amountClaimed?: number;
  reason?: string;
  expenseType?: ExpenseType;
  notes?: string | null;
}

/**
 * Mileage summary for a purchase
 */
export interface PurchaseMileageSummary {
  entries: MileageTracking[];
  totalMiles: number;
  totalMileageCost: number;
  totalOtherCosts: number;
  totalCost: number;
}

/**
 * Service for mileage tracking business logic
 */
export class MileageService {
  private readonly mileageRepo: MileageRepository;
  private readonly supabase: SupabaseClient<Database>;

  constructor(supabase: SupabaseClient<Database>) {
    this.supabase = supabase;
    this.mileageRepo = new MileageRepository(supabase);
  }

  /**
   * Calculate mileage cost based on miles and rate
   */
  calculateMileageCost(miles: number, rate: number = DEFAULT_MILEAGE_RATE): number {
    return Math.round(miles * rate * 100) / 100; // Round to 2 decimal places
  }

  /**
   * Get home address for a user (from profiles table)
   */
  async getHomeAddress(userId: string): Promise<string | null> {
    const { data, error } = await this.supabase
      .from('profiles')
      .select('home_address')
      .eq('id', userId)
      .single();

    if (error) {
      if (error.code === 'PGRST116') {
        return null;
      }
      throw new Error(`Failed to get home address: ${error.message}`);
    }

    return data?.home_address ?? null;
  }

  /**
   * Update home address for a user
   */
  async updateHomeAddress(userId: string, homeAddress: string): Promise<void> {
    const { error } = await this.supabase
      .from('profiles')
      .update({ home_address: homeAddress })
      .eq('id', userId);

    if (error) {
      throw new Error(`Failed to update home address: ${error.message}`);
    }
  }

  /**
   * Create a mileage entry
   * If amountClaimed is not provided for mileage type, it's calculated automatically
   */
  async createMileageEntry(
    userId: string,
    input: CreateMileageInput,
    mileageRate: number = DEFAULT_MILEAGE_RATE
  ): Promise<MileageTracking> {
    let amountClaimed = input.amountClaimed;

    // Auto-calculate for mileage type if not provided
    if (amountClaimed === undefined && input.expenseType === 'mileage') {
      amountClaimed = this.calculateMileageCost(input.milesTravelled, mileageRate);
    }

    const insertData: Omit<MileageInsert, 'user_id'> = {
      purchase_id: input.purchaseId ?? null,
      tracking_date: input.trackingDate,
      destination_postcode: input.destinationPostcode,
      miles_travelled: input.milesTravelled,
      amount_claimed: amountClaimed ?? 0,
      reason: input.reason,
      expense_type: input.expenseType,
      notes: input.notes ?? null,
    };

    return this.mileageRepo.createEntry(userId, insertData);
  }

  /**
   * Update a mileage entry
   */
  async updateMileageEntry(
    id: string,
    userId: string,
    input: UpdateMileageInput,
    mileageRate: number = DEFAULT_MILEAGE_RATE
  ): Promise<MileageTracking> {
    const updateData: Record<string, unknown> = {};

    if (input.trackingDate !== undefined) {
      updateData.tracking_date = input.trackingDate;
    }
    if (input.destinationPostcode !== undefined) {
      updateData.destination_postcode = input.destinationPostcode;
    }
    if (input.milesTravelled !== undefined) {
      updateData.miles_travelled = input.milesTravelled;
    }
    if (input.amountClaimed !== undefined) {
      updateData.amount_claimed = input.amountClaimed;
    }
    if (input.reason !== undefined) {
      updateData.reason = input.reason;
    }
    if (input.expenseType !== undefined) {
      updateData.expense_type = input.expenseType;
    }
    if (input.notes !== undefined) {
      updateData.notes = input.notes;
    }

    // If miles changed and amount wasn't explicitly set, recalculate for mileage type
    if (
      input.milesTravelled !== undefined &&
      input.amountClaimed === undefined &&
      input.expenseType === 'mileage'
    ) {
      updateData.amount_claimed = this.calculateMileageCost(input.milesTravelled, mileageRate);
    }

    return this.mileageRepo.updateEntry(id, userId, updateData);
  }

  /**
   * Delete a mileage entry
   */
  async deleteMileageEntry(id: string, userId: string): Promise<void> {
    return this.mileageRepo.deleteEntry(id, userId);
  }

  /**
   * Get mileage entry by ID
   */
  async getMileageEntry(id: string): Promise<MileageTracking | null> {
    return this.mileageRepo.findById(id);
  }

  /**
   * Get all mileage entries for a purchase with summary
   */
  async getMileageForPurchase(purchaseId: string): Promise<PurchaseMileageSummary> {
    const entries = await this.mileageRepo.findByPurchaseId(purchaseId);

    let totalMiles = 0;
    let totalMileageCost = 0;
    let totalOtherCosts = 0;

    for (const entry of entries) {
      if (entry.expense_type === 'mileage') {
        totalMiles += entry.miles_travelled;
        totalMileageCost += entry.amount_claimed;
      } else {
        totalOtherCosts += entry.amount_claimed;
      }
    }

    return {
      entries,
      totalMiles,
      totalMileageCost,
      totalOtherCosts,
      totalCost: totalMileageCost + totalOtherCosts,
    };
  }

  /**
   * Get mileage entries for a user within a date range
   */
  async getMileageForPeriod(
    userId: string,
    dateFrom: string,
    dateTo: string,
    page?: number,
    pageSize?: number
  ) {
    return this.mileageRepo.findByDateRange(userId, dateFrom, dateTo, { page, pageSize });
  }

  /**
   * Get mileage totals for a period
   */
  async getTotalsForPeriod(userId: string, dateFrom: string, dateTo: string) {
    return this.mileageRepo.getTotalForPeriod(userId, dateFrom, dateTo);
  }

  /**
   * Get mileage summary by expense type
   */
  async getSummaryByType(userId: string, dateFrom: string, dateTo: string) {
    return this.mileageRepo.getSummaryByType(userId, dateFrom, dateTo);
  }

  /**
   * Get user's configured mileage rate from report settings
   * Falls back to HMRC default rate if not configured
   */
  async getUserMileageRate(userId: string): Promise<number> {
    const { data, error } = await this.supabase
      .from('user_settings')
      .select('report_settings')
      .eq('user_id', userId)
      .single();

    if (error || !data?.report_settings) {
      return DEFAULT_MILEAGE_RATE;
    }

    const settings = data.report_settings as Record<string, unknown>;
    return (settings.mileageRate as number) ?? DEFAULT_MILEAGE_RATE;
  }
}
