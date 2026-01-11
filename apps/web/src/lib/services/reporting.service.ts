/**
 * Reporting Service
 *
 * Centralized service for all financial reporting queries.
 * Provides efficient aggregation and date range handling.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@hadley-bricks/database';

/**
 * Date range for reports
 */
export interface DateRange {
  startDate: Date;
  endDate: Date;
}

/**
 * Standard date range presets
 */
export type DateRangePreset =
  | 'this_month'
  | 'last_month'
  | 'this_quarter'
  | 'last_quarter'
  | 'this_year'
  | 'last_year'
  | 'last_30_days'
  | 'last_90_days'
  | 'last_12_months'
  | 'custom';

/**
 * P&L Report data structure
 */
export interface ProfitLossReport {
  period: DateRange;
  previousPeriod?: DateRange;

  // Current period metrics
  totalRevenue: number;
  shippingIncome: number;
  grossRevenue: number;
  costOfGoodsSold: number;
  grossProfit: number;
  platformFees: number;
  shippingCosts: number;
  otherCosts: number;
  netProfit: number;
  profitMargin: number;

  // Previous period comparison (optional)
  previousRevenue?: number;
  previousProfit?: number;
  previousMargin?: number;
  revenueChange?: number;
  profitChange?: number;
  marginChange?: number;

  // Breakdown by platform
  platformBreakdown: Array<{
    platform: string;
    revenue: number;
    fees: number;
    shipping: number;
    profit: number;
    margin: number;
    orderCount: number;
  }>;

  // Monthly breakdown
  monthlyBreakdown: Array<{
    month: string;
    revenue: number;
    profit: number;
    margin: number;
    orderCount: number;
  }>;
}

/**
 * Inventory Valuation data structure
 */
export interface InventoryValuationReport {
  summary: {
    totalItems: number;
    totalCostValue: number;
    estimatedSaleValue: number;
    potentialProfit: number;
    potentialMargin: number;
  };

  byCondition: Array<{
    condition: string;
    itemCount: number;
    costValue: number;
    saleValue: number;
    potentialProfit: number;
  }>;

  byStatus: Array<{
    status: string;
    itemCount: number;
    costValue: number;
    saleValue: number;
  }>;

  topValueItems: Array<{
    id: string;
    setNumber: string;
    itemName: string;
    condition: string;
    status: string;
    cost: number;
    listingValue: number;
    potentialProfit: number;
    daysInStock: number;
  }>;
}

/**
 * Inventory Aging data structure
 */
export interface InventoryAgingReport {
  brackets: Array<{
    bracket: string;
    minDays: number;
    maxDays: number | null;
    itemCount: number;
    totalCostValue: number;
    potentialRevenueImpact: number;
    percentOfTotal: number;
    items?: Array<{
      id: string;
      setNumber: string;
      itemName: string;
      daysInStock: number;
      cost: number;
      listingValue: number;
      status: string;
      condition: string;
    }>;
  }>;

  totalItems: number;
  totalValue: number;
  totalPotentialRevenue: number;
  averageDaysInStock: number;
  itemsOver180Days: number;
  valueOver180Days: number;
}

/**
 * Platform Performance data structure
 */
export interface PlatformPerformanceReport {
  period: DateRange;

  platforms: Array<{
    platform: string;
    orderCount: number;
    itemsSold: number;
    revenue: number;
    fees: number;
    netRevenue: number;
    avgOrderValue: number;
    profitMargin: number;
  }>;

  trends: Array<{
    month: string;
    data: Record<string, number>; // platform -> revenue
  }>;

  totals: {
    totalOrders: number;
    totalRevenue: number;
    totalFees: number;
    avgOrderValue: number;
  };
}

/**
 * Sales Trends data structure
 */
export interface SalesTrendsReport {
  period: DateRange;
  granularity: 'daily' | 'weekly' | 'monthly';

  data: Array<{
    date: string;
    label: string;
    revenue: number;
    profit: number;
    orderCount: number;
    avgOrderValue: number;
  }>;

  previousPeriod?: Array<{
    date: string;
    label: string;
    revenue: number;
    profit: number;
    orderCount: number;
  }>;

  summary: {
    totalRevenue: number;
    totalProfit: number;
    totalOrders: number;
    peakDay: string;
    peakRevenue: number;
    avgDailyRevenue: number;
  };
}

/**
 * Purchase Analysis data structure
 */
export interface PurchaseAnalysisReport {
  period: DateRange;

  summary: {
    totalSpent: number;
    itemsAcquired: number;
    avgCostPerItem: number;
    itemsSold: number;
    revenueFromSold: number;
    totalProfit: number;
    overallROI: number;
    totalMileage: number;
    totalMileageCost: number;
  };

  bySource: Array<{
    source: string;
    purchaseCount: number;
    totalSpent: number;
    itemsAcquired: number;
    itemsSold: number;
    revenue: number;
    profit: number;
    roi: number;
    avgMileage: number;
  }>;

  purchases: Array<{
    id: string;
    date: string;
    description: string;
    source: string;
    cost: number;
    itemCount: number;
    soldCount: number;
    revenue: number;
    profit: number;
    roi: number;
    mileage: number | null;
    mileageCost: number;
  }>;
}

/**
 * Report Settings
 */
export interface ReportSettings {
  financialYearStartMonth: number;
  defaultCurrency: string;
  mileageRate: number;
  businessName: string | null;
  businessAddress: string | null;
  showPreviousPeriodComparison: boolean;
  dailyListingTarget: number;
}

/**
 * Store status type - O=Open, C=Closed, H=Holiday
 */
export type StoreStatus = 'O' | 'C' | 'H';

/**
 * Platform identifier for daily activity
 */
export type ActivityPlatform = 'amazon' | 'ebay' | 'bricklink';

/**
 * Store status record
 */
export interface StoreStatusRecord {
  id: string;
  date: string;
  platform: ActivityPlatform;
  status: StoreStatus;
}

/**
 * Daily activity data for a single platform
 */
export interface DailyPlatformData {
  platform: ActivityPlatform;
  itemsListed: number;
  listingValue: number;
  itemsSold: number;
  soldValue: number;
  storeStatus: StoreStatus | null;
}

/**
 * Daily activity row - one row per day with all platform data
 */
export interface DailyActivityRow {
  date: string;
  dateLabel: string;
  platforms: Record<ActivityPlatform, DailyPlatformData>;
  totals: {
    itemsListed: number;
    listingValue: number;
    itemsSold: number;
    soldValue: number;
  };
}

/**
 * Monthly activity row - aggregated data for a month
 */
