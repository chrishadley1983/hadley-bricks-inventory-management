/**
 * Profit Calculation Service
 *
 * Provides profit analysis and reporting functionality.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@hadley-bricks/database';
import { SalesRepository } from '../repositories/sales.repository';

/**
 * Daily profit summary
 */
export interface DailyProfitSummary {
  date: string;
  sales: number;
  revenue: number;
  costs: number;
  profit: number;
  margin: number;
}

/**
 * Monthly profit summary
 */
export interface MonthlyProfitSummary {
  year: number;
  month: number;
  monthName: string;
  sales: number;
  revenue: number;
  costs: number;
  profit: number;
  margin: number;
}

/**
 * Platform profit breakdown
 */
export interface PlatformProfitBreakdown {
  platform: string;
  sales: number;
  revenue: number;
  fees: number;
  costOfGoods: number;
  shippingCosts: number;
  otherCosts: number;
  profit: number;
  margin: number;
}

/**
 * Overall profit metrics
 */
export interface ProfitMetrics {
  totalSales: number;
  totalRevenue: number;
  totalCostOfGoods: number;
  totalFees: number;
  totalShippingCosts: number;
  totalOtherCosts: number;
  totalProfit: number;
  averageMargin: number;
  averageOrderValue: number;
  averageProfit: number;
}

/**
 * Date range for queries
 */
export interface DateRange {
  startDate: Date;
  endDate: Date;
}

const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

/**
 * Internal type for sale query results
 */
interface SaleQueryResult {
  sale_date: string;
  sale_amount: number | null;
  shipping_charged: number | null;
  platform_fees: number | null;
  cost_of_goods: number | null;
  shipping_cost: number | null;
  other_costs: number | null;
  gross_profit: number | null;
  platform?: string | null;
}

/**
 * Internal type for sale item query results
 */
interface SaleItemQueryResult {
  item_number: string;
  item_name: string | null;
  quantity: number | null;
  total_price: number | null;
  unit_cost: number | null;
}

export class ProfitService {
  private salesRepo: SalesRepository;

  constructor(private supabase: SupabaseClient<Database>) {
    this.salesRepo = new SalesRepository(supabase);
  }

  /**
   * Calculate profit metrics for a date range
   */
  async getMetrics(userId: string, dateRange?: DateRange): Promise<ProfitMetrics> {
    let query = this.supabase
      .from('sales')
      .select(
        'sale_amount, shipping_charged, platform_fees, cost_of_goods, shipping_cost, other_costs, gross_profit'
      )
      .eq('user_id', userId);

    if (dateRange) {
      query = query
        .gte('sale_date', dateRange.startDate.toISOString().split('T')[0])
        .lte('sale_date', dateRange.endDate.toISOString().split('T')[0]);
    }

    const { data, error } = await query;

    if (error) {
      throw new Error(`Failed to get profit metrics: ${error.message}`);
    }

    interface SaleMetrics {
      sale_amount: number | null;
      shipping_charged: number | null;
      platform_fees: number | null;
      cost_of_goods: number | null;
      shipping_cost: number | null;
      other_costs: number | null;
      gross_profit: number | null;
    }

    const sales = (data || []) as SaleMetrics[];

    let totalRevenue = 0;
    let totalCostOfGoods = 0;
    let totalFees = 0;
    let totalShippingCosts = 0;
    let totalOtherCosts = 0;
    let totalProfit = 0;

    for (const sale of sales) {
      totalRevenue += (sale.sale_amount || 0) + (sale.shipping_charged || 0);
      totalCostOfGoods += sale.cost_of_goods || 0;
      totalFees += sale.platform_fees || 0;
      totalShippingCosts += sale.shipping_cost || 0;
      totalOtherCosts += sale.other_costs || 0;
      totalProfit += sale.gross_profit || 0;
    }

    const totalSales = sales.length;
    const averageMargin = totalRevenue > 0 ? (totalProfit / totalRevenue) * 100 : 0;

    return {
      totalSales,
      totalRevenue,
      totalCostOfGoods,
      totalFees,
      totalShippingCosts,
      totalOtherCosts,
      totalProfit,
      averageMargin,
      averageOrderValue: totalSales > 0 ? totalRevenue / totalSales : 0,
      averageProfit: totalSales > 0 ? totalProfit / totalSales : 0,
    };
  }

