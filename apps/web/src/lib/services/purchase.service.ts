import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database, PurchaseInsert, PurchaseUpdate, Purchase } from '@hadley-bricks/database';
import {
  PurchaseRepository,
  PurchaseFilters,
  PaginationOptions,
  PaginatedResult,
} from '../repositories';

/**
 * Service for purchase business logic.
 * Wraps the repository and adds business rules.
 */
export class PurchaseService {
  private repository: PurchaseRepository;
  private userId: string;

  constructor(supabase: SupabaseClient<Database>, userId: string) {
    this.repository = new PurchaseRepository(supabase);
    this.userId = userId;
  }

  /**
   * Get a single purchase by ID
   */
  async getById(id: string): Promise<Purchase | null> {
    return this.repository.findById(id);
  }

  /**
   * Get all purchases with optional filters and pagination
   */
  async getAll(
    filters?: PurchaseFilters,
    pagination?: PaginationOptions
  ): Promise<PaginatedResult<Purchase>> {
    return this.repository.findAllFiltered(filters, pagination);
  }

  /**
   * Create a new purchase
   */
  async create(input: Omit<PurchaseInsert, 'user_id'>): Promise<Purchase> {
    const purchaseWithUser: PurchaseInsert = {
      ...input,
      user_id: this.userId,
    };

    return this.repository.create(purchaseWithUser);
  }

  /**
   * Update a purchase
   */
  async update(id: string, input: PurchaseUpdate): Promise<Purchase> {
    return this.repository.update(id, input);
  }

  /**
   * Delete a purchase
   */
  async delete(id: string): Promise<void> {
    return this.repository.delete(id);
  }

  /**
   * Get recent purchases
   */
  async getRecent(limit: number = 10): Promise<Purchase[]> {
    return this.repository.getRecent(limit);
  }

  /**
   * Get purchases within a date range
   */
  async getByDateRange(
    dateFrom: string,
    dateTo: string,
    pagination?: PaginationOptions
  ): Promise<PaginatedResult<Purchase>> {
    return this.repository.findByDateRange(dateFrom, dateTo, pagination);
  }

  /**
   * Get total spent in current month
   */
  async getCurrentMonthTotal(): Promise<number> {
    const now = new Date();
    return this.repository.getMonthlyTotal(now.getFullYear(), now.getMonth() + 1);
  }

  /**
   * Get total spent in a specific month
   */
  async getMonthlyTotal(year: number, month: number): Promise<number> {
    return this.repository.getMonthlyTotal(year, month);
  }

  /**
   * Get rolling 12-month purchase total
   */
  async getRolling12MonthTotal(): Promise<number> {
    return this.repository.getRolling12MonthTotal();
  }

  /**
   * Get purchases grouped by source with totals
   */
  async getTotalsBySource(): Promise<Record<string, number>> {
    return this.repository.getTotalsBySource();
  }

  /**
   * Get purchase summary statistics
   */
  async getSummary(): Promise<{
    currentMonthTotal: number;
    rolling12MonthTotal: number;
    bySource: Record<string, number>;
    recentPurchases: Purchase[];
  }> {
    const [currentMonthTotal, rolling12MonthTotal, bySource, recentPurchases] = await Promise.all([
      this.getCurrentMonthTotal(),
      this.getRolling12MonthTotal(),
      this.getTotalsBySource(),
      this.getRecent(5),
    ]);

    return {
      currentMonthTotal,
      rolling12MonthTotal,
      bySource,
      recentPurchases,
    };
  }
}
