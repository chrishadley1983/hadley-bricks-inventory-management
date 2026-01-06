import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ReportingService } from '../reporting.service';

describe('ReportingService', () => {
  let service: ReportingService;
  let mockSupabase: {
    from: ReturnType<typeof vi.fn>;
  };

  const testUserId = 'test-user-id';

  beforeEach(() => {
    vi.clearAllMocks();

    mockSupabase = {
      from: vi.fn(),
    };

    service = new ReportingService(mockSupabase as never);
  });

  describe('getDateRangeFromPreset', () => {
    it('should return correct range for this_month', () => {
      const now = new Date();
      const result = service.getDateRangeFromPreset('this_month');

      expect(result.startDate.getMonth()).toBe(now.getMonth());
      expect(result.startDate.getDate()).toBe(1);
      expect(result.endDate.getMonth()).toBe(now.getMonth());
    });

    it('should return correct range for last_month', () => {
      const now = new Date();
      const expectedMonth = now.getMonth() === 0 ? 11 : now.getMonth() - 1;
      const result = service.getDateRangeFromPreset('last_month');

      expect(result.startDate.getMonth()).toBe(expectedMonth);
      expect(result.startDate.getDate()).toBe(1);
    });

    it('should return correct range for this_year', () => {
      const now = new Date();
      const result = service.getDateRangeFromPreset('this_year');

      expect(result.startDate.getFullYear()).toBe(now.getFullYear());
      expect(result.startDate.getMonth()).toBe(0);
      expect(result.startDate.getDate()).toBe(1);
      expect(result.endDate.getMonth()).toBe(11);
      expect(result.endDate.getDate()).toBe(31);
    });

    it('should return correct range for last_30_days', () => {
      const result = service.getDateRangeFromPreset('last_30_days');

      const diffDays = Math.ceil(
        (result.endDate.getTime() - result.startDate.getTime()) / (1000 * 60 * 60 * 24)
      );
      expect(diffDays).toBe(30);
    });

    it('should return custom range when preset is custom', () => {
      const customRange = {
        startDate: new Date('2024-01-01'),
        endDate: new Date('2024-06-30'),
      };

      const result = service.getDateRangeFromPreset('custom', customRange);

      expect(result).toEqual(customRange);
    });

    it('should throw error for custom preset without range', () => {
      expect(() => service.getDateRangeFromPreset('custom')).toThrow(
        'Custom range requires startDate and endDate'
      );
    });
  });

  describe('getPreviousPeriod', () => {
    it('should return previous period of same duration', () => {
      const current = {
        startDate: new Date('2024-07-01'),
        endDate: new Date('2024-07-31'),
      };

      const result = service.getPreviousPeriod(current);

      expect(result.endDate.getTime()).toBeLessThan(current.startDate.getTime());
      const currentDuration = current.endDate.getTime() - current.startDate.getTime();
      const prevDuration = result.endDate.getTime() - result.startDate.getTime();
      expect(prevDuration).toBe(currentDuration);
    });
  });

  describe('getProfitLossReport', () => {
    const mockSales = [
      {
        sale_date: '2024-12-01',
        platform: 'bricklink',
        sale_amount: 100,
        shipping_charged: 10,
        platform_fees: 5,
        cost_of_goods: 50,
        shipping_cost: 3,
        other_costs: 2,
        gross_profit: 50,
      },
      {
        sale_date: '2024-12-15',
        platform: 'brickowl',
        sale_amount: 150,
        shipping_charged: 15,
        platform_fees: 8,
        cost_of_goods: 80,
        shipping_cost: 4,
        other_costs: 0,
        gross_profit: 73,
      },
    ];

    it('should calculate profit/loss report correctly', async () => {
      mockSupabase.from.mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            gte: vi.fn().mockReturnValue({
              lte: vi.fn().mockResolvedValue({ data: mockSales, error: null }),
            }),
          }),
        }),
      });

      const result = await service.getProfitLossReport(
        testUserId,
        { startDate: new Date('2024-12-01'), endDate: new Date('2024-12-31') },
        false
      );

      expect(result.totalRevenue).toBe(250); // 100 + 150
      expect(result.shippingIncome).toBe(25); // 10 + 15
      expect(result.grossRevenue).toBe(275); // 250 + 25
      expect(result.platformBreakdown).toHaveLength(2);
    });

    it('should include previous period comparison when requested', async () => {
      // First call for current period
      const currentPeriodQuery = vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          gte: vi.fn().mockReturnValue({
            lte: vi.fn().mockResolvedValue({ data: mockSales, error: null }),
          }),
        }),
      });

      // Second call for previous period
      const prevPeriodQuery = vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          gte: vi.fn().mockReturnValue({
            lte: vi.fn().mockResolvedValue({
              data: [{ sale_amount: 80, shipping_charged: 8, gross_profit: 40 }],
              error: null,
            }),
          }),
        }),
      });

      mockSupabase.from.mockReturnValueOnce({ select: currentPeriodQuery });
      mockSupabase.from.mockReturnValueOnce({ select: prevPeriodQuery });

      const result = await service.getProfitLossReport(
        testUserId,
        { startDate: new Date('2024-12-01'), endDate: new Date('2024-12-31') },
        true
      );

      expect(result.previousPeriod).toBeDefined();
      expect(result.previousRevenue).toBeDefined();
    });

    it('should handle database error', async () => {
      mockSupabase.from.mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            gte: vi.fn().mockReturnValue({
              lte: vi.fn().mockResolvedValue({
                data: null,
                error: { message: 'Database error' },
              }),
            }),
          }),
        }),
      });

      await expect(
        service.getProfitLossReport(testUserId, {
          startDate: new Date('2024-12-01'),
          endDate: new Date('2024-12-31'),
        })
      ).rejects.toThrow('Failed to fetch sales data');
    });
  });

  describe('getInventoryValuationReport', () => {
    const mockInventory = [
      {
        id: 'inv-1',
        set_number: '75192',
        item_name: 'Millennium Falcon',
        condition: 'New',
        status: 'IN STOCK',
        cost: 500,
        listing_value: 800,
        purchase_date: '2024-10-01',
        created_at: '2024-10-01T00:00:00Z',
      },
      {
        id: 'inv-2',
        set_number: '76139',
        item_name: 'Batmobile',
        condition: 'Used',
        status: 'LISTED',
        cost: 100,
        listing_value: 150,
        purchase_date: null,
        created_at: '2024-11-01T00:00:00Z',
      },
    ];

    it('should calculate inventory valuation correctly', async () => {
      mockSupabase.from.mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            in: vi.fn().mockResolvedValue({ data: mockInventory, error: null }),
          }),
        }),
      });

      const result = await service.getInventoryValuationReport(testUserId);

      expect(result.summary.totalItems).toBe(2);
      expect(result.summary.totalCostValue).toBe(600); // 500 + 100
      expect(result.summary.estimatedSaleValue).toBe(950); // 800 + 150
      expect(result.byCondition).toHaveLength(2);
      expect(result.byStatus).toHaveLength(2);
    });

    it('should estimate sale value if not provided', async () => {
      mockSupabase.from.mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            in: vi.fn().mockResolvedValue({
              data: [
                {
                  id: 'inv-1',
                  set_number: '12345',
                  item_name: 'Test Set',
                  condition: 'New',
                  status: 'IN STOCK',
                  cost: 100,
                  listing_value: null, // No listing value
                  purchase_date: '2024-01-01',
                  created_at: '2024-01-01T00:00:00Z',
                },
              ],
              error: null,
            }),
          }),
        }),
      });

      const result = await service.getInventoryValuationReport(testUserId);

      expect(result.summary.estimatedSaleValue).toBe(150); // 100 * 1.5 estimate
    });
  });

  describe('getInventoryAgingReport', () => {
    it('should categorize items into age brackets', async () => {
      const now = new Date();
      const thirtyDaysAgo = new Date(now);
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 15);

      const ninetyDaysAgo = new Date(now);
      ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 75);

      const twoHundredDaysAgo = new Date(now);
      twoHundredDaysAgo.setDate(twoHundredDaysAgo.getDate() - 200);

      mockSupabase.from.mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            in: vi.fn().mockResolvedValue({
              data: [
                {
                  id: 'inv-1',
                  set_number: '111',
                  item_name: 'Recent',
                  status: 'IN STOCK',
                  cost: 100,
                  purchase_date: thirtyDaysAgo.toISOString().split('T')[0],
                  created_at: thirtyDaysAgo.toISOString(),
                },
                {
                  id: 'inv-2',
                  set_number: '222',
                  item_name: 'Medium Age',
                  status: 'IN STOCK',
                  cost: 150,
                  purchase_date: ninetyDaysAgo.toISOString().split('T')[0],
                  created_at: ninetyDaysAgo.toISOString(),
                },
                {
                  id: 'inv-3',
                  set_number: '333',
                  item_name: 'Old',
                  status: 'IN STOCK',
                  cost: 200,
                  purchase_date: twoHundredDaysAgo.toISOString().split('T')[0],
                  created_at: twoHundredDaysAgo.toISOString(),
                },
              ],
              error: null,
            }),
          }),
        }),
      });

      const result = await service.getInventoryAgingReport(testUserId);

      expect(result.totalItems).toBe(3);
      expect(result.itemsOver180Days).toBe(1);
      expect(result.valueOver180Days).toBe(200);
      expect(result.brackets).toHaveLength(5);
    });

    it('should include items when requested', async () => {
      const now = new Date();
      const tenDaysAgo = new Date(now);
      tenDaysAgo.setDate(tenDaysAgo.getDate() - 10);

      mockSupabase.from.mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            in: vi.fn().mockResolvedValue({
              data: [
                {
                  id: 'inv-1',
                  set_number: '111',
                  item_name: 'Recent',
                  status: 'IN STOCK',
                  cost: 100,
                  purchase_date: tenDaysAgo.toISOString().split('T')[0],
                  created_at: tenDaysAgo.toISOString(),
                },
              ],
              error: null,
            }),
          }),
        }),
      });

      const result = await service.getInventoryAgingReport(testUserId, true);

      // First bracket (0-30 days) should have items array
      expect(result.brackets[0].items).toBeDefined();
      expect(result.brackets[0].items).toHaveLength(1);
    });
  });

  describe('getPlatformPerformanceReport', () => {
    it('should aggregate sales by platform', async () => {
      mockSupabase.from.mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            gte: vi.fn().mockReturnValue({
              lte: vi.fn().mockResolvedValue({
                data: [
                  {
                    sale_date: '2024-12-01',
                    platform: 'bricklink',
                    sale_amount: 100,
                    shipping_charged: 10,
                    platform_fees: 5,
                    gross_profit: 50,
                  },
                  {
                    sale_date: '2024-12-02',
                    platform: 'bricklink',
                    sale_amount: 150,
                    shipping_charged: 15,
                    platform_fees: 8,
                    gross_profit: 70,
                  },
                  {
                    sale_date: '2024-12-03',
                    platform: 'brickowl',
                    sale_amount: 80,
                    shipping_charged: 8,
                    platform_fees: 4,
                    gross_profit: 40,
                  },
                ],
                error: null,
              }),
            }),
          }),
        }),
      });

      const result = await service.getPlatformPerformanceReport(testUserId, {
        startDate: new Date('2024-12-01'),
        endDate: new Date('2024-12-31'),
      });

      expect(result.platforms).toHaveLength(2);
      expect(result.totals.totalOrders).toBe(3);
      expect(result.totals.totalRevenue).toBe(363); // (100+10) + (150+15) + (80+8)
    });
  });

  describe('getSalesTrendsReport', () => {
    it('should group sales by granularity', async () => {
      mockSupabase.from
        .mockReturnValueOnce({
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              gte: vi.fn().mockReturnValue({
                lte: vi.fn().mockReturnValue({
                  order: vi.fn().mockResolvedValue({
                    data: [
                      {
                        sale_date: '2024-12-01',
                        sale_amount: 100,
                        shipping_charged: 10,
                        gross_profit: 50,
                      },
                      {
                        sale_date: '2024-12-01',
                        sale_amount: 50,
                        shipping_charged: 5,
                        gross_profit: 25,
                      },
                    ],
                    error: null,
                  }),
                }),
              }),
            }),
          }),
        })
        .mockReturnValueOnce({
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              gte: vi.fn().mockReturnValue({
                lte: vi.fn().mockReturnValue({
                  order: vi.fn().mockResolvedValue({
                    data: [],
                    error: null,
                  }),
                }),
              }),
            }),
          }),
        });

      const result = await service.getSalesTrendsReport(
        testUserId,
        { startDate: new Date('2024-12-01'), endDate: new Date('2024-12-31') },
        'daily'
      );

      expect(result.data).toHaveLength(1);
      expect(result.data[0].revenue).toBe(165); // (100+10) + (50+5)
      expect(result.data[0].orderCount).toBe(2);
      expect(result.summary.totalRevenue).toBe(165);
    });
  });

  describe('getTaxSummaryReport', () => {
    it('should calculate tax summary for UK financial year', async () => {
      mockSupabase.from
        .mockReturnValueOnce({
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              gte: vi.fn().mockReturnValue({
                lte: vi.fn().mockResolvedValue({
                  data: [
                    {
                      sale_date: '2024-05-01', // Q1
                      sale_amount: 200,
                      shipping_charged: 20,
                      platform_fees: 10,
                      shipping_cost: 5,
                      other_costs: 2,
                      cost_of_goods: 100,
                      gross_profit: 103,
                    },
                    {
                      sale_date: '2024-08-01', // Q2
                      sale_amount: 300,
                      shipping_charged: 30,
                      platform_fees: 15,
                      shipping_cost: 8,
                      other_costs: 0,
                      cost_of_goods: 150,
                      gross_profit: 157,
                    },
                  ],
                  error: null,
                }),
              }),
            }),
          }),
        })
        .mockReturnValueOnce({
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              gte: vi.fn().mockReturnValue({
                lte: vi.fn().mockReturnValue({
                  not: vi.fn().mockResolvedValue({
                    data: [
                      { purchase_date: '2024-05-15', short_description: 'Car boot', mileage: 20 },
                      { purchase_date: '2024-06-20', short_description: 'Collection', mileage: 50 },
                    ],
                    error: null,
                  }),
                }),
              }),
            }),
          }),
        });

      const result = await service.getTaxSummaryReport(testUserId, 2024);

      expect(result.financialYear).toBe(2024);
      expect(result.yearStart).toBe('2024-04-01');
      expect(result.yearEnd).toBe('2025-03-31');
      expect(result.totalMiles).toBe(70);
      expect(result.totalMileageAllowance).toBe(31.5); // 70 * 0.45
      expect(result.quarterlyBreakdown).toHaveLength(4);
    });
  });

  describe('getReportSettings', () => {
    it('should return default settings when none exist', async () => {
      mockSupabase.from.mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue({
              data: null,
              error: { code: 'PGRST116' },
            }),
          }),
        }),
      });

      const result = await service.getReportSettings(testUserId);

      expect(result.financialYearStartMonth).toBe(4);
      expect(result.defaultCurrency).toBe('GBP');
      expect(result.mileageRate).toBe(0.45);
    });

    it('should merge saved settings with defaults', async () => {
      mockSupabase.from.mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue({
              data: { report_settings: { mileageRate: 0.50, businessName: 'Test Business' } },
              error: null,
            }),
          }),
        }),
      });

      const result = await service.getReportSettings(testUserId);

      expect(result.mileageRate).toBe(0.50);
      expect(result.businessName).toBe('Test Business');
      expect(result.defaultCurrency).toBe('GBP'); // Default value
    });
  });

  describe('updateReportSettings', () => {
    it('should update settings', async () => {
      // Mock getReportSettings
      mockSupabase.from
        .mockReturnValueOnce({
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({
                data: { report_settings: {} },
                error: null,
              }),
            }),
          }),
        })
        .mockReturnValueOnce({
          upsert: vi.fn().mockResolvedValue({ error: null }),
        });

      const result = await service.updateReportSettings(testUserId, {
        mileageRate: 0.55,
        businessName: 'New Business',
      });

      expect(result.mileageRate).toBe(0.55);
      expect(result.businessName).toBe('New Business');
    });
  });
});
