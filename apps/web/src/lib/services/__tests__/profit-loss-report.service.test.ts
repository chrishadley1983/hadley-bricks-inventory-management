import { describe, it, expect, vi } from 'vitest';
import { ProfitLossReportService } from '../profit-loss-report.service';

/**
 * Creates a comprehensive mock for Supabase queries.
 * Returns data based on the table and query parameters.
 */
function createSupabaseMock(mockData: Record<string, unknown[]> = {}) {
  const createChainableResult = (data: unknown[], error: unknown = null) => ({
    data,
    error,
  });

  const chainableMock = (tableName: string) => {
    const tableData = mockData[tableName] || [];

    const chain = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      in: vi.fn().mockReturnThis(),
      lt: vi.fn().mockReturnThis(),
      gte: vi.fn().mockReturnThis(),
      lte: vi.fn().mockReturnThis(),
      range: vi.fn().mockImplementation(() => createChainableResult(tableData)),
      order: vi.fn().mockReturnThis(),
      limit: vi.fn().mockImplementation(() => {
        // For findEarliestDate queries, return first item if available
        return createChainableResult(tableData.length > 0 ? [tableData[0]] : []);
      }),
    };

    return chain;
  };

  return {
    from: vi.fn().mockImplementation((table: string) => chainableMock(table)),
  };
}