export interface MonthlyActivityRow {
  month: string;
  monthLabel: string;
  platforms: Record<ActivityPlatform, {
    itemsListed: number;
    listingValue: number;
    itemsSold: number;
    soldValue: number;
  }>;
  totals: {
    itemsListed: number;
    listingValue: number;
    itemsSold: number;
    soldValue: number;
  };
}

/**
 * Daily Activity Report data structure
 */
export interface DailyActivityReport {
  period: DateRange;
  granularity: 'daily' | 'monthly';

  // Data rows (daily or monthly based on granularity)
  data: DailyActivityRow[] | MonthlyActivityRow[];

  // Summary totals for the entire period
  summary: {
    platforms: Record<ActivityPlatform, {
      totalItemsListed: number;
      totalListingValue: number;
      totalItemsSold: number;
      totalSoldValue: number;
    }>;
    grandTotals: {
      totalItemsListed: number;
      totalListingValue: number;
      totalItemsSold: number;
      totalSoldValue: number;
    };
  };
}

/**
 * Store status update input
 */
export interface UpdateStoreStatusInput {
  date: string;
  platform: ActivityPlatform;
  status: StoreStatus;
}

// Helper types for database queries
interface SaleQueryRow {
  sale_date: string;
  platform: string | null;
  sale_amount: number | null;
  shipping_charged: number | null;
  platform_fees: number | null;
  cost_of_goods: number | null;
  shipping_cost: number | null;
  other_costs: number | null;
  gross_profit: number | null;
}

interface InventoryQueryRow {
  id: string;
  set_number: string;
  item_name: string | null;
  condition: string | null;
  status: string | null;
  cost: number | null;
  listing_value: number | null;
  purchase_date: string | null;
  created_at: string;
}

interface PurchaseQueryRow {
  id: string;
  purchase_date: string;
  short_description: string;
  cost: number;
  source: string | null;
}

export class ReportingService {
  constructor(private supabase: SupabaseClient<Database>) {}

  /**
   * Get date range from preset
   */
  getDateRangeFromPreset(preset: DateRangePreset, customRange?: DateRange): DateRange {
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

    switch (preset) {
      case 'this_month': {
        const start = new Date(today.getFullYear(), today.getMonth(), 1);
        const end = new Date(today.getFullYear(), today.getMonth() + 1, 0);
        return { startDate: start, endDate: end };
      }
      case 'last_month': {
        const start = new Date(today.getFullYear(), today.getMonth() - 1, 1);
        const end = new Date(today.getFullYear(), today.getMonth(), 0);
        return { startDate: start, endDate: end };
      }
      case 'this_quarter': {
        const quarterStart = Math.floor(today.getMonth() / 3) * 3;
        const start = new Date(today.getFullYear(), quarterStart, 1);
        const end = new Date(today.getFullYear(), quarterStart + 3, 0);
        return { startDate: start, endDate: end };
      }
      case 'last_quarter': {
        const quarterStart = Math.floor(today.getMonth() / 3) * 3 - 3;
        const year = quarterStart < 0 ? today.getFullYear() - 1 : today.getFullYear();
        const start = new Date(year, quarterStart < 0 ? quarterStart + 12 : quarterStart, 1);
        const end = new Date(year, (quarterStart < 0 ? quarterStart + 12 : quarterStart) + 3, 0);
        return { startDate: start, endDate: end };
      }
      case 'this_year': {
        const start = new Date(today.getFullYear(), 0, 1);
        const end = new Date(today.getFullYear(), 11, 31);
        return { startDate: start, endDate: end };
      }
      case 'last_year': {
        const start = new Date(today.getFullYear() - 1, 0, 1);
        const end = new Date(today.getFullYear() - 1, 11, 31);
        return { startDate: start, endDate: end };
      }
      case 'last_30_days': {
        const start = new Date(today);
        start.setDate(start.getDate() - 30);
        return { startDate: start, endDate: today };
      }
      case 'last_90_days': {
        const start = new Date(today);
        start.setDate(start.getDate() - 90);
        return { startDate: start, endDate: today };
      }
      case 'last_12_months': {
        const start = new Date(today);
        start.setFullYear(start.getFullYear() - 1);
        return { startDate: start, endDate: today };
      }
      case 'custom':
        if (!customRange) {
          throw new Error('Custom range requires startDate and endDate');
        }
        return customRange;
      default:
        return { startDate: today, endDate: today };
    }
  }

  /**
   * Get previous period for comparison
   */
  getPreviousPeriod(current: DateRange): DateRange {
    const duration = current.endDate.getTime() - current.startDate.getTime();
    const prevEnd = new Date(current.startDate.getTime() - 1);
    const prevStart = new Date(prevEnd.getTime() - duration);
    return { startDate: prevStart, endDate: prevEnd };
  }

  /**
   * Format date for SQL query
   */
  private formatDate(date: Date): string {
    return date.toISOString().split('T')[0];
  }

