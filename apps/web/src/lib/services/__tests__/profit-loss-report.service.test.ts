import { describe, it, expect, vi } from 'vitest';
import { ProfitLossReportService, sumAmazonBreakdown } from '../profit-loss-report.service';

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
      neq: vi.fn().mockReturnThis(),
      in: vi.fn().mockReturnThis(),
      not: vi.fn().mockReturnThis(),
      gt: vi.fn().mockReturnThis(),
      lt: vi.fn().mockReturnThis(),
      gte: vi.fn().mockReturnThis(),
      lte: vi.fn().mockReturnThis(),
      or: vi.fn().mockReturnThis(),
      is: vi.fn().mockReturnThis(),
      // range no longer terminates the chain: fetchAllRecords (now used by the
      // service) chains filters AFTER .range(), so the chain must stay
      // chainable and instead be awaitable via the `then` below.
      range: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      limit: vi.fn().mockImplementation(() => {
        // For findEarliestDate queries, return first item if available
        return createChainableResult(tableData.length > 0 ? [tableData[0]] : []);
      }),
      // Make the chain awaitable; resolves to this table's mock rows.
      then: (onFulfilled: (r: unknown) => unknown, onRejected?: (e: unknown) => unknown) =>
        Promise.resolve(createChainableResult(tableData)).then(onFulfilled, onRejected),
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

      expect(result.months).toEqual(['2024-10', '2024-11', '2024-12', '2025-01', '2025-02']);
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

    // HMRC standard tax periods run 6th–5th, so a quarter is a DATE range, not
    // a month range. These guard the exact-date override used by the SA103F
    // bridging generator (scripts/mtd-sa103-boxes.ts).
    describe('exact-date bounds (HMRC standard tax periods)', () => {
      it('passes explicit startDate/endDateExclusive to the row queries', async () => {
        const mockSupabase = createSupabaseMock();
        const service = new ProfitLossReportService(mockSupabase as never);

        await service.generateReport(testUserId, {
          startDate: '2026-04-06',
          endDateExclusive: '2026-07-06',
          basis: 'cash',
        });

        const ebayChain = mockSupabase.from.mock.results
          .map((r) => r.value)
          .find((c) => c.gte.mock.calls.length > 0);
        expect(ebayChain.gte).toHaveBeenCalledWith(expect.any(String), '2026-04-06');
        expect(ebayChain.lt).toHaveBeenCalledWith(expect.any(String), '2026-07-06');
      });

      it('keeps a month bucket for the partial first and last months', async () => {
        const mockSupabase = createSupabaseMock();
        const service = new ProfitLossReportService(mockSupabase as never);

        const result = await service.generateReport(testUserId, {
          startDate: '2026-04-06',
          endDateExclusive: '2026-07-06',
        });

        // 1–5 Jul is in range, so July must NOT be trimmed off the end.
        expect(result.months).toEqual(['2026-04', '2026-05', '2026-06', '2026-07']);
        expect(result.dateRange).toEqual({ startMonth: '2026-04', endMonth: '2026-07' });
      });

      it('trims the trailing month when the exclusive end is the 1st', async () => {
        const mockSupabase = createSupabaseMock();
        const service = new ProfitLossReportService(mockSupabase as never);

        const result = await service.generateReport(testUserId, {
          startDate: '2026-04-01',
          endDateExclusive: '2026-07-01',
        });

        expect(result.months).toEqual(['2026-04', '2026-05', '2026-06']);
      });

      it('rolls the trailing month back across a year boundary', async () => {
        const mockSupabase = createSupabaseMock();
        const service = new ProfitLossReportService(mockSupabase as never);

        // Q3 of a standard tax year ends 5 Jan — January must stay in range.
        const q3 = await service.generateReport(testUserId, {
          startDate: '2026-10-06',
          endDateExclusive: '2027-01-06',
        });
        expect(q3.months).toEqual(['2026-10', '2026-11', '2026-12', '2027-01']);

        // Whereas an exclusive 1 Jan bound must NOT reach into January.
        const toYearEnd = await service.generateReport(testUserId, {
          startDate: '2026-10-01',
          endDateExclusive: '2027-01-01',
        });
        expect(toYearEnd.months).toEqual(['2026-10', '2026-11', '2026-12']);
      });

      it('rejects malformed or impossible date bounds instead of degrading', async () => {
        const mockSupabase = createSupabaseMock();
        const service = new ProfitLossReportService(mockSupabase as never);

        await expect(
          service.generateReport(testUserId, { startDate: '06/04/2026' })
        ).rejects.toThrow(/startDate must be 'YYYY-MM-DD'/);

        await expect(
          service.generateReport(testUserId, { endDateExclusive: '2026-02-30' })
        ).rejects.toThrow(/not a real calendar date/);

        await expect(
          service.generateReport(testUserId, {
            startDate: '2026-07-06',
            endDateExclusive: '2026-04-06',
          })
        ).rejects.toThrow(/must be before/);
      });

      it('still honours month bounds when no dates are supplied', async () => {
        const mockSupabase = createSupabaseMock();
        const service = new ProfitLossReportService(mockSupabase as never);

        const result = await service.generateReport(testUserId, {
          startMonth: '2026-04',
          endMonth: '2026-06',
        });

        expect(result.months).toEqual(['2026-04', '2026-05', '2026-06']);
        const chain = mockSupabase.from.mock.results
          .map((r) => r.value)
          .find((c) => c.gte.mock.calls.length > 0);
        expect(chain.gte).toHaveBeenCalledWith(expect.any(String), '2026-04-01');
        expect(chain.lt).toHaveBeenCalledWith(expect.any(String), '2026-07-01');
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
    it('should define 32 row types across all categories', async () => {
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
      const sellingFeesRows = result.rows.filter((r) => r.category === 'Selling Fees');
      const stockPurchaseRows = result.rows.filter((r) => r.category === 'Stock Purchase');
      const packingRows = result.rows.filter((r) => r.category === 'Packing & Postage');
      const billsRows = result.rows.filter((r) => r.category === 'Bills');
      const homeCostsRows = result.rows.filter((r) => r.category === 'Home Costs');

      // Expected row counts per category (accrual basis, the default)
      // Shopify was added 2026-07-25: real trading income once the store started
      // selling, previously omitted from both bases. Refunds + fees rows added
      // 2026-08-07 with the shopify_transactions ingestion.
      expect(incomeRows.length).toBe(8); // eBay Gross Sales, eBay Refunds, BrickLink, Brick Owl, Shopify Sales, Shopify Refunds, Amazon Sales, Amazon Refunds
      expect(sellingFeesRows.length).toBe(13); // BL/BO/Bricqer, Amazon, PayPal, Shopify, 9 eBay fee types (incl. Promoted Offsite)
      expect(stockPurchaseRows.length).toBe(2); // Lego Stock, Lego Parts
      expect(packingRows.length).toBe(3); // Postage, eBay Postage Labels, Packing Materials
      expect(billsRows.length).toBe(5); // Amazon Sub, Banking, Website / Software, Office, Mileage
      expect(homeCostsRows.length).toBe(3); // Use of Home, Phone & Broadband, Insurance

      // Total should be 34 rows (8 income + 13 selling fees + 2 stock + 3 packing + 5 bills + 3 home costs)
      expect(result.rows.length).toBe(34);
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

      expect(feeRowTypes).toContain('BrickLink / Brick Owl / Bricqer Fees');
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
      expect(billsRowTypes).toContain('Website / Software');
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

  // These guard the four defects the 2026-07-25 MTD validation caught, each of
  // which had silently misstated a tax return.
  describe('Amazon breakdown sums (DigitalServicesFee defect)', () => {
    // Shape taken verbatim from a live 2026-04 Shipment event.
    const shipment = [
      {
        breakdownType: 'Sales',
        breakdownAmount: { currencyAmount: 31.49 },
        breakdowns: [
          {
            breakdownType: 'ProductCharges',
            breakdownAmount: { currencyAmount: 31.49 },
            breakdowns: null,
          },
        ],
      },
      {
        breakdownType: 'Expenses',
        breakdownAmount: { currencyAmount: -4.83 },
        breakdowns: [
          {
            breakdownType: 'DigitalServicesFee',
            breakdownAmount: { currencyAmount: -0.11 },
            breakdowns: [
              {
                breakdownType: 'DigitalServicesFee',
                breakdownAmount: { currencyAmount: -0.11 },
                breakdowns: [
                  { breakdownType: 'Base', breakdownAmount: { currencyAmount: -0.09 }, breakdowns: [] },
                  { breakdownType: 'Tax', breakdownAmount: { currencyAmount: -0.02 }, breakdowns: [] },
                ],
              },
            ],
          },
          {
            breakdownType: 'AmazonFees',
            breakdownAmount: { currencyAmount: -4.72 },
            breakdowns: [
              { breakdownType: 'Commission', breakdownAmount: { currencyAmount: -4.72 }, breakdowns: [] },
            ],
          },
        ],
      },
    ];

    it('does not double-count a type restated by its own children', () => {
      // DSF appears at three depths (-0.11, -0.11, and -0.09/-0.02). Descending
      // into a match would return -0.22 or worse.
      expect(sumAmazonBreakdown(shipment, /^DigitalServicesFee$/i)).toBeCloseTo(-0.11, 2);
    });

    it('reads gross sales and total fees from the tree, DSF included', () => {
      expect(sumAmazonBreakdown(shipment, /^Sales$/i)).toBeCloseTo(31.49, 2);
      // Expenses must carry Commission AND DSF — 4.72 + 0.11. The old
      // total_fees/referral_fee columns returned 4.72 and dropped the 0.11.
      expect(sumAmazonBreakdown(shipment, /^Expenses$/i)).toBeCloseTo(-4.83, 2);
    });

    it('separates refunded sales from refunded fee credits', () => {
      const refund = [
        {
          breakdownType: 'Refunded Sales',
          breakdownAmount: { currencyAmount: -36.76 },
          breakdowns: [
            { breakdownType: 'ProductCharges', breakdownAmount: { currencyAmount: -36.76 }, breakdowns: null },
          ],
        },
        {
          breakdownType: 'Refunded Expenses',
          breakdownAmount: { currencyAmount: 5.44 },
          breakdowns: [
            { breakdownType: 'AmazonFees', breakdownAmount: { currencyAmount: 5.3 }, breakdowns: null },
            { breakdownType: 'DigitalServicesFee', breakdownAmount: { currencyAmount: 0.14 }, breakdowns: null },
          ],
        },
      ];
      // Only -36.76 reduces turnover; the 5.44 is a fee credit for the fees row.
      expect(sumAmazonBreakdown(refund, /^Refunded Sales$/i)).toBeCloseTo(-36.76, 2);
      expect(sumAmazonBreakdown(refund, /^Refunded Expenses$/i)).toBeCloseTo(5.44, 2);
    });

    it('returns 0 for missing or empty breakdowns rather than throwing', () => {
      expect(sumAmazonBreakdown(null, /^Sales$/i)).toBe(0);
      expect(sumAmazonBreakdown(undefined, /^Sales$/i)).toBe(0);
      expect(sumAmazonBreakdown([], /^Sales$/i)).toBe(0);
    });
  });

  describe('"fully refunded" eBay orders are kept on BOTH bases', () => {
    // Two defects came out of excluding these sales, so the exclusion is gone:
    //   1. double deduction — the refunds row already deducts the money
    //   2. `order_payment_status` is unreliable — 4 orders (£252.23) are flagged
    //      FULLY_REFUNDED while their own payment_summary says refunds:[],
    //      paymentStatus:PAID, cancelState:NONE_REQUESTED
    const mockData = {
      ebay_orders: [{ ebay_order_id: 'REFUNDED-1', order_payment_status: 'FULLY_REFUNDED' }],
      ebay_transactions: [
        {
          transaction_date: '2026-05-15T10:00:00+00:00',
          gross_transaction_amount: 28.75,
          ebay_order_id: 'REFUNDED-1',
          transaction_type: 'SALE',
          amount: 28.75,
          raw_response: null,
          booking_entry: 'CREDIT',
        },
      ],
    };

    for (const basis of ['accrual', 'cash'] as const) {
      it(`${basis} counts the receipt, because the refunds row deducts the money`, async () => {
        const mockSupabase = createSupabaseMock(mockData);
        const service = new ProfitLossReportService(mockSupabase as never);

        const result = await service.generateReport(testUserId, {
          startMonth: '2026-05',
          endMonth: '2026-05',
          basis,
        });

        const gross = result.rows.find((r) => r.transactionType === 'eBay Gross Sales');
        expect(gross?.total).toBeCloseTo(28.75, 2);
      });
    }
  });

  describe('failedRows', () => {
    it('is empty on a healthy report', async () => {
      const mockSupabase = createSupabaseMock();
      const service = new ProfitLossReportService(mockSupabase as never);

      const result = await service.generateReport(testUserId, {
        startMonth: '2026-05',
        endMonth: '2026-05',
      });

      expect(result.failedRows).toEqual([]);
    });

    it('names every row whose query threw, so £0 cannot pass as quiet', async () => {
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

      const result = await service.generateReport(testUserId, {
        startMonth: '2026-05',
        endMonth: '2026-05',
      });

      // The rows vanish from `rows` via the zero-row filter — failedRows is the
      // only remaining evidence, and the MTD export refuses to file without it.
      expect(result.rows).toEqual([]);
      expect(result.failedRows.length).toBeGreaterThan(0);
      expect(result.failedRows.map((f) => f.transactionType)).toContain('Lego Stock Purchases');
      // Every failure must carry a reason to act on (the message varies by which
      // part of the chain broke).
      for (const failure of result.failedRows) {
        expect(failure.error).toBeTruthy();
        expect(typeof failure.error).toBe('string');
      }
    });
  });
});