describe('ProfitLossReportService', () => {
  const testUserId = 'test-user-id';

  describe('generateReport', () => {
    it('should generate a report with correct structure', async () => {
      const mockSupabase = createSupabaseMock();
      const service = new ProfitLossReportService(mockSupabase as never);

      const result = await service.generateReport(testUserId, {
        startMonth: '2024-01',
        endMonth: '2024-03',
      });

      expect(result).toHaveProperty('generatedAt');
      expect(result).toHaveProperty('dateRange');
      expect(result).toHaveProperty('months');
      expect(result).toHaveProperty('rows');
      expect(result).toHaveProperty('categoryTotals');
      expect(result).toHaveProperty('grandTotal');

      expect(result.dateRange.startMonth).toBe('2024-01');
      expect(result.dateRange.endMonth).toBe('2024-03');
      expect(result.months).toEqual(['2024-01', '2024-02', '2024-03']);
    });

    it('should include all 5 categories in categoryTotals', async () => {
      const mockSupabase = createSupabaseMock();
      const service = new ProfitLossReportService(mockSupabase as never);

      const result = await service.generateReport(testUserId, {
        startMonth: '2024-01',
        endMonth: '2024-01',
      });

      expect(result.categoryTotals).toHaveProperty('Income');
      expect(result.categoryTotals).toHaveProperty('Selling Fees');
      expect(result.categoryTotals).toHaveProperty('Stock Purchase');
      expect(result.categoryTotals).toHaveProperty('Packing & Postage');
      expect(result.categoryTotals).toHaveProperty('Bills');
    });

    it('should generate correct month range across years', async () => {
      const mockSupabase = createSupabaseMock();
      const service = new ProfitLossReportService(mockSupabase as never);

      const result = await service.generateReport(testUserId, {
        startMonth: '2024-10',
        endMonth: '2025-02',
      });

      expect(result.months).toEqual([
        '2024-10',
        '2024-11',
        '2024-12',
        '2025-01',
        '2025-02',
      ]);
    });

    it('should initialize category totals to zero for all months', async () => {
      const mockSupabase = createSupabaseMock();
      const service = new ProfitLossReportService(mockSupabase as never);

      const result = await service.generateReport(testUserId, {
        startMonth: '2024-01',
        endMonth: '2024-02',
      });

      // All categories should have values for all months
      const categories = [
        'Income',
        'Selling Fees',
        'Stock Purchase',
        'Packing & Postage',
        'Bills',
      ] as const;

      for (const category of categories) {
        expect(result.categoryTotals[category]).toHaveProperty('2024-01');
        expect(result.categoryTotals[category]).toHaveProperty('2024-02');
        expect(typeof result.categoryTotals[category]['2024-01']).toBe('number');
        expect(typeof result.categoryTotals[category]['2024-02']).toBe('number');
      }
    });

    it('should return empty rows when no data and includeZeroRows is false', async () => {
      const mockSupabase = createSupabaseMock();
      const service = new ProfitLossReportService(mockSupabase as never);

      const result = await service.generateReport(testUserId, {
        startMonth: '2024-01',
        endMonth: '2024-01',
        includeZeroRows: false,
      });

      expect(result.rows).toEqual([]);
    });

    it('should have grandTotal for all months', async () => {
      const mockSupabase = createSupabaseMock();
      const service = new ProfitLossReportService(mockSupabase as never);

      const result = await service.generateReport(testUserId, {
        startMonth: '2024-01',
        endMonth: '2024-03',
      });

      expect(result.grandTotal).toHaveProperty('2024-01');
      expect(result.grandTotal).toHaveProperty('2024-02');
      expect(result.grandTotal).toHaveProperty('2024-03');
    });

    it('should handle errors gracefully with empty data', async () => {
      const mockSupabase = {
        from: vi.fn().mockImplementation(() => ({
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          in: vi.fn().mockReturnThis(),
          lt: vi.fn().mockReturnThis(),
          gte: vi.fn().mockReturnThis(),
          lte: vi.fn().mockReturnThis(),
          range: vi.fn().mockRejectedValue(new Error('Database error')),
          order: vi.fn().mockReturnThis(),
          limit: vi.fn().mockResolvedValue({ data: [], error: null }),
        })),
      };

      const service = new ProfitLossReportService(mockSupabase as never);

      // Should not throw, should handle errors gracefully with empty data
      const result = await service.generateReport(testUserId, {
        startMonth: '2024-01',
        endMonth: '2024-01',
      });

      expect(result).toBeDefined();
      expect(result.rows).toEqual([]);
    });

    it('should set correct dateRange in response', async () => {
      const mockSupabase = createSupabaseMock();
      const service = new ProfitLossReportService(mockSupabase as never);

      const result = await service.generateReport(testUserId, {
        startMonth: '2023-06',
        endMonth: '2024-12',
      });

      expect(result.dateRange).toEqual({
        startMonth: '2023-06',
        endMonth: '2024-12',
      });
    });

    it('should generate valid ISO timestamp in generatedAt', async () => {
      const mockSupabase = createSupabaseMock();
      const service = new ProfitLossReportService(mockSupabase as never);

      const result = await service.generateReport(testUserId, {
        startMonth: '2024-01',
        endMonth: '2024-01',
      });

      // Should be a valid ISO date string
      expect(() => new Date(result.generatedAt)).not.toThrow();
      expect(new Date(result.generatedAt).toISOString()).toBe(result.generatedAt);
    });
  });

  describe('row definitions', () => {
    it('should define 26 row types across all categories', async () => {
      // This test verifies the service structure by checking the total rows when includeZeroRows is true
      const mockSupabase = createSupabaseMock();
      const service = new ProfitLossReportService(mockSupabase as never);

      const result = await service.generateReport(testUserId, {
        startMonth: '2024-01',
        endMonth: '2024-01',
        includeZeroRows: true,
      });

      // Count rows by category
      const incomeRows = result.rows.filter((r) => r.category === 'Income');
      const sellingFeesRows = result.rows.filter(
        (r) => r.category === 'Selling Fees'
      );
      const stockPurchaseRows = result.rows.filter(
        (r) => r.category === 'Stock Purchase'
      );
      const packingRows = result.rows.filter(
        (r) => r.category === 'Packing & Postage'
      );
      const billsRows = result.rows.filter((r) => r.category === 'Bills');

      // Expected row counts per category
      expect(incomeRows.length).toBe(6); // eBay Gross Sales, eBay Refunds, BrickLink, Brick Owl, Amazon Sales, Amazon Refunds
      expect(sellingFeesRows.length).toBe(10); // BrickLink Fees, Amazon Fees, 8 eBay fee types
      expect(stockPurchaseRows.length).toBe(2); // Lego Stock, Lego Parts
      expect(packingRows.length).toBe(2); // Postage, Packing Materials
      expect(billsRows.length).toBe(5); // Amazon Sub, Banking, Website, Office, Mileage

      // Total should be 25 rows (6 income + 10 selling fees + 2 stock + 2 packing + 5 bills)
      expect(result.rows.length).toBe(25);
    });

    it('should include expected Income row types', async () => {
      const mockSupabase = createSupabaseMock();
      const service = new ProfitLossReportService(mockSupabase as never);

      const result = await service.generateReport(testUserId, {
        startMonth: '2024-01',
        endMonth: '2024-01',
        includeZeroRows: true,
      });

      const incomeRowTypes = result.rows
        .filter((r) => r.category === 'Income')
        .map((r) => r.transactionType);

      expect(incomeRowTypes).toContain('eBay Gross Sales');
      expect(incomeRowTypes).toContain('eBay Refunds');
      expect(incomeRowTypes).toContain('BrickLink Gross Sales');
      expect(incomeRowTypes).toContain('Amazon Sales');
      expect(incomeRowTypes).toContain('Amazon Refunds');
    });

    it('should include expected Selling Fees row types', async () => {
      const mockSupabase = createSupabaseMock();
      const service = new ProfitLossReportService(mockSupabase as never);

      const result = await service.generateReport(testUserId, {
        startMonth: '2024-01',
        endMonth: '2024-01',
        includeZeroRows: true,
      });

      const feeRowTypes = result.rows
        .filter((r) => r.category === 'Selling Fees')
        .map((r) => r.transactionType);

      expect(feeRowTypes).toContain('BrickLink Fees');
      expect(feeRowTypes).toContain('Amazon Fees');
      expect(feeRowTypes).toContain('eBay Insertion Fees');
      expect(feeRowTypes).toContain('eBay Ad Fees - Standard');
      expect(feeRowTypes).toContain('eBay Variable Fees');
      expect(feeRowTypes).toContain('eBay Regulatory Fees');
      expect(feeRowTypes).toContain('eBay Shop Fee');
    });

    it('should include expected Bills row types', async () => {
      const mockSupabase = createSupabaseMock();
      const service = new ProfitLossReportService(mockSupabase as never);

      const result = await service.generateReport(testUserId, {
        startMonth: '2024-01',
        endMonth: '2024-01',
        includeZeroRows: true,
      });

      const billsRowTypes = result.rows
        .filter((r) => r.category === 'Bills')
        .map((r) => r.transactionType);

      expect(billsRowTypes).toContain('Amazon Subscription');
      expect(billsRowTypes).toContain('Banking Fees / Subscriptions');
      expect(billsRowTypes).toContain('Website');
      expect(billsRowTypes).toContain('Office');
      expect(billsRowTypes).toContain('Mileage');
    });
  });

  describe('findEarliestDate', () => {
    it('should use earliest date from data when no startMonth provided', async () => {
      // Create mock with data from 2023
      const mockSupabase = {
        from: vi.fn().mockImplementation((table: string) => ({
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          in: vi.fn().mockReturnThis(),
          lt: vi.fn().mockReturnThis(),
          gte: vi.fn().mockReturnThis(),
          lte: vi.fn().mockReturnThis(),
          range: vi.fn().mockResolvedValue({ data: [], error: null }),
          order: vi.fn().mockReturnThis(),
          limit: vi.fn().mockImplementation(() => {
            // Return early date for ebay_transactions only
            if (table === 'ebay_transactions') {
              return { data: [{ transaction_date: '2023-06-15' }], error: null };
            }
            return { data: [], error: null };
          }),
        })),
      };

      const service = new ProfitLossReportService(mockSupabase as never);

      const result = await service.generateReport(testUserId, {
        endMonth: '2023-08',
      });

      // Should start from 2023-06 (earliest eBay transaction)
      expect(result.dateRange.startMonth).toBe('2023-06');
      expect(result.months[0]).toBe('2023-06');
    });

    it('should default to current month when no data exists', async () => {
      const mockSupabase = createSupabaseMock();
      const service = new ProfitLossReportService(mockSupabase as never);

      const currentMonth = new Date();
      const expectedMonth = `${currentMonth.getFullYear()}-${String(currentMonth.getMonth() + 1).padStart(2, '0')}`;

      const result = await service.generateReport(testUserId, {
        endMonth: expectedMonth,
      });

      // Should default to current month
      expect(result.dateRange.startMonth).toBe(expectedMonth);
    });
  });
});