  /**
   * Get Profit & Loss Report
   */
  async getProfitLossReport(
    userId: string,
    dateRange: DateRange,
    includeComparison: boolean = true
  ): Promise<ProfitLossReport> {
    const startDate = this.formatDate(dateRange.startDate);
    const endDate = this.formatDate(dateRange.endDate);

    // Fetch sales data for current period
    const { data: salesData, error: salesError } = await this.supabase
      .from('sales')
      .select(
        'sale_date, platform, sale_amount, shipping_charged, platform_fees, cost_of_goods, shipping_cost, other_costs, gross_profit'
      )
      .eq('user_id', userId)
      .gte('sale_date', startDate)
      .lte('sale_date', endDate);

    if (salesError) {
      throw new Error(`Failed to fetch sales data: ${salesError.message}`);
    }

    const sales = (salesData || []) as SaleQueryRow[];

    // Calculate totals
    let totalRevenue = 0;
    let shippingIncome = 0;
    let costOfGoodsSold = 0;
    let platformFees = 0;
    let shippingCosts = 0;
    let otherCosts = 0;

    const platformMap = new Map<
      string,
      {
        revenue: number;
        fees: number;
        shipping: number;
        profit: number;
        orderCount: number;
      }
    >();
    const monthlyMap = new Map<
      string,
      { revenue: number; profit: number; orderCount: number }
    >();

    for (const sale of sales) {
      const revenue = sale.sale_amount || 0;
      const shipping = sale.shipping_charged || 0;
      const fees = sale.platform_fees || 0;
      const cogs = sale.cost_of_goods || 0;
      const shipCost = sale.shipping_cost || 0;
      const other = sale.other_costs || 0;
      const profit = sale.gross_profit || 0;

      totalRevenue += revenue;
      shippingIncome += shipping;
      costOfGoodsSold += cogs;
      platformFees += fees;
      shippingCosts += shipCost;
      otherCosts += other;

      // Platform breakdown
      const platform = sale.platform || 'Unknown';
      const platformData = platformMap.get(platform) || {
        revenue: 0,
        fees: 0,
        shipping: 0,
        profit: 0,
        orderCount: 0,
      };
      platformData.revenue += revenue + shipping;
      platformData.fees += fees;
      platformData.shipping += shipCost;
      platformData.profit += profit;
      platformData.orderCount++;
      platformMap.set(platform, platformData);

      // Monthly breakdown
      const month = sale.sale_date.substring(0, 7); // YYYY-MM
      const monthData = monthlyMap.get(month) || { revenue: 0, profit: 0, orderCount: 0 };
      monthData.revenue += revenue + shipping;
      monthData.profit += profit;
      monthData.orderCount++;
      monthlyMap.set(month, monthData);
    }

    const grossRevenue = totalRevenue + shippingIncome;
    const grossProfit = grossRevenue - costOfGoodsSold;
    const netProfit = grossProfit - platformFees - shippingCosts - otherCosts;
    const profitMargin = grossRevenue > 0 ? (netProfit / grossRevenue) * 100 : 0;

    // Platform breakdown array
    const platformBreakdown = Array.from(platformMap.entries())
      .map(([platform, data]) => ({
        platform,
        revenue: data.revenue,
        fees: data.fees,
        shipping: data.shipping,
        profit: data.profit,
        margin: data.revenue > 0 ? (data.profit / data.revenue) * 100 : 0,
        orderCount: data.orderCount,
      }))
      .sort((a, b) => b.revenue - a.revenue);

    // Monthly breakdown array
    const monthlyBreakdown = Array.from(monthlyMap.entries())
      .map(([month, data]) => ({
        month,
        revenue: data.revenue,
        profit: data.profit,
        margin: data.revenue > 0 ? (data.profit / data.revenue) * 100 : 0,
        orderCount: data.orderCount,
      }))
      .sort((a, b) => a.month.localeCompare(b.month));

    const report: ProfitLossReport = {
      period: dateRange,
      totalRevenue,
      shippingIncome,
      grossRevenue,
      costOfGoodsSold,
      grossProfit,
      platformFees,
      shippingCosts,
      otherCosts,
      netProfit,
      profitMargin,
      platformBreakdown,
      monthlyBreakdown,
    };

    // Fetch previous period data for comparison
    if (includeComparison) {
      const prevPeriod = this.getPreviousPeriod(dateRange);
      const prevStartDate = this.formatDate(prevPeriod.startDate);
      const prevEndDate = this.formatDate(prevPeriod.endDate);

      const { data: prevData } = await this.supabase
        .from('sales')
        .select('sale_amount, shipping_charged, gross_profit')
        .eq('user_id', userId)
        .gte('sale_date', prevStartDate)
        .lte('sale_date', prevEndDate);

      if (prevData && prevData.length > 0) {
        interface PrevSaleRow {
          sale_amount: number | null;
          shipping_charged: number | null;
          gross_profit: number | null;
        }
        const prevSales = prevData as PrevSaleRow[];
        let prevRevenue = 0;
        let prevProfit = 0;

        for (const sale of prevSales) {
          prevRevenue += (sale.sale_amount || 0) + (sale.shipping_charged || 0);
          prevProfit += sale.gross_profit || 0;
        }

        const prevMargin = prevRevenue > 0 ? (prevProfit / prevRevenue) * 100 : 0;

        report.previousPeriod = prevPeriod;
        report.previousRevenue = prevRevenue;
        report.previousProfit = prevProfit;
        report.previousMargin = prevMargin;
        report.revenueChange = prevRevenue > 0 ? ((grossRevenue - prevRevenue) / prevRevenue) * 100 : 0;
        report.profitChange = prevProfit > 0 ? ((netProfit - prevProfit) / prevProfit) * 100 : 0;
        report.marginChange = profitMargin - prevMargin;
      }
    }

    return report;
  }

  /**
   * Get Inventory Valuation Report
   */
  async getInventoryValuationReport(userId: string): Promise<InventoryValuationReport> {
    const { data: inventoryData, error } = await this.supabase
      .from('inventory_items')
      .select('id, set_number, item_name, condition, status, cost, listing_value, purchase_date, created_at')
      .eq('user_id', userId)
      .in('status', ['IN STOCK', 'LISTED', 'NOT YET RECEIVED']);

    if (error) {
      throw new Error(`Failed to fetch inventory: ${error.message}`);
    }

    const items = (inventoryData || []) as InventoryQueryRow[];

    // Calculate totals
    let totalItems = 0;
    let totalCostValue = 0;
    let estimatedSaleValue = 0;

    const conditionMap = new Map<string, { count: number; cost: number; sale: number }>();
    const statusMap = new Map<string, { count: number; cost: number; sale: number }>();
    const topItems: InventoryValuationReport['topValueItems'] = [];

    for (const item of items) {
      const cost = item.cost || 0;
      const saleValue = item.listing_value || cost * 1.5; // Estimate if no listing value
      const condition = item.condition || 'Unknown';
      const status = item.status || 'Unknown';

      totalItems++;
      totalCostValue += cost;
      estimatedSaleValue += saleValue;

      // Condition breakdown
      const condData = conditionMap.get(condition) || { count: 0, cost: 0, sale: 0 };
      condData.count++;
      condData.cost += cost;
      condData.sale += saleValue;
      conditionMap.set(condition, condData);

      // Status breakdown
      const statData = statusMap.get(status) || { count: 0, cost: 0, sale: 0 };
      statData.count++;
      statData.cost += cost;
      statData.sale += saleValue;
      statusMap.set(status, statData);

      // Calculate days in stock
      const baseDate = item.purchase_date
        ? new Date(item.purchase_date)
        : new Date(item.created_at);
      const daysInStock = Math.floor(
        (Date.now() - baseDate.getTime()) / (1000 * 60 * 60 * 24)
      );

      topItems.push({
        id: item.id,
        setNumber: item.set_number,
        itemName: item.item_name || item.set_number,
        condition,
        status,
        cost,
        listingValue: saleValue,
        potentialProfit: saleValue - cost,
        daysInStock,
      });
    }

    // Sort and limit top items by value
    topItems.sort((a, b) => b.listingValue - a.listingValue);
    const top20Items = topItems.slice(0, 20);

    const potentialProfit = estimatedSaleValue - totalCostValue;
    const potentialMargin = estimatedSaleValue > 0 ? (potentialProfit / estimatedSaleValue) * 100 : 0;

    return {
      summary: {
        totalItems,
        totalCostValue,
        estimatedSaleValue,
        potentialProfit,
        potentialMargin,
      },
      byCondition: Array.from(conditionMap.entries()).map(([condition, data]) => ({
        condition,
        itemCount: data.count,
        costValue: data.cost,
        saleValue: data.sale,
        potentialProfit: data.sale - data.cost,
      })),
      byStatus: Array.from(statusMap.entries()).map(([status, data]) => ({
        status,
        itemCount: data.count,
        costValue: data.cost,
        saleValue: data.sale,
      })),
      topValueItems: top20Items,
    };
  }