  /**
   * Get daily profit summary for a date range
   */
  async getDailyProfitSummary(userId: string, dateRange: DateRange): Promise<DailyProfitSummary[]> {
    const { data, error } = await this.supabase
      .from('sales')
      .select(
        'sale_date, sale_amount, shipping_charged, platform_fees, cost_of_goods, shipping_cost, other_costs, gross_profit'
      )
      .eq('user_id', userId)
      .gte('sale_date', dateRange.startDate.toISOString().split('T')[0])
      .lte('sale_date', dateRange.endDate.toISOString().split('T')[0])
      .order('sale_date', { ascending: true });

    if (error) {
      throw new Error(`Failed to get daily profit: ${error.message}`);
    }

    // Group by date
    const dailyMap = new Map<string, DailyProfitSummary>();
    const sales = (data || []) as SaleQueryResult[];

    for (const sale of sales) {
      const date = sale.sale_date;
      const existing = dailyMap.get(date) || {
        date,
        sales: 0,
        revenue: 0,
        costs: 0,
        profit: 0,
        margin: 0,
      };

      const revenue = (sale.sale_amount || 0) + (sale.shipping_charged || 0);
      const costs =
        (sale.cost_of_goods || 0) +
        (sale.platform_fees || 0) +
        (sale.shipping_cost || 0) +
        (sale.other_costs || 0);

      existing.sales++;
      existing.revenue += revenue;
      existing.costs += costs;
      existing.profit += sale.gross_profit || 0;

      dailyMap.set(date, existing);
    }

    // Calculate margins
    const result = Array.from(dailyMap.values()).map((day) => ({
      ...day,
      margin: day.revenue > 0 ? (day.profit / day.revenue) * 100 : 0,
    }));

    return result;
  }

  /**
   * Get monthly profit summary for a year
   */
  async getMonthlyProfitSummary(userId: string, year: number): Promise<MonthlyProfitSummary[]> {
    const startDate = `${year}-01-01`;
    const endDate = `${year}-12-31`;

    const { data, error } = await this.supabase
      .from('sales')
      .select(
        'sale_date, sale_amount, shipping_charged, platform_fees, cost_of_goods, shipping_cost, other_costs, gross_profit'
      )
      .eq('user_id', userId)
      .gte('sale_date', startDate)
      .lte('sale_date', endDate);

    if (error) {
      throw new Error(`Failed to get monthly profit: ${error.message}`);
    }

    // Initialize all months
    const monthlyData: MonthlyProfitSummary[] = MONTH_NAMES.map((monthName, index) => ({
      year,
      month: index + 1,
      monthName,
      sales: 0,
      revenue: 0,
      costs: 0,
      profit: 0,
      margin: 0,
    }));

    const sales = (data || []) as SaleQueryResult[];
    for (const sale of sales) {
      const saleDate = new Date(sale.sale_date);
      const monthIndex = saleDate.getMonth();

      const revenue = (sale.sale_amount || 0) + (sale.shipping_charged || 0);
      const costs =
        (sale.cost_of_goods || 0) +
        (sale.platform_fees || 0) +
        (sale.shipping_cost || 0) +
        (sale.other_costs || 0);

      monthlyData[monthIndex].sales++;
      monthlyData[monthIndex].revenue += revenue;
      monthlyData[monthIndex].costs += costs;
      monthlyData[monthIndex].profit += sale.gross_profit || 0;
    }

    // Calculate margins
    return monthlyData.map((month) => ({
      ...month,
      margin: month.revenue > 0 ? (month.profit / month.revenue) * 100 : 0,
    }));
  }

  /**
   * Get profit breakdown by platform
   */
  async getPlatformBreakdown(
    userId: string,
    dateRange?: DateRange
  ): Promise<PlatformProfitBreakdown[]> {
    let query = this.supabase
      .from('sales')
      .select(
        'platform, sale_amount, shipping_charged, platform_fees, cost_of_goods, shipping_cost, other_costs, gross_profit'
      )
      .eq('user_id', userId);

    if (dateRange) {
      query = query
        .gte('sale_date', dateRange.startDate.toISOString().split('T')[0])
        .lte('sale_date', dateRange.endDate.toISOString().split('T')[0]);
    }

    const { data, error } = await query;

    if (error) {
      throw new Error(`Failed to get platform breakdown: ${error.message}`);
    }

    // Group by platform
    const platformMap = new Map<string, PlatformProfitBreakdown>();
    const sales = (data || []) as SaleQueryResult[];

    for (const sale of sales) {
      const platform = sale.platform || 'Unknown';
      const existing = platformMap.get(platform) || {
        platform,
        sales: 0,
        revenue: 0,
        fees: 0,
        costOfGoods: 0,
        shippingCosts: 0,
        otherCosts: 0,
        profit: 0,
        margin: 0,
      };

      const revenue = (sale.sale_amount || 0) + (sale.shipping_charged || 0);

      existing.sales++;
      existing.revenue += revenue;
      existing.fees += sale.platform_fees || 0;
      existing.costOfGoods += sale.cost_of_goods || 0;
      existing.shippingCosts += sale.shipping_cost || 0;
      existing.otherCosts += sale.other_costs || 0;
      existing.profit += sale.gross_profit || 0;

      platformMap.set(platform, existing);
    }

    // Calculate margins and sort by profit
    return Array.from(platformMap.values())
      .map((platform) => ({
        ...platform,
        margin: platform.revenue > 0 ? (platform.profit / platform.revenue) * 100 : 0,
      }))
      .sort((a, b) => b.profit - a.profit);
  }

