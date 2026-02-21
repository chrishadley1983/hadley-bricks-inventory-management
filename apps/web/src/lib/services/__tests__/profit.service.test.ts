import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ProfitService } from '../profit.service';

describe('ProfitService', () => {
  let service: ProfitService;
  const userId = 'test-user-id';

  // Mock Supabase client
  const mockSupabase = {
    from: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    service = new ProfitService(mockSupabase as any);
  });

  describe('getMetrics', () => {
    it('should calculate profit metrics for all sales', async () => {
      const mockSales = [
        {
          sale_amount: 100,
          shipping_charged: 5,
          platform_fees: 15,
          cost_of_goods: 50,
          shipping_cost: 3,
          other_costs: 2,
          gross_profit: 35,
        },
        {
          sale_amount: 200,
          shipping_charged: 10,
          platform_fees: 30,
          cost_of_goods: 100,
          shipping_cost: 5,
          other_costs: 5,
          gross_profit: 70,
        },
      ];

      const mockBuilder = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        gte: vi.fn().mockReturnThis(),
        lte: vi.fn().mockReturnThis(),
        then: vi.fn((resolve) => resolve({ data: mockSales, error: null })),
      };
      mockSupabase.from.mockReturnValue(mockBuilder);

      const result = await service.getMetrics(userId);

      expect(result.totalSales).toBe(2);
      expect(result.totalRevenue).toBe(315); // (100+5) + (200+10)
      expect(result.totalCostOfGoods).toBe(150); // 50 + 100
      expect(result.totalFees).toBe(45); // 15 + 30
      expect(result.totalShippingCosts).toBe(8); // 3 + 5
      expect(result.totalOtherCosts).toBe(7); // 2 + 5
      expect(result.totalProfit).toBe(105); // 35 + 70
      expect(result.averageOrderValue).toBeCloseTo(157.5); // 315 / 2
      expect(result.averageProfit).toBeCloseTo(52.5); // 105 / 2
    });

    it('should filter by date range when provided', async () => {
      const mockBuilder = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        gte: vi.fn().mockReturnThis(),
        lte: vi.fn().mockReturnThis(),
        then: vi.fn((resolve) => resolve({ data: [], error: null })),
      };
      mockSupabase.from.mockReturnValue(mockBuilder);

      await service.getMetrics(userId, {
        startDate: new Date('2025-01-01'),
        endDate: new Date('2025-01-31'),
      });

      expect(mockBuilder.gte).toHaveBeenCalledWith('sale_date', '2025-01-01');
      expect(mockBuilder.lte).toHaveBeenCalledWith('sale_date', '2025-01-31');
    });

    it('should return zeros when no sales', async () => {
      const mockBuilder = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        then: vi.fn((resolve) => resolve({ data: [], error: null })),
      };
      mockSupabase.from.mockReturnValue(mockBuilder);

      const result = await service.getMetrics(userId);

      expect(result.totalSales).toBe(0);
      expect(result.totalRevenue).toBe(0);
      expect(result.totalProfit).toBe(0);
      expect(result.averageMargin).toBe(0);
      expect(result.averageOrderValue).toBe(0);
    });

    it('should throw error on database failure', async () => {
      const mockBuilder = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        then: vi.fn((resolve) => resolve({ data: null, error: { message: 'DB error' } })),
      };
      mockSupabase.from.mockReturnValue(mockBuilder);

      await expect(service.getMetrics(userId)).rejects.toThrow(
        'Failed to get profit metrics: DB error'
      );
    });

    it('should handle null values in sales data', async () => {
      const mockSales = [
        {
          sale_amount: 100,
          shipping_charged: null,
          platform_fees: null,
          cost_of_goods: 50,
          shipping_cost: null,
          other_costs: null,
          gross_profit: 50,
        },
      ];

      const mockBuilder = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        then: vi.fn((resolve) => resolve({ data: mockSales, error: null })),
      };
      mockSupabase.from.mockReturnValue(mockBuilder);

      const result = await service.getMetrics(userId);

      expect(result.totalRevenue).toBe(100);
      expect(result.totalFees).toBe(0);
      expect(result.totalShippingCosts).toBe(0);
    });
  });

  describe('getDailyProfitSummary', () => {
    it('should return daily profit grouped by date', async () => {
      const mockSales = [
        {
          sale_date: '2025-01-15',
          sale_amount: 100,
          shipping_charged: 5,
          platform_fees: 15,
          cost_of_goods: 50,
          shipping_cost: 3,
          other_costs: 2,
          gross_profit: 35,
        },
        {
          sale_date: '2025-01-15',
          sale_amount: 80,
          shipping_charged: 5,
          platform_fees: 12,
          cost_of_goods: 40,
          shipping_cost: 3,
          other_costs: 0,
          gross_profit: 30,
        },
        {
          sale_date: '2025-01-16',
          sale_amount: 200,
          shipping_charged: 10,
          platform_fees: 30,
          cost_of_goods: 100,
          shipping_cost: 5,
          other_costs: 5,
          gross_profit: 70,
        },
      ];

      const mockBuilder = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        gte: vi.fn().mockReturnThis(),
        lte: vi.fn().mockReturnThis(),
        order: vi.fn().mockReturnThis(),
        then: vi.fn((resolve) => resolve({ data: mockSales, error: null })),
      };
      mockSupabase.from.mockReturnValue(mockBuilder);

      const result = await service.getDailyProfitSummary(userId, {
        startDate: new Date('2025-01-01'),
        endDate: new Date('2025-01-31'),
      });

      expect(result).toHaveLength(2);

      const day1 = result.find((d) => d.date === '2025-01-15');
      expect(day1?.sales).toBe(2);
      expect(day1?.revenue).toBe(190); // (100+5) + (80+5)
      expect(day1?.profit).toBe(65); // 35 + 30

      const day2 = result.find((d) => d.date === '2025-01-16');
      expect(day2?.sales).toBe(1);
      expect(day2?.revenue).toBe(210); // 200 + 10
      expect(day2?.profit).toBe(70);
    });

    it('should calculate margin correctly', async () => {
      const mockSales = [
        {
          sale_date: '2025-01-15',
          sale_amount: 100,
          shipping_charged: 0,
          platform_fees: 10,
          cost_of_goods: 50,
          shipping_cost: 0,
          other_costs: 0,
          gross_profit: 40,
        },
      ];

      const mockBuilder = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        gte: vi.fn().mockReturnThis(),
        lte: vi.fn().mockReturnThis(),
        order: vi.fn().mockReturnThis(),
        then: vi.fn((resolve) => resolve({ data: mockSales, error: null })),
      };
      mockSupabase.from.mockReturnValue(mockBuilder);

      const result = await service.getDailyProfitSummary(userId, {
        startDate: new Date('2025-01-01'),
        endDate: new Date('2025-01-31'),
      });

      expect(result[0].margin).toBe(40); // (40/100) * 100 = 40%
    });
  });

  describe('getMonthlyProfitSummary', () => {
    it('should return monthly profit for all 12 months', async () => {
      const mockSales = [
        {
          sale_date: '2025-01-15',
          sale_amount: 100,
          shipping_charged: 5,
          platform_fees: 15,
          cost_of_goods: 50,
          shipping_cost: 3,
          other_costs: 2,
          gross_profit: 35,
        },
        {
          sale_date: '2025-03-20',
          sale_amount: 200,
          shipping_charged: 10,
          platform_fees: 30,
          cost_of_goods: 100,
          shipping_cost: 5,
          other_costs: 5,
          gross_profit: 70,
        },
      ];

      const mockBuilder = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        gte: vi.fn().mockReturnThis(),
        lte: vi.fn().mockReturnThis(),
        then: vi.fn((resolve) => resolve({ data: mockSales, error: null })),
      };
      mockSupabase.from.mockReturnValue(mockBuilder);

      const result = await service.getMonthlyProfitSummary(userId, 2025);

      expect(result).toHaveLength(12);
      expect(result[0].monthName).toBe('January');
      expect(result[0].sales).toBe(1);
      expect(result[0].profit).toBe(35);

      expect(result[2].monthName).toBe('March');
      expect(result[2].sales).toBe(1);
      expect(result[2].profit).toBe(70);

      // Months with no sales should have zeros
      expect(result[1].monthName).toBe('February');
      expect(result[1].sales).toBe(0);
    });
  });

  describe('getPlatformBreakdown', () => {
    it('should return profit breakdown by platform', async () => {
      const mockSales = [
        {
          platform: 'amazon',
          sale_amount: 100,
          shipping_charged: 5,
          platform_fees: 15,
          cost_of_goods: 50,
          shipping_cost: 3,
          other_costs: 2,
          gross_profit: 35,
        },
        {
          platform: 'amazon',
          sale_amount: 80,
          shipping_charged: 5,
          platform_fees: 12,
          cost_of_goods: 40,
          shipping_cost: 3,
          other_costs: 0,
          gross_profit: 30,
        },
        {
          platform: 'ebay',
          sale_amount: 200,
          shipping_charged: 10,
          platform_fees: 30,
          cost_of_goods: 100,
          shipping_cost: 5,
          other_costs: 5,
          gross_profit: 70,
        },
      ];

      const mockBuilder = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        gte: vi.fn().mockReturnThis(),
        lte: vi.fn().mockReturnThis(),
        then: vi.fn((resolve) => resolve({ data: mockSales, error: null })),
      };
      mockSupabase.from.mockReturnValue(mockBuilder);

      const result = await service.getPlatformBreakdown(userId);

      expect(result).toHaveLength(2);

      // Results are sorted by profit descending
      const ebay = result.find((p) => p.platform === 'ebay');
      expect(ebay?.sales).toBe(1);
      expect(ebay?.profit).toBe(70);

      const amazon = result.find((p) => p.platform === 'amazon');
      expect(amazon?.sales).toBe(2);
      expect(amazon?.profit).toBe(65);
    });

    it('should handle sales with no platform', async () => {
      const mockSales = [
        {
          platform: null,
          sale_amount: 100,
          shipping_charged: 0,
          platform_fees: 10,
          cost_of_goods: 50,
          shipping_cost: 0,
          other_costs: 0,
          gross_profit: 40,
        },
      ];

      const mockBuilder = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        then: vi.fn((resolve) => resolve({ data: mockSales, error: null })),
      };
      mockSupabase.from.mockReturnValue(mockBuilder);

      const result = await service.getPlatformBreakdown(userId);

      expect(result[0].platform).toBe('Unknown');
    });
  });

  describe('getRolling12MonthTurnover', () => {
    it('should return total revenue for last 12 months', async () => {
      const mockSales = [
        {
          sale_amount: 1000,
          shipping_charged: 50,
          platform_fees: 100,
          cost_of_goods: 500,
          shipping_cost: 30,
          other_costs: 20,
          gross_profit: 400,
        },
        {
          sale_amount: 2000,
          shipping_charged: 100,
          platform_fees: 200,
          cost_of_goods: 1000,
          shipping_cost: 50,
          other_costs: 50,
          gross_profit: 800,
        },
      ];

      const mockBuilder = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        gte: vi.fn().mockReturnThis(),
        lte: vi.fn().mockReturnThis(),
        then: vi.fn((resolve) => resolve({ data: mockSales, error: null })),
      };
      mockSupabase.from.mockReturnValue(mockBuilder);

      const result = await service.getRolling12MonthTurnover(userId);

      expect(result).toBe(3150); // (1000+50) + (2000+100)
    });
  });

  describe('getYearOverYearComparison', () => {
    it('should compare current year with previous year', async () => {
      // Mock for current year
      const currentYearSales = [
        {
          sale_amount: 1000,
          shipping_charged: 50,
          platform_fees: 100,
          cost_of_goods: 500,
          shipping_cost: 30,
          other_costs: 20,
          gross_profit: 400,
        },
      ];

      // Mock for previous year
      const previousYearSales = [
        {
          sale_amount: 800,
          shipping_charged: 40,
          platform_fees: 80,
          cost_of_goods: 400,
          shipping_cost: 25,
          other_costs: 15,
          gross_profit: 320,
        },
      ];

      let callCount = 0;
      const mockBuilder = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        gte: vi.fn().mockReturnThis(),
        lte: vi.fn().mockReturnThis(),
        then: vi.fn((resolve) => {
          callCount++;
          if (callCount <= 1) {
            resolve({ data: currentYearSales, error: null });
          } else {
            resolve({ data: previousYearSales, error: null });
          }
          return Promise.resolve({
            data: callCount <= 1 ? currentYearSales : previousYearSales,
            error: null,
          });
        }),
      };
      mockSupabase.from.mockReturnValue(mockBuilder);

      const result = await service.getYearOverYearComparison(userId, 2025);

      expect(result.currentYear.totalRevenue).toBe(1050);
      expect(result.previousYear.totalRevenue).toBe(840);
      expect(result.revenueChange).toBeCloseTo(25); // (1050-840)/840 * 100 = 25%
      expect(result.profitChange).toBeCloseTo(25); // (400-320)/320 * 100 = 25%
    });

    it('should handle zero previous year revenue', async () => {
      const mockBuilder = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        gte: vi.fn().mockReturnThis(),
        lte: vi.fn().mockReturnThis(),
        then: vi.fn((resolve) => resolve({ data: [], error: null })),
      };
      mockSupabase.from.mockReturnValue(mockBuilder);

      const result = await service.getYearOverYearComparison(userId, 2025);

      expect(result.revenueChange).toBe(0);
      expect(result.profitChange).toBe(0);
    });
  });

  describe('getTopProfitableItems', () => {
    it('should return top items sorted by profit', async () => {
      const mockItems = [
        {
          item_number: '75192',
          item_name: 'Millennium Falcon',
          quantity: 2,
          total_price: 1500,
          unit_cost: 600,
        },
        {
          item_number: '76139',
          item_name: '1989 Batmobile',
          quantity: 1,
          total_price: 300,
          unit_cost: 200,
        },
        {
          item_number: '10276',
          item_name: 'Colosseum',
          quantity: 1,
          total_price: 600,
          unit_cost: 400,
        },
      ];

      const mockBuilder = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        gte: vi.fn().mockReturnThis(),
        lte: vi.fn().mockReturnThis(),
        then: vi.fn((resolve) => resolve({ data: mockItems, error: null })),
      };
      mockSupabase.from.mockReturnValue(mockBuilder);

      const result = await service.getTopProfitableItems(userId, 10);

      expect(result).toHaveLength(3);

      // Should be sorted by profit descending
      // Millennium Falcon: 1500 - (600*2) = 300 profit
      // Colosseum: 600 - 400 = 200 profit
      // Batmobile: 300 - 200 = 100 profit
      expect(result[0].itemNumber).toBe('75192');
      expect(result[0].profit).toBe(300);

      expect(result[1].itemNumber).toBe('10276');
      expect(result[1].profit).toBe(200);

      expect(result[2].itemNumber).toBe('76139');
      expect(result[2].profit).toBe(100);
    });

    it('should limit results to specified count', async () => {
      const mockItems = [
        {
          item_number: '75192',
          item_name: 'Millennium Falcon',
          quantity: 1,
          total_price: 1000,
          unit_cost: 600,
        },
        {
          item_number: '76139',
          item_name: '1989 Batmobile',
          quantity: 1,
          total_price: 300,
          unit_cost: 200,
        },
        {
          item_number: '10276',
          item_name: 'Colosseum',
          quantity: 1,
          total_price: 600,
          unit_cost: 400,
        },
      ];

      const mockBuilder = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        then: vi.fn((resolve) => resolve({ data: mockItems, error: null })),
      };
      mockSupabase.from.mockReturnValue(mockBuilder);

      const result = await service.getTopProfitableItems(userId, 2);

      expect(result).toHaveLength(2);
    });

    it('should aggregate multiple sales of same item', async () => {
      const mockItems = [
        {
          item_number: '75192',
          item_name: 'Millennium Falcon',
          quantity: 1,
          total_price: 800,
          unit_cost: 600,
        },
        {
          item_number: '75192',
          item_name: 'Millennium Falcon',
          quantity: 1,
          total_price: 850,
          unit_cost: 600,
        },
      ];

      const mockBuilder = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        then: vi.fn((resolve) => resolve({ data: mockItems, error: null })),
      };
      mockSupabase.from.mockReturnValue(mockBuilder);

      const result = await service.getTopProfitableItems(userId);

      expect(result).toHaveLength(1);
      expect(result[0].quantity).toBe(2);
      expect(result[0].revenue).toBe(1650); // 800 + 850
      expect(result[0].cost).toBe(1200); // 600 + 600
      expect(result[0].profit).toBe(450);
    });

    it('should calculate margin correctly', async () => {
      const mockItems = [
        {
          item_number: '75192',
          item_name: 'Millennium Falcon',
          quantity: 1,
          total_price: 1000,
          unit_cost: 600,
        },
      ];

      const mockBuilder = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        then: vi.fn((resolve) => resolve({ data: mockItems, error: null })),
      };
      mockSupabase.from.mockReturnValue(mockBuilder);

      const result = await service.getTopProfitableItems(userId);

      // Profit = 1000 - 600 = 400
      // Margin = (400/1000) * 100 = 40%
      expect(result[0].margin).toBe(40);
    });
  });
});