  /**
   * Get Inventory Aging Report
   */
  async getInventoryAgingReport(userId: string, includeItems: boolean = false): Promise<InventoryAgingReport> {
    const { data: inventoryData, error } = await this.supabase
      .from('inventory_items')
      .select('id, set_number, item_name, condition, status, cost, listing_value, purchase_date, created_at')
      .eq('user_id', userId)
      .in('status', ['IN STOCK', 'LISTED', 'NOT YET RECEIVED']);

    if (error) {
      throw new Error(`Failed to fetch inventory: ${error.message}`);
    }

    const items = (inventoryData || []) as InventoryQueryRow[];

    // Define age brackets
    const brackets: InventoryAgingReport['brackets'] = [
      { bracket: '0-30 days', minDays: 0, maxDays: 30, itemCount: 0, totalCostValue: 0, potentialRevenueImpact: 0, percentOfTotal: 0, items: [] },
      { bracket: '31-60 days', minDays: 31, maxDays: 60, itemCount: 0, totalCostValue: 0, potentialRevenueImpact: 0, percentOfTotal: 0, items: [] },
      { bracket: '61-90 days', minDays: 61, maxDays: 90, itemCount: 0, totalCostValue: 0, potentialRevenueImpact: 0, percentOfTotal: 0, items: [] },
      { bracket: '91-180 days', minDays: 91, maxDays: 180, itemCount: 0, totalCostValue: 0, potentialRevenueImpact: 0, percentOfTotal: 0, items: [] },
      { bracket: '180+ days', minDays: 181, maxDays: null, itemCount: 0, totalCostValue: 0, potentialRevenueImpact: 0, percentOfTotal: 0, items: [] },
    ];

    let totalItems = 0;
    let totalValue = 0;
    let totalPotentialRevenue = 0;
    let totalDays = 0;
    let itemsOver180 = 0;
    let valueOver180 = 0;

    for (const item of items) {
      const cost = item.cost || 0;
      const listingValue = item.listing_value || cost * 1.5; // Estimate if no listing value
      const baseDate = item.purchase_date
        ? new Date(item.purchase_date)
        : new Date(item.created_at);
      const daysInStock = Math.floor(
        (Date.now() - baseDate.getTime()) / (1000 * 60 * 60 * 24)
      );

      totalItems++;
      totalValue += cost;
      totalPotentialRevenue += listingValue;
      totalDays += daysInStock;

      // Find appropriate bracket
      for (const bracket of brackets) {
        const inBracket =
          daysInStock >= bracket.minDays &&
          (bracket.maxDays === null || daysInStock <= bracket.maxDays);

        if (inBracket) {
          bracket.itemCount++;
          bracket.totalCostValue += cost;
          bracket.potentialRevenueImpact += listingValue;

          if (bracket.items) {
            bracket.items.push({
              id: item.id,
              setNumber: item.set_number,
              itemName: item.item_name || item.set_number,
              daysInStock,
              cost,
              listingValue,
              status: item.status || 'Unknown',
              condition: item.condition || 'Unknown',
            });
          }
          break;
        }
      }

      if (daysInStock > 180) {
        itemsOver180++;
        valueOver180 += cost;
      }
    }

    // Calculate percentages and sort items
    for (const bracket of brackets) {
      bracket.percentOfTotal = totalItems > 0 ? (bracket.itemCount / totalItems) * 100 : 0;
      // Sort items by days in stock descending
      if (bracket.items) {
        bracket.items.sort((a, b) => b.daysInStock - a.daysInStock);
      }
    }

    // Remove items arrays if not requested
    if (!includeItems) {
      for (const bracket of brackets) {
        delete bracket.items;
      }
    }

    return {
      brackets,
      totalItems,
      totalValue,
      totalPotentialRevenue,
      averageDaysInStock: totalItems > 0 ? Math.round(totalDays / totalItems) : 0,
      itemsOver180Days: itemsOver180,
      valueOver180Days: valueOver180,
    };
  }

  /**
   * Get Platform Performance Report
   */
  async getPlatformPerformanceReport(userId: string, dateRange: DateRange): Promise<PlatformPerformanceReport> {
    const startDate = this.formatDate(dateRange.startDate);
    const endDate = this.formatDate(dateRange.endDate);

    const { data: salesData, error } = await this.supabase
      .from('sales')
      .select(
        'sale_date, platform, sale_amount, shipping_charged, platform_fees, gross_profit'
      )
      .eq('user_id', userId)
      .gte('sale_date', startDate)
      .lte('sale_date', endDate);

    if (error) {
      throw new Error(`Failed to fetch sales data: ${error.message}`);
    }

    interface PlatformSaleRow {
      sale_date: string;
      platform: string | null;
      sale_amount: number | null;
      shipping_charged: number | null;
      platform_fees: number | null;
      gross_profit: number | null;
    }

    const sales = (salesData || []) as PlatformSaleRow[];

    const platformMap = new Map<
      string,
      {
        orderCount: number;
        revenue: number;
        fees: number;
        profit: number;
      }
    >();
    const trendsMap = new Map<string, Map<string, number>>(); // month -> platform -> revenue

    let totalOrders = 0;
    let totalRevenue = 0;
    let totalFees = 0;

    for (const sale of sales) {
      const platform = sale.platform || 'Unknown';
      const revenue = (sale.sale_amount || 0) + (sale.shipping_charged || 0);
      const fees = sale.platform_fees || 0;
      const profit = sale.gross_profit || 0;

      totalOrders++;
      totalRevenue += revenue;
      totalFees += fees;

      // Platform totals
      const platformData = platformMap.get(platform) || {
        orderCount: 0,
        revenue: 0,
        fees: 0,
        profit: 0,
      };
      platformData.orderCount++;
      platformData.revenue += revenue;
      platformData.fees += fees;
      platformData.profit += profit;
      platformMap.set(platform, platformData);

      // Monthly trends
      const month = sale.sale_date.substring(0, 7);
      if (!trendsMap.has(month)) {
        trendsMap.set(month, new Map());
      }
      const monthPlatforms = trendsMap.get(month)!;
      monthPlatforms.set(platform, (monthPlatforms.get(platform) || 0) + revenue);
    }

    const platforms = Array.from(platformMap.entries())
      .map(([platform, data]) => ({
        platform,
        orderCount: data.orderCount,
        itemsSold: data.orderCount, // Simplified - would need sale_items for actual count
        revenue: data.revenue,
        fees: data.fees,
        netRevenue: data.revenue - data.fees,
        avgOrderValue: data.orderCount > 0 ? data.revenue / data.orderCount : 0,
        profitMargin: data.revenue > 0 ? (data.profit / data.revenue) * 100 : 0,
      }))
      .sort((a, b) => b.revenue - a.revenue);

    const trends = Array.from(trendsMap.entries())
      .map(([month, platformRevenue]) => ({
        month,
        data: Object.fromEntries(platformRevenue),
      }))
      .sort((a, b) => a.month.localeCompare(b.month));

    return {
      period: dateRange,
      platforms,
      trends,
      totals: {
        totalOrders,
        totalRevenue,
        totalFees,
        avgOrderValue: totalOrders > 0 ? totalRevenue / totalOrders : 0,
      },
    };
  }