  /**
   * Get rolling 12-month turnover
   */
  async getRolling12MonthTurnover(userId: string): Promise<number> {
    const endDate = new Date();
    const startDate = new Date();
    startDate.setFullYear(startDate.getFullYear() - 1);

    const metrics = await this.getMetrics(userId, { startDate, endDate });
    return metrics.totalRevenue;
  }

  /**
   * Get year-over-year comparison
   */
  async getYearOverYearComparison(
    userId: string,
    currentYear: number
  ): Promise<{
    currentYear: ProfitMetrics;
    previousYear: ProfitMetrics;
    revenueChange: number;
    profitChange: number;
    marginChange: number;
  }> {
    const currentYearStart = new Date(`${currentYear}-01-01`);
    const currentYearEnd = new Date(`${currentYear}-12-31`);
    const previousYearStart = new Date(`${currentYear - 1}-01-01`);
    const previousYearEnd = new Date(`${currentYear - 1}-12-31`);

    const [currentMetrics, previousMetrics] = await Promise.all([
      this.getMetrics(userId, { startDate: currentYearStart, endDate: currentYearEnd }),
      this.getMetrics(userId, { startDate: previousYearStart, endDate: previousYearEnd }),
    ]);

    const revenueChange =
      previousMetrics.totalRevenue > 0
        ? ((currentMetrics.totalRevenue - previousMetrics.totalRevenue) /
            previousMetrics.totalRevenue) *
          100
        : 0;

    const profitChange =
      previousMetrics.totalProfit > 0
        ? ((currentMetrics.totalProfit - previousMetrics.totalProfit) /
            previousMetrics.totalProfit) *
          100
        : 0;

    const marginChange = currentMetrics.averageMargin - previousMetrics.averageMargin;

    return {
      currentYear: currentMetrics,
      previousYear: previousMetrics,
      revenueChange,
      profitChange,
      marginChange,
    };
  }

  /**
   * Get top profitable items
   */
  async getTopProfitableItems(
    userId: string,
    limit: number = 10,
    dateRange?: DateRange
  ): Promise<
    Array<{
      itemNumber: string;
      itemName: string;
      quantity: number;
      revenue: number;
      cost: number;
      profit: number;
      margin: number;
    }>
  > {
    let query = this.supabase
      .from('sale_items')
      .select(
        `
        item_number,
        item_name,
        quantity,
        total_price,
        unit_cost,
        sale:sales!inner(user_id, sale_date)
      `
      )
      .eq('sale.user_id', userId);

    if (dateRange) {
      query = query
        .gte('sale.sale_date', dateRange.startDate.toISOString().split('T')[0])
        .lte('sale.sale_date', dateRange.endDate.toISOString().split('T')[0]);
    }

    const { data, error } = await query;

    if (error) {
      throw new Error(`Failed to get top items: ${error.message}`);
    }

    // Aggregate by item
    const itemMap = new Map<
      string,
      {
        itemNumber: string;
        itemName: string;
        quantity: number;
        revenue: number;
        cost: number;
      }
    >();

    const items = (data || []) as SaleItemQueryResult[];
    for (const item of items) {
      const key = item.item_number;
      const existing = itemMap.get(key) || {
        itemNumber: item.item_number,
        itemName: item.item_name || 'Unknown',
        quantity: 0,
        revenue: 0,
        cost: 0,
      };

      existing.quantity += item.quantity || 1;
      existing.revenue += item.total_price || 0;
      existing.cost += (item.unit_cost || 0) * (item.quantity || 1);

      itemMap.set(key, existing);
    }

    // Calculate profit and sort
    return Array.from(itemMap.values())
      .map((item) => {
        const profit = item.revenue - item.cost;
        return {
          ...item,
          profit,
          margin: item.revenue > 0 ? (profit / item.revenue) * 100 : 0,
        };
      })
      .sort((a, b) => b.profit - a.profit)
      .slice(0, limit);
  }
}