  /**
   * Get Sales Trends Report
   */
  async getSalesTrendsReport(
    userId: string,
    dateRange: DateRange,
    granularity: 'daily' | 'weekly' | 'monthly' = 'daily',
    includeComparison: boolean = true
  ): Promise<SalesTrendsReport> {
    const startDate = this.formatDate(dateRange.startDate);
    const endDate = this.formatDate(dateRange.endDate);

    const { data: salesData, error } = await this.supabase
      .from('sales')
      .select('sale_date, sale_amount, shipping_charged, gross_profit')
      .eq('user_id', userId)
      .gte('sale_date', startDate)
      .lte('sale_date', endDate)
      .order('sale_date', { ascending: true });

    if (error) {
      throw new Error(`Failed to fetch sales data: ${error.message}`);
    }

    interface TrendSaleRow {
      sale_date: string;
      sale_amount: number | null;
      shipping_charged: number | null;
      gross_profit: number | null;
    }

    const sales = (salesData || []) as TrendSaleRow[];

    // Group by period
    const dataMap = new Map<string, { revenue: number; profit: number; orderCount: number }>();

    for (const sale of sales) {
      let periodKey: string;
      const saleDate = new Date(sale.sale_date);

      switch (granularity) {
        case 'weekly': {
          const weekStart = new Date(saleDate);
          weekStart.setDate(weekStart.getDate() - weekStart.getDay());
          periodKey = this.formatDate(weekStart);
          break;
        }
        case 'monthly':
          periodKey = sale.sale_date.substring(0, 7);
          break;
        default:
          periodKey = sale.sale_date;
      }

      const existing = dataMap.get(periodKey) || { revenue: 0, profit: 0, orderCount: 0 };
      existing.revenue += (sale.sale_amount || 0) + (sale.shipping_charged || 0);
      existing.profit += sale.gross_profit || 0;
      existing.orderCount++;
      dataMap.set(periodKey, existing);
    }

    const data = Array.from(dataMap.entries()).map(([date, metrics]) => ({
      date,
      label: this.formatPeriodLabel(date, granularity),
      revenue: metrics.revenue,
      profit: metrics.profit,
      orderCount: metrics.orderCount,
      avgOrderValue: metrics.orderCount > 0 ? metrics.revenue / metrics.orderCount : 0,
    }));

    // Calculate summary
    let totalRevenue = 0;
    let totalProfit = 0;
    let totalOrders = 0;
    let peakDay = '';
    let peakRevenue = 0;

    for (const d of data) {
      totalRevenue += d.revenue;
      totalProfit += d.profit;
      totalOrders += d.orderCount;
      if (d.revenue > peakRevenue) {
        peakRevenue = d.revenue;
        peakDay = d.date;
      }
    }

    const dayCount = Math.ceil(
      (dateRange.endDate.getTime() - dateRange.startDate.getTime()) / (1000 * 60 * 60 * 24)
    );

    const report: SalesTrendsReport = {
      period: dateRange,
      granularity,
      data,
      summary: {
        totalRevenue,
        totalProfit,
        totalOrders,
        peakDay,
        peakRevenue,
        avgDailyRevenue: dayCount > 0 ? totalRevenue / dayCount : 0,
      },
    };

    // Include previous period comparison if requested
    if (includeComparison) {
      const prevPeriod = this.getPreviousPeriod(dateRange);
      const prevStartDate = this.formatDate(prevPeriod.startDate);
      const prevEndDate = this.formatDate(prevPeriod.endDate);

      const { data: prevSalesData } = await this.supabase
        .from('sales')
        .select('sale_date, sale_amount, shipping_charged, gross_profit')
        .eq('user_id', userId)
        .gte('sale_date', prevStartDate)
        .lte('sale_date', prevEndDate)
        .order('sale_date', { ascending: true });

      if (prevSalesData && prevSalesData.length > 0) {
        const prevDataMap = new Map<string, { revenue: number; profit: number; orderCount: number }>();
        const prevSales = prevSalesData as TrendSaleRow[];

        for (const sale of prevSales) {
          let periodKey: string;
          const saleDate = new Date(sale.sale_date);

          switch (granularity) {
            case 'weekly': {
              const weekStart = new Date(saleDate);
              weekStart.setDate(weekStart.getDate() - weekStart.getDay());
              periodKey = this.formatDate(weekStart);
              break;
            }
            case 'monthly':
              periodKey = sale.sale_date.substring(0, 7);
              break;
            default:
              periodKey = sale.sale_date;
          }

          const existing = prevDataMap.get(periodKey) || { revenue: 0, profit: 0, orderCount: 0 };
          existing.revenue += (sale.sale_amount || 0) + (sale.shipping_charged || 0);
          existing.profit += sale.gross_profit || 0;
          existing.orderCount++;
          prevDataMap.set(periodKey, existing);
        }

        report.previousPeriod = Array.from(prevDataMap.entries()).map(([date, metrics]) => ({
          date,
          label: this.formatPeriodLabel(date, granularity),
          revenue: metrics.revenue,
          profit: metrics.profit,
          orderCount: metrics.orderCount,
        }));
      }
    }

    return report;
  }

  /**
   * Format period label based on granularity
   */
  private formatPeriodLabel(date: string, granularity: 'daily' | 'weekly' | 'monthly'): string {
    const d = new Date(date);
    switch (granularity) {
      case 'weekly':
        return `Week of ${d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}`;
      case 'monthly':
        return d.toLocaleDateString('en-GB', { month: 'short', year: 'numeric' });
      default:
        return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
    }
  }

  /**
   * Get Purchase Analysis Report
   */
  async getPurchaseAnalysisReport(userId: string, dateRange: DateRange): Promise<PurchaseAnalysisReport> {
    const startDate = this.formatDate(dateRange.startDate);
    const endDate = this.formatDate(dateRange.endDate);

    // Fetch purchases
    const { data: purchasesData, error: purchaseError } = await this.supabase
      .from('purchases')
      .select('id, purchase_date, short_description, cost, source')
      .eq('user_id', userId)
      .gte('purchase_date', startDate)
      .lte('purchase_date', endDate);

    // Fetch mileage from new mileage_tracking table
    const { data: mileageData } = await this.supabase
      .from('mileage_tracking')
      .select('purchase_id, miles_travelled, amount_claimed')
      .eq('user_id', userId)
      .eq('expense_type', 'mileage');

    // Build mileage lookup by purchase_id
    const mileageByPurchaseId = new Map<string, { miles: number; cost: number }>();
    for (const m of mileageData || []) {
      if (m.purchase_id) {
        const existing = mileageByPurchaseId.get(m.purchase_id) || { miles: 0, cost: 0 };
        existing.miles += m.miles_travelled;
        existing.cost += m.amount_claimed;
        mileageByPurchaseId.set(m.purchase_id, existing);
      }
    }

    if (purchaseError) {
      throw new Error(`Failed to fetch purchases: ${purchaseError.message}`);
    }

    const purchases = (purchasesData || []) as PurchaseQueryRow[];

    // Fetch inventory items to match with purchases
    const { data: inventoryData, error: invError } = await this.supabase
      .from('inventory_items')
      .select('id, set_number, source, purchase_date, cost, listing_value, status')
      .eq('user_id', userId);

    if (invError) {
      throw new Error(`Failed to fetch inventory: ${invError.message}`);
    }

    interface InvItem {
      id: string;
      set_number: string;
      source: string | null;
      purchase_date: string | null;
      cost: number | null;
      listing_value: number | null;
      status: string | null;
    }

    const inventoryItems = (inventoryData || []) as InvItem[];

    // Build purchase analysis
    let totalSpent = 0;
    let itemsAcquired = 0;
    let itemsSold = 0;
    let revenueFromSold = 0;
    let totalMileage = 0;

    const sourceMap = new Map<
      string,
      {
        purchaseCount: number;
        totalSpent: number;
        itemsAcquired: number;
        itemsSold: number;
        revenue: number;
        mileage: number;
      }
    >();

    const purchasesList: PurchaseAnalysisReport['purchases'] = [];

    for (const purchase of purchases) {
      // Find matching inventory items
      const matchingItems = inventoryItems.filter(
        (item) =>
          item.source === purchase.short_description &&
          item.purchase_date === purchase.purchase_date
      );

      const itemCount = matchingItems.length;
      const soldItems = matchingItems.filter((i) => i.status === 'SOLD');
      const soldCount = soldItems.length;
      const revenue = soldItems.reduce((sum, i) => sum + (i.listing_value || 0), 0);
      const profit = revenue - purchase.cost;
      const roi = purchase.cost > 0 ? (profit / purchase.cost) * 100 : 0;

      // Get mileage from the mileage_tracking lookup
      const purchaseMileage = mileageByPurchaseId.get(purchase.id) || { miles: 0, cost: 0 };
      const mileageCost = purchaseMileage.cost;
      const purchaseMiles = purchaseMileage.miles;

      totalSpent += purchase.cost;
      itemsAcquired += itemCount;
      itemsSold += soldCount;
      revenueFromSold += revenue;
      totalMileage += purchaseMiles;

      // Source breakdown
      const source = purchase.source || 'Unknown';
      const sourceData = sourceMap.get(source) || {
        purchaseCount: 0,
        totalSpent: 0,
        itemsAcquired: 0,
        itemsSold: 0,
        revenue: 0,
        mileage: 0,
      };
      sourceData.purchaseCount++;
      sourceData.totalSpent += purchase.cost;
      sourceData.itemsAcquired += itemCount;
      sourceData.itemsSold += soldCount;
      sourceData.revenue += revenue;
      sourceData.mileage += purchaseMiles;
      sourceMap.set(source, sourceData);

      purchasesList.push({
        id: purchase.id,
        date: purchase.purchase_date,
        description: purchase.short_description,
        source,
        cost: purchase.cost,
        itemCount,
        soldCount,
        revenue,
        profit,
        roi,
        mileage: purchaseMiles,
        mileageCost,
      });
    }

    const totalProfit = revenueFromSold - totalSpent;
    // Use actual mileage costs from mileage_tracking table instead of recalculating
    const totalMileageCost = Array.from(mileageByPurchaseId.values()).reduce(
      (sum, m) => sum + m.cost,
      0
    );

    const bySource = Array.from(sourceMap.entries()).map(([source, data]) => {
      const profit = data.revenue - data.totalSpent;
      return {
        source,
        purchaseCount: data.purchaseCount,
        totalSpent: data.totalSpent,
        itemsAcquired: data.itemsAcquired,
        itemsSold: data.itemsSold,
        revenue: data.revenue,
        profit,
        roi: data.totalSpent > 0 ? (profit / data.totalSpent) * 100 : 0,
        avgMileage: data.purchaseCount > 0 ? data.mileage / data.purchaseCount : 0,
      };
    });

    return {
      period: dateRange,
      summary: {
        totalSpent,
        itemsAcquired,
        avgCostPerItem: itemsAcquired > 0 ? totalSpent / itemsAcquired : 0,
        itemsSold,
        revenueFromSold,
        totalProfit,
        overallROI: totalSpent > 0 ? (totalProfit / totalSpent) * 100 : 0,
        totalMileage,
        totalMileageCost,
      },
      bySource,
      purchases: purchasesList.sort((a, b) => b.date.localeCompare(a.date)),
    };
  }

  /**
   * Get Report Settings
   */
  async getReportSettings(userId: string): Promise<ReportSettings> {
    const { data, error } = await this.supabase
      .from('user_settings')
      .select('report_settings')
      .eq('user_id', userId)
      .single();

    if (error && error.code !== 'PGRST116') {
      throw new Error(`Failed to fetch settings: ${error.message}`);
    }

    const defaultSettings: ReportSettings = {
      financialYearStartMonth: 4,
      defaultCurrency: 'GBP',
      mileageRate: 0.45,
      businessName: null,
      businessAddress: null,
      showPreviousPeriodComparison: true,
      dailyListingTarget: 200,
    };

    interface SettingsRow {
      report_settings: Partial<ReportSettings> | null;
    }

    if (!data) {
      return defaultSettings;
    }

    const settings = (data as SettingsRow).report_settings || {};
    return { ...defaultSettings, ...settings };
  }

  /**
   * Update Report Settings
   */
  async updateReportSettings(userId: string, settings: Partial<ReportSettings>): Promise<ReportSettings> {
    const current = await this.getReportSettings(userId);
    const updated = { ...current, ...settings };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (this.supabase as any)
      .from('user_settings')
      .upsert(
        {
          user_id: userId,
          report_settings: updated,
        },
        { onConflict: 'user_id' }
      );

    if (error) {
      throw new Error(`Failed to update settings: ${error.message}`);
    }

    return updated;
  }

  /**
   * Get Daily Activity Report
   * Aggregates listing and sold activity by date and platform
   */
  async getDailyActivityReport(
    userId: string,
    dateRange: DateRange,
    granularity: 'daily' | 'monthly' = 'daily'
  ): Promise<DailyActivityReport> {
    const startDate = this.formatDate(dateRange.startDate);
    const endDate = this.formatDate(dateRange.endDate);

    const platforms: ActivityPlatform[] = ['amazon', 'ebay', 'bricklink'];

    // Helper to create empty platform data
    const createEmptyPlatformData = (platform: ActivityPlatform): DailyPlatformData => ({
      platform,
      itemsListed: 0,
      listingValue: 0,
      itemsSold: 0,
      soldValue: 0,
      storeStatus: null,
    });

    // Helper to create empty platform totals
    const createEmptyPlatformTotals = () => ({
      totalItemsListed: 0,
      totalListingValue: 0,
      totalItemsSold: 0,
      totalSoldValue: 0,
    });

    if (granularity === 'monthly') {
      // Query monthly summary view
      const { data: activityData, error } = await this.supabase
        .from('monthly_platform_summary')
        .select('month, month_start, platform, items_listed, listing_value, items_sold, sold_value')
        .eq('user_id', userId)
        .gte('month_start', startDate)
        .lte('month_start', endDate)
        .order('month', { ascending: true });

      if (error) {
        throw new Error(`Failed to fetch monthly activity: ${error.message}`);
      }

      interface MonthlyRow {
        month: string;
        month_start: string;
        platform: string;
        items_listed: number;
        listing_value: number;
        items_sold: number;
        sold_value: number;
      }

      const rows = (activityData || []) as MonthlyRow[];

      // Group by month
      const monthMap = new Map<string, MonthlyActivityRow>();

      for (const row of rows) {
        const platform = row.platform as ActivityPlatform;
        if (!platforms.includes(platform)) continue;

        if (!monthMap.has(row.month)) {
          const monthDate = new Date(row.month_start);
          monthMap.set(row.month, {
            month: row.month,
            monthLabel: monthDate.toLocaleDateString('en-GB', { month: 'short', year: 'numeric' }),
            platforms: {
              amazon: { itemsListed: 0, listingValue: 0, itemsSold: 0, soldValue: 0 },
              ebay: { itemsListed: 0, listingValue: 0, itemsSold: 0, soldValue: 0 },
              bricklink: { itemsListed: 0, listingValue: 0, itemsSold: 0, soldValue: 0 },
            },
            totals: { itemsListed: 0, listingValue: 0, itemsSold: 0, soldValue: 0 },
          });
        }

        const monthRow = monthMap.get(row.month)!;
        monthRow.platforms[platform].itemsListed = row.items_listed || 0;
        monthRow.platforms[platform].listingValue = row.listing_value || 0;
        monthRow.platforms[platform].itemsSold = row.items_sold || 0;
        monthRow.platforms[platform].soldValue = row.sold_value || 0;
      }

      // Calculate totals for each month
      const data: MonthlyActivityRow[] = Array.from(monthMap.values())
        .sort((a, b) => a.month.localeCompare(b.month));

      for (const row of data) {
        row.totals = {
          itemsListed: platforms.reduce((sum, p) => sum + row.platforms[p].itemsListed, 0),
          listingValue: platforms.reduce((sum, p) => sum + row.platforms[p].listingValue, 0),
          itemsSold: platforms.reduce((sum, p) => sum + row.platforms[p].itemsSold, 0),
          soldValue: platforms.reduce((sum, p) => sum + row.platforms[p].soldValue, 0),
        };
      }

      // Calculate summary totals
      const summary = {
        platforms: {
          amazon: createEmptyPlatformTotals(),
          ebay: createEmptyPlatformTotals(),
          bricklink: createEmptyPlatformTotals(),
        },
        grandTotals: { totalItemsListed: 0, totalListingValue: 0, totalItemsSold: 0, totalSoldValue: 0 },
      };

      for (const row of data) {
        for (const platform of platforms) {
          summary.platforms[platform].totalItemsListed += row.platforms[platform].itemsListed;
          summary.platforms[platform].totalListingValue += row.platforms[platform].listingValue;
          summary.platforms[platform].totalItemsSold += row.platforms[platform].itemsSold;
          summary.platforms[platform].totalSoldValue += row.platforms[platform].soldValue;
        }
      }

      summary.grandTotals = {
        totalItemsListed: platforms.reduce((sum, p) => sum + summary.platforms[p].totalItemsListed, 0),
        totalListingValue: platforms.reduce((sum, p) => sum + summary.platforms[p].totalListingValue, 0),
        totalItemsSold: platforms.reduce((sum, p) => sum + summary.platforms[p].totalItemsSold, 0),
        totalSoldValue: platforms.reduce((sum, p) => sum + summary.platforms[p].totalSoldValue, 0),
      };

      return { period: dateRange, granularity, data, summary };
    }

    // Daily granularity
    // Query daily activity view
    const { data: activityData, error } = await this.supabase
      .from('daily_platform_activity')
      .select('activity_date, platform, items_listed, listing_value, items_sold, sold_value')
      .eq('user_id', userId)
      .gte('activity_date', startDate)
      .lte('activity_date', endDate)
      .order('activity_date', { ascending: true });

    if (error) {
      throw new Error(`Failed to fetch daily activity: ${error.message}`);
    }

    // Fetch store statuses for the date range
    const storeStatuses = await this.getStoreStatuses(userId, dateRange);
    const statusMap = new Map<string, StoreStatus>();
    for (const status of storeStatuses) {
      statusMap.set(`${status.date}|${status.platform}`, status.status);
    }

    interface DailyRow {
      activity_date: string;
      platform: string;
      items_listed: number;
      listing_value: number;
      items_sold: number;
      sold_value: number;
    }

    const rows = (activityData || []) as DailyRow[];

    // Generate all dates in the range first
    const dateMap = new Map<string, DailyActivityRow>();
    const currentDate = new Date(dateRange.startDate);
    const endDateObj = new Date(dateRange.endDate);

    while (currentDate <= endDateObj) {
      const dateStr = this.formatDate(currentDate);
      const displayDate = new Date(currentDate);
      dateMap.set(dateStr, {
        date: dateStr,
        dateLabel: displayDate.toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' }),
        platforms: {
          amazon: createEmptyPlatformData('amazon'),
          ebay: createEmptyPlatformData('ebay'),
          bricklink: createEmptyPlatformData('bricklink'),
        },
        totals: { itemsListed: 0, listingValue: 0, itemsSold: 0, soldValue: 0 },
      });
      currentDate.setDate(currentDate.getDate() + 1);
    }

    // Populate with activity data
    for (const row of rows) {
      const platform = row.platform as ActivityPlatform;
      if (!platforms.includes(platform)) continue;

      const dateStr = row.activity_date;
      const dateRow = dateMap.get(dateStr);
      if (dateRow) {
        dateRow.platforms[platform].itemsListed = row.items_listed || 0;
        dateRow.platforms[platform].listingValue = row.listing_value || 0;
        dateRow.platforms[platform].itemsSold = row.items_sold || 0;
        dateRow.platforms[platform].soldValue = row.sold_value || 0;
      }
    }

    // Add store statuses
    for (const status of storeStatuses) {
      const dateRow = dateMap.get(status.date);
      if (dateRow) {
        dateRow.platforms[status.platform].storeStatus = status.status;
      }
    }

    // Calculate totals for each day
    const data: DailyActivityRow[] = Array.from(dateMap.values())
      .sort((a, b) => a.date.localeCompare(b.date));

    for (const row of data) {
      row.totals = {
        itemsListed: platforms.reduce((sum, p) => sum + row.platforms[p].itemsListed, 0),
        listingValue: platforms.reduce((sum, p) => sum + row.platforms[p].listingValue, 0),
        itemsSold: platforms.reduce((sum, p) => sum + row.platforms[p].itemsSold, 0),
        soldValue: platforms.reduce((sum, p) => sum + row.platforms[p].soldValue, 0),
      };
    }

    // Calculate summary totals
    const summary = {
      platforms: {
        amazon: createEmptyPlatformTotals(),
        ebay: createEmptyPlatformTotals(),
        bricklink: createEmptyPlatformTotals(),
      },
      grandTotals: { totalItemsListed: 0, totalListingValue: 0, totalItemsSold: 0, totalSoldValue: 0 },
    };

    for (const row of data) {
      for (const platform of platforms) {
        summary.platforms[platform].totalItemsListed += row.platforms[platform].itemsListed;
        summary.platforms[platform].totalListingValue += row.platforms[platform].listingValue;
        summary.platforms[platform].totalItemsSold += row.platforms[platform].itemsSold;
        summary.platforms[platform].totalSoldValue += row.platforms[platform].soldValue;
      }
    }

    summary.grandTotals = {
      totalItemsListed: platforms.reduce((sum, p) => sum + summary.platforms[p].totalItemsListed, 0),
      totalListingValue: platforms.reduce((sum, p) => sum + summary.platforms[p].totalListingValue, 0),
      totalItemsSold: platforms.reduce((sum, p) => sum + summary.platforms[p].totalItemsSold, 0),
      totalSoldValue: platforms.reduce((sum, p) => sum + summary.platforms[p].totalSoldValue, 0),
    };

    return { period: dateRange, granularity, data, summary };
  }

  /**
   * Get store statuses for a date range
   */
  async getStoreStatuses(userId: string, dateRange: DateRange): Promise<StoreStatusRecord[]> {
    const startDate = this.formatDate(dateRange.startDate);
    const endDate = this.formatDate(dateRange.endDate);

    const { data, error } = await this.supabase
      .from('platform_store_status')
      .select('id, date, platform, status')
      .eq('user_id', userId)
      .gte('date', startDate)
      .lte('date', endDate)
      .order('date', { ascending: true });

    if (error) {
      throw new Error(`Failed to fetch store statuses: ${error.message}`);
    }

    return (data || []).map(row => ({
      id: row.id,
      date: row.date,
      platform: row.platform as ActivityPlatform,
      status: row.status as StoreStatus,
    }));
  }

  /**
   * Set store status for a specific date and platform
   * Uses upsert to handle both insert and update
   */
  async setStoreStatus(
    userId: string,
    date: string,
    platform: ActivityPlatform,
    status: StoreStatus
  ): Promise<StoreStatusRecord> {
    const { data, error } = await this.supabase
      .from('platform_store_status')
      .upsert(
        {
          user_id: userId,
          date,
          platform,
          status,
        },
        {
          onConflict: 'user_id,date,platform',
        }
      )
      .select('id, date, platform, status')
      .single();

    if (error) {
      throw new Error(`Failed to set store status: ${error.message}`);
    }

    return {
      id: data.id,
      date: data.date,
      platform: data.platform as ActivityPlatform,
      status: data.status as StoreStatus,
    };
  }

  /**
   * Batch update store statuses
   */
  async batchSetStoreStatuses(
    userId: string,
    statuses: UpdateStoreStatusInput[]
  ): Promise<StoreStatusRecord[]> {
    const records = statuses.map(s => ({
      user_id: userId,
      date: s.date,
      platform: s.platform,
      status: s.status,
    }));

    const { data, error } = await this.supabase
      .from('platform_store_status')
      .upsert(records, {
        onConflict: 'user_id,date,platform',
      })
      .select('id, date, platform, status');

    if (error) {
      throw new Error(`Failed to batch update store statuses: ${error.message}`);
    }

    return (data || []).map(row => ({
      id: row.id,
      date: row.date,
      platform: row.platform as ActivityPlatform,
      status: row.status as StoreStatus,
    }));
  }
}
