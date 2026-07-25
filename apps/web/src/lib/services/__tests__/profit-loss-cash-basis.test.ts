/**
 * Cash-basis P&L report tests.
 *
 * These figures feed HMRC MTD submissions, so the mock Supabase client here is
 * FILTER-AWARE: eq/in/gt/lt/gte/lte are applied to the seeded rows exactly as
 * PostgREST would, meaning the tests exercise the real query semantics
 * (status filtering, event codes, date windows) rather than passing everything
 * through.
 */
import { describe, it, expect, vi } from 'vitest';
import { ProfitLossReportService } from '../profit-loss-report.service';

type Row = Record<string, unknown>;

/** Filter-aware chainable Supabase mock. */
function createFilterAwareSupabaseMock(mockData: Record<string, Row[]> = {}) {
  const chainableMock = (tableName: string) => {
    const tableData = mockData[tableName] || [];
    type Cond = { op: string; col: string; value: unknown };
    const conds: Cond[] = [];
    let limitN: number | null = null;

    const applyConds = (rows: Row[]): Row[] =>
      rows.filter((row) =>
        conds.every(({ op, col, value }) => {
          const v = row[col];
          switch (op) {
            case 'eq':
              return v === value;
            case 'neq':
              return v !== value;
            case 'gt':
              return v !== null && v !== undefined && (v as never) > (value as never);
            case 'lt':
              return v !== null && v !== undefined && (v as never) < (value as never);
            case 'gte':
              return v !== null && v !== undefined && (v as never) >= (value as never);
            case 'lte':
              return v !== null && v !== undefined && (v as never) <= (value as never);
            case 'in':
              return (value as unknown[]).includes(v);
            case 'not-in':
              return !(value as unknown[]).includes(v);
            default:
              return true;
          }
        })
      );

    const push = (op: string) => (col: string, value: unknown) => {
      conds.push({ op, col, value });
      return chain;
    };

    const chain: Record<string, unknown> = {
      select: vi.fn().mockImplementation(() => chain),
      eq: vi.fn().mockImplementation(push('eq')),
      neq: vi.fn().mockImplementation(push('neq')),
      gt: vi.fn().mockImplementation(push('gt')),
      lt: vi.fn().mockImplementation(push('lt')),
      gte: vi.fn().mockImplementation(push('gte')),
      lte: vi.fn().mockImplementation(push('lte')),
      in: vi.fn().mockImplementation(push('in')),
      not: vi.fn().mockImplementation((col: string, op: string, value: string) => {
        if (op === 'in') {
          const values = value
            .replace(/^\(/, '')
            .replace(/\)$/, '')
            .split(',')
            .map((s) => s.trim());
          conds.push({ op: 'not-in', col, value: values });
        }
        return chain;
      }),
      or: vi.fn().mockImplementation(() => chain),
      is: vi.fn().mockImplementation(() => chain),
      range: vi.fn().mockImplementation(() => chain),
      order: vi.fn().mockImplementation(() => chain),
      limit: vi.fn().mockImplementation((n: number) => {
        limitN = n;
        return chain;
      }),
      then: (onFulfilled: (r: unknown) => unknown, onRejected?: (e: unknown) => unknown) => {
        let rows = applyConds(tableData);
        if (limitN !== null) rows = rows.slice(0, limitN);
        return Promise.resolve({ data: rows, error: null }).then(onFulfilled, onRejected);
      },
    };

    return chain;
  };

  return {
    from: vi.fn().mockImplementation((table: string) => chainableMock(table)),
  };
}

const USER = 'test-user-id';

function getRow(result: { rows: Array<{ transactionType: string }> }, transactionType: string) {
  return result.rows.find((r) => r.transactionType === transactionType) as
    | { transactionType: string; monthlyValues: Record<string, number>; category: string }
    | undefined;
}

/**
 * Amazon money comes from the `breakdowns` tree, never the flat columns —
 * `gross_sales_amount` is NET of the DigitalServicesFee and `total_fees` is
 * Commission only, so both drop DSF (found 2026-07-25 misstating a live HMRC
 * return). These fixtures therefore set the flat columns to the DSF-light values
 * they really carry, so any regression back to a column fails loudly instead of
 * quietly agreeing.
 */
function shipmentBreakdowns(sales: number, commission: number, dsf: number) {
  return [
    {
      breakdownType: 'Sales',
      breakdownAmount: { currencyCode: 'GBP', currencyAmount: sales },
      breakdowns: [
        {
          breakdownType: 'ProductCharges',
          breakdownAmount: { currencyCode: 'GBP', currencyAmount: sales },
          breakdowns: null,
        },
      ],
    },
    {
      breakdownType: 'Expenses',
      breakdownAmount: { currencyCode: 'GBP', currencyAmount: -(commission + dsf) },
      breakdowns: [
        {
          breakdownType: 'AmazonFees',
          breakdownAmount: { currencyCode: 'GBP', currencyAmount: -commission },
          breakdowns: [
            {
              breakdownType: 'Commission',
              breakdownAmount: { currencyCode: 'GBP', currencyAmount: -commission },
              breakdowns: [],
            },
          ],
        },
        {
          breakdownType: 'DigitalServicesFee',
          breakdownAmount: { currencyCode: 'GBP', currencyAmount: -dsf },
          breakdowns: null,
        },
      ],
    },
  ];
}

function refundBreakdowns(refundedSales: number, refundedFees: number) {
  return [
    {
      breakdownType: 'Refunded Sales',
      breakdownAmount: { currencyCode: 'GBP', currencyAmount: -refundedSales },
      breakdowns: null,
    },
    {
      breakdownType: 'Refunded Expenses',
      breakdownAmount: { currencyCode: 'GBP', currencyAmount: refundedFees },
      breakdowns: null,
    },
  ];
}

describe('P&L completeness guards (2026-07-25 validation round 2)', () => {
  /**
   * Amazon `Reserve` adjustments hold Sales +X and Expenses −X — a balance
   * movement netting to exactly zero. Taking one side inflates that side by
   * £6,263.55 across the account (a full year of expenses came out £4,945.88
   * heavy before this was caught); taking both inflates turnover by the same.
   * They must be excluded outright.
   */
  const reserveRow = {
    user_id: USER,
    transaction_type: 'Adjustment',
    transaction_status: 'RELEASED',
    description: 'Reserve',
    posted_date: '2026-06-15T10:00:00+00:00',
    total_amount: 0,
    breakdowns: [
      { breakdownType: 'Sales', breakdownAmount: { currencyAmount: 2754.35 }, breakdowns: [] },
      {
        breakdownType: 'Expenses',
        breakdownAmount: { currencyAmount: -2754.35 },
        breakdowns: [
          { breakdownType: 'ReserveDebit', breakdownAmount: { currencyAmount: -2754.35 }, breakdowns: null },
        ],
      },
    ],
  };

  const returnPostageRow = {
    user_id: USER,
    transaction_type: 'Adjustment',
    transaction_status: 'RELEASED',
    description: 'LabmanLabelReturn',
    posted_date: '2026-06-20T10:00:00+00:00',
    total_amount: -3.28,
    breakdowns: [
      { breakdownType: 'Sales', breakdownAmount: { currencyAmount: 0 }, breakdowns: [] },
      {
        breakdownType: 'Expenses',
        breakdownAmount: { currencyAmount: -3.28 },
        breakdowns: [
          { breakdownType: 'Other', breakdownAmount: { currencyAmount: -3.28 }, breakdowns: null },
        ],
      },
    ],
  };

  it('excludes Reserve adjustments from BOTH sales and fees', async () => {
    const supabase = createFilterAwareSupabaseMock({
      amazon_transactions: [reserveRow, returnPostageRow],
    });
    const service = new ProfitLossReportService(supabase as never);

    const result = await service.generateReport(USER, {
      startMonth: '2026-06',
      endMonth: '2026-06',
      basis: 'cash',
    });

    expect(result.failedRows).toEqual([]);
    // The reserve's £2,754.35 must appear on neither side.
    const sales = getRow(result, 'Amazon Sales (funds released)');
    expect(sales?.monthlyValues['2026-06'] ?? 0).toBe(0);
    // Only the genuine £3.28 of return postage is a cost.
    const fees = getRow(result, 'Amazon Fees');
    expect(fees!.monthlyValues['2026-06']).toBeCloseTo(-3.28, 2);
  });

  it('counts Adjustment return postage that the Shipment-only query missed', async () => {
    const supabase = createFilterAwareSupabaseMock({ amazon_transactions: [returnPostageRow] });
    const service = new ProfitLossReportService(supabase as never);

    const result = await service.generateReport(USER, {
      startMonth: '2026-06',
      endMonth: '2026-06',
      basis: 'cash',
    });

    expect(getRow(result, 'Amazon Fees')!.monthlyValues['2026-06']).toBeCloseTo(-3.28, 2);
  });

  it('refuses to report an unclassified Amazon transaction_type', async () => {
    const supabase = createFilterAwareSupabaseMock({
      amazon_transactions: [
        { ...returnPostageRow, transaction_type: 'SomeNewAmazonThing', description: null },
      ],
    });
    const service = new ProfitLossReportService(supabase as never);

    const result = await service.generateReport(USER, {
      startMonth: '2026-06',
      endMonth: '2026-06',
      basis: 'cash',
    });

    // Fails the row rather than silently omitting the money.
    expect(result.failedRows.map((f) => f.transactionType)).toContain('Amazon Fees');
    expect(result.failedRows.find((f) => f.transactionType === 'Amazon Fees')!.error).toMatch(
      /Unclassified Amazon transaction_type/
    );
  });

  it('refuses to report an unclassified Adjustment description', async () => {
    const supabase = createFilterAwareSupabaseMock({
      amazon_transactions: [{ ...returnPostageRow, description: 'SomeNewAdjustmentKind' }],
    });
    const service = new ProfitLossReportService(supabase as never);

    const result = await service.generateReport(USER, {
      startMonth: '2026-06',
      endMonth: '2026-06',
      basis: 'cash',
    });

    expect(result.failedRows.find((f) => f.transactionType === 'Amazon Fees')!.error).toMatch(
      /Unclassified Amazon Adjustment description/
    );
  });

  it('refuses to report an unclassified PayPal money-in event code', async () => {
    const supabase = createFilterAwareSupabaseMock({
      paypal_transactions: [
        {
          user_id: USER,
          transaction_event_code: 'T9999',
          transaction_type: null,
          transaction_date: '2026-06-05T09:00:00+00:00',
          gross_amount: 42,
          fee_amount: -1,
        },
      ],
    });
    const service = new ProfitLossReportService(supabase as never);

    const result = await service.generateReport(USER, {
      startMonth: '2026-06',
      endMonth: '2026-06',
      basis: 'cash',
    });

    const failure = result.failedRows.find((f) =>
      f.transactionType.startsWith('BrickLink Sales')
    );
    expect(failure?.error).toMatch(/Unclassified PayPal money-in event code/);
  });

  it('refuses to report an unclassified eBay transaction_type', async () => {
    const supabase = createFilterAwareSupabaseMock({
      ebay_transactions: [
        {
          user_id: USER,
          transaction_type: 'SOME_NEW_EBAY_THING',
          booking_entry: 'DEBIT',
          transaction_date: '2026-06-10T10:00:00+00:00',
          amount: 42,
          raw_response: null,
        },
      ],
    });
    const service = new ProfitLossReportService(supabase as never);

    const result = await service.generateReport(USER, {
      startMonth: '2026-06',
      endMonth: '2026-06',
      basis: 'cash',
    });

    const failure = result.failedRows.find((f) => f.transactionType === 'eBay Postage Labels');
    expect(failure?.error).toMatch(/Unclassified eBay transaction_type/);
  });

  it('claims SHIPPING_LABEL postage, which previously reached no box', async () => {
    const supabase = createFilterAwareSupabaseMock({
      ebay_transactions: [
        {
          user_id: USER,
          transaction_type: 'SHIPPING_LABEL',
          booking_entry: 'DEBIT',
          transaction_date: '2026-06-10T10:00:00+00:00',
          amount: 4.15,
          raw_response: null,
        },
      ],
    });
    const service = new ProfitLossReportService(supabase as never);

    const result = await service.generateReport(USER, {
      startMonth: '2026-06',
      endMonth: '2026-06',
      basis: 'cash',
    });

    expect(result.failedRows).toEqual([]);
    const labels = getRow(result, 'eBay Postage Labels');
    expect(labels!.monthlyValues['2026-06']).toBeCloseTo(-4.15, 2);
    expect(labels!.category).toBe('Packing & Postage');
  });

  it('counts direct PayPal receipts separately from BrickLink', async () => {
    const supabase = createFilterAwareSupabaseMock({
      paypal_transactions: [
        {
          user_id: USER,
          transaction_event_code: 'T0006',
          transaction_type: null,
          transaction_date: '2026-06-05T09:00:00+00:00',
          gross_amount: 40,
          fee_amount: -1.8,
        },
        {
          user_id: USER,
          transaction_event_code: 'T0011',
          transaction_type: null,
          transaction_date: '2026-06-07T09:00:00+00:00',
          gross_amount: 95,
          fee_amount: -3.06,
        },
      ],
    });
    const service = new ProfitLossReportService(supabase as never);

    const result = await service.generateReport(USER, {
      startMonth: '2026-06',
      endMonth: '2026-06',
      basis: 'cash',
    });

    // BrickLink must stay reconcilable against bricklink_transactions...
    expect(getRow(result, 'BrickLink Sales (cash received)')!.monthlyValues['2026-06']).toBe(40);
    // ...while the direct receipt is still declared, in its own row.
    expect(getRow(result, 'Other PayPal Sales (cash received)')!.monthlyValues['2026-06']).toBe(95);
  });
});

describe('P&L cash basis', () => {
  describe('Amazon cash income (funds released)', () => {
    // One order that went DEFERRED (June) then RELEASED (July) — the classic
    // append-not-update pattern — plus a straight RELEASED June order and a
    // still-DEFERRED June order.
    const amazonRows = [
      // Straight released in June
      {
        user_id: USER,
        transaction_type: 'Shipment',
        transaction_status: 'RELEASED',
        amazon_order_id: 'A-1',
        posted_date: '2026-06-10T10:00:00+00:00',
        // Sales leaf 100; the column is 99 because it nets the £1 DSF
        gross_sales_amount: 99,
        total_fees: 16,
        total_amount: 83,
        breakdowns: shipmentBreakdowns(100, 16, 1),
      },
      // Deferred in June, released in July — BOTH rows exist
      {
        user_id: USER,
        transaction_type: 'Shipment',
        transaction_status: 'DEFERRED',
        amazon_order_id: 'A-2',
        posted_date: '2026-06-22T10:00:00+00:00',
        // Sales leaf 50; the column is 49 because it nets the £1 DSF
        gross_sales_amount: 49,
        total_fees: 8,
        total_amount: 41,
        breakdowns: shipmentBreakdowns(50, 8, 1),
      },
      {
        user_id: USER,
        transaction_type: 'Shipment',
        transaction_status: 'RELEASED',
        amazon_order_id: 'A-2',
        posted_date: '2026-07-01T10:00:00+00:00',
        // Sales leaf 50; the column is 49 because it nets the £1 DSF
        gross_sales_amount: 49,
        total_fees: 8,
        total_amount: 41,
        breakdowns: shipmentBreakdowns(50, 8, 1),
      },
      // Legacy intermediate row — must never be counted (RELEASED sibling exists)
      {
        user_id: USER,
        transaction_type: 'Shipment',
        transaction_status: 'DEFERRED_RELEASED',
        amazon_order_id: 'A-3',
        posted_date: '2026-06-05T10:00:00+00:00',
        // Sales leaf 30; the column is 29 because it nets the £1 DSF
        gross_sales_amount: 29,
        total_fees: 4,
        total_amount: 25,
        breakdowns: shipmentBreakdowns(30, 4, 1),
      },
      {
        user_id: USER,
        transaction_type: 'Shipment',
        transaction_status: 'RELEASED',
        amazon_order_id: 'A-3',
        posted_date: '2026-06-12T10:00:00+00:00',
        // Sales leaf 30; the column is 29 because it nets the £1 DSF
        gross_sales_amount: 29,
        total_fees: 4,
        total_amount: 25,
        breakdowns: shipmentBreakdowns(30, 4, 1),
      },
      // Still deferred — money not received, must be excluded entirely
      {
        user_id: USER,
        transaction_type: 'Shipment',
        transaction_status: 'DEFERRED',
        amazon_order_id: 'A-4',
        posted_date: '2026-06-28T10:00:00+00:00',
        // Sales leaf 999; the column is 998 because it nets the £1 DSF
        gross_sales_amount: 998,
        total_fees: 169,
        total_amount: 829,
        breakdowns: shipmentBreakdowns(999, 169, 1),
      },
      // Released refund in June
      {
        user_id: USER,
        transaction_type: 'Refund',
        transaction_status: 'RELEASED',
        amazon_order_id: 'A-1',
        posted_date: '2026-06-20T10:00:00+00:00',
        gross_sales_amount: null,
        total_fees: 0,
        // total_amount (-17) is Refunded Sales (-20) PLUS Refunded Expenses
        // (+3, fees given back). Only the -20 reduces turnover; using
        // total_amount would understate the refund and leave the fee credit
        // buried in income.
        total_amount: -17,
        breakdowns: refundBreakdowns(20, 3),
      },
      // Deferred refund — excluded until released
      {
        user_id: USER,
        transaction_type: 'Refund',
        transaction_status: 'DEFERRED',
        amazon_order_id: 'A-2',
        posted_date: '2026-06-25T10:00:00+00:00',
        gross_sales_amount: null,
        total_fees: 0,
        total_amount: -13,
        breakdowns: refundBreakdowns(15, 2),
      },
    ];

    it('counts only RELEASED shipment rows, dated by release month', async () => {
      const supabase = createFilterAwareSupabaseMock({ amazon_transactions: amazonRows });
      const service = new ProfitLossReportService(supabase as never);

      const result = await service.generateReport(USER, {
        startMonth: '2026-06',
        endMonth: '2026-07',
        basis: 'cash',
      });

      const sales = getRow(result, 'Amazon Sales (funds released)');
      expect(sales).toBeDefined();
      // June: A-1 (100) + A-3 released row (30). NOT the deferred £50/£999,
      // NOT the DEFERRED_RELEASED duplicate £30.
      expect(sales!.monthlyValues['2026-06']).toBe(130);
      // July: A-2's release lands in July at its release date.
      expect(sales!.monthlyValues['2026-07']).toBe(50);
    });

    it('counts only RELEASED refunds', async () => {
      const supabase = createFilterAwareSupabaseMock({ amazon_transactions: amazonRows });
      const service = new ProfitLossReportService(supabase as never);

      const result = await service.generateReport(USER, {
        startMonth: '2026-06',
        endMonth: '2026-07',
        basis: 'cash',
      });

      const refunds = getRow(result, 'Amazon Refunds (funds released)');
      expect(refunds).toBeDefined();
      // Released refund of £20 (deferred £15 excluded), sign multiplier -1
      expect(refunds!.monthlyValues['2026-06']).toBe(-20);
      expect(refunds!.monthlyValues['2026-07'] ?? 0).toBe(0);
    });

    it('never double counts an order across status families', async () => {
      const supabase = createFilterAwareSupabaseMock({ amazon_transactions: amazonRows });
      const service = new ProfitLossReportService(supabase as never);

      const result = await service.generateReport(USER, {
        startMonth: '2026-06',
        endMonth: '2026-07',
        basis: 'cash',
      });

      const sales = getRow(result, 'Amazon Sales (funds released)');
      const total = Object.values(sales!.monthlyValues).reduce((a, b) => a + b, 0);
      // A-1 (100) + A-2 (50) + A-3 (30) exactly once each; A-4 not yet received
      expect(total).toBe(180);
    });
  });

  describe('BrickLink / Brick Owl cash income (PayPal receipts)', () => {
    const paypalRows = [
      // BO order receipt (labelled)
      {
        user_id: USER,
        transaction_event_code: 'T0006',
        transaction_type: 'Brick Owl Order #1234567',
        transaction_date: '2026-06-05T09:00:00+00:00',
        gross_amount: 25.5,
        fee_amount: -1.2,
      },
      // BL order receipts (unlabelled / null label)
      {
        user_id: USER,
        transaction_event_code: 'T0006',
        transaction_type: null,
        transaction_date: '2026-06-07T09:00:00+00:00',
        gross_amount: 40,
        fee_amount: -1.8,
      },
      {
        user_id: USER,
        transaction_event_code: 'T0006',
        transaction_type: 'Payment received',
        transaction_date: '2026-06-30T23:59:59+00:00',
        gross_amount: 10,
        fee_amount: -0.7,
      },
      // Outgoing purchase via PayPal — negative T0006, must NOT count as income
      {
        user_id: USER,
        transaction_event_code: 'T0006',
        transaction_type: null,
        transaction_date: '2026-06-08T09:00:00+00:00',
        gross_amount: -30,
        fee_amount: -0.5,
      },
      // Withdrawal — different event code, never income
      {
        user_id: USER,
        transaction_event_code: 'T0403',
        transaction_type: null,
        transaction_date: '2026-06-11T09:00:00+00:00',
        gross_amount: 550,
        fee_amount: -0.1,
      },
      // Refund issued to a buyer (T1107)
      {
        user_id: USER,
        transaction_event_code: 'T1107',
        transaction_type: null,
        transaction_date: '2026-06-15T09:00:00+00:00',
        gross_amount: -7.5,
        fee_amount: 0,
      },
      // July receipt — outside a June-only report
      {
        user_id: USER,
        transaction_event_code: 'T0006',
        transaction_type: 'Brick Owl Order #7654321',
        transaction_date: '2026-07-02T09:00:00+00:00',
        gross_amount: 99,
        fee_amount: -2,
      },
    ];

    it('splits BO (labelled) from BL (rest) and ignores non-receipts', async () => {
      const supabase = createFilterAwareSupabaseMock({ paypal_transactions: paypalRows });
      const service = new ProfitLossReportService(supabase as never);

      const result = await service.generateReport(USER, {
        startMonth: '2026-06',
        endMonth: '2026-06',
        basis: 'cash',
      });

      const bl = getRow(result, 'BrickLink Sales (cash received)');
      const bo = getRow(result, 'Brick Owl Sales (cash received)');
      expect(bl!.monthlyValues['2026-06']).toBe(50); // 40 + 10
      expect(bo!.monthlyValues['2026-06']).toBe(25.5);
    });

    it('nets refunds issued (T1107) as a negative income row', async () => {
      const supabase = createFilterAwareSupabaseMock({ paypal_transactions: paypalRows });
      const service = new ProfitLossReportService(supabase as never);

      const result = await service.generateReport(USER, {
        startMonth: '2026-06',
        endMonth: '2026-06',
        basis: 'cash',
      });

      const refunds = getRow(result, 'BrickLink / Brick Owl Refunds (cash)');
      expect(refunds!.monthlyValues['2026-06']).toBe(-7.5);
      expect(refunds!.category).toBe('Income');
    });

    it('respects the month window (July receipt excluded from June report)', async () => {
      const supabase = createFilterAwareSupabaseMock({ paypal_transactions: paypalRows });
      const service = new ProfitLossReportService(supabase as never);

      const result = await service.generateReport(USER, {
        startMonth: '2026-06',
        endMonth: '2026-06',
        basis: 'cash',
      });

      const bo = getRow(result, 'Brick Owl Sales (cash received)');
      expect(bo!.monthlyValues['2026-07']).toBeUndefined();
      expect(Object.values(bo!.monthlyValues).reduce((a, b) => a + b, 0)).toBe(25.5);
    });

    it('PayPal fees remain an expense in the cash report (same as accrual)', async () => {
      const supabase = createFilterAwareSupabaseMock({ paypal_transactions: paypalRows });
      const service = new ProfitLossReportService(supabase as never);

      const result = await service.generateReport(USER, {
        startMonth: '2026-06',
        endMonth: '2026-06',
        basis: 'cash',
      });

      const fees = getRow(result, 'PayPal Fees');
      // |−1.2| + |−1.8| + |−0.7| + |−0.5| + |−0.1| = 4.3 (June rows)
      expect(fees!.monthlyValues['2026-06']).toBeCloseTo(-4.3, 10);
    });
  });

  describe('date-bound regressions (E2E validation findings, 2026-07-03)', () => {
    it('spending-only Monzo categories respect the end-date bound (duplicate-lt-key bug)', async () => {
      const supabase = createFilterAwareSupabaseMock({
        monzo_transactions: [
          {
            user_id: USER,
            local_category: 'Postage',
            created: '2026-06-10T10:00:00+00:00',
            amount: -10000,
          },
          // AFTER the report window — the duplicate `lt:` key bug dropped the
          // date bound for netRefunds=false categories and pulled this in
          {
            user_id: USER,
            local_category: 'Postage',
            created: '2026-07-15T10:00:00+00:00',
            amount: -99900,
          },
        ],
      });
      const service = new ProfitLossReportService(supabase as never);

      const result = await service.generateReport(USER, {
        startMonth: '2026-06',
        endMonth: '2026-06',
      });

      const postage = getRow(result, 'Postage');
      expect(postage!.monthlyValues['2026-06']).toBe(-100);
      expect(postage!.monthlyValues['2026-07']).toBeUndefined();
      const total = Object.values(postage!.monthlyValues).reduce((a, b) => a + b, 0);
      expect(total).toBe(-100);
    });

    it('home-cost rows do not bucket a month beyond endMonth (exclusive-end substring bug)', async () => {
      const supabase = createFilterAwareSupabaseMock({
        home_costs: [
          {
            user_id: USER,
            cost_type: 'insurance',
            start_date: '2025-01-01',
            end_date: null,
            annual_premium: 1200,
            business_stock_value: 5000,
            total_contents_value: 10000,
          },
        ],
      });
      const service = new ProfitLossReportService(supabase as never);

      const result = await service.generateReport(USER, {
        startMonth: '2026-05',
        endMonth: '2026-06',
      });

      const insurance = result.rows.find((r) => r.transactionType.toLowerCase().includes('insurance'));
      expect(insurance).toBeDefined();
      const monthsInRow = Object.keys(insurance!.monthlyValues).sort();
      // Must be confined to the requested range — no 2026-07 leakage
      expect(monthsInRow).toEqual(['2026-05', '2026-06']);
    });
  });

  describe('basis selection', () => {
    const mixedData = {
      amazon_transactions: [
        {
          user_id: USER,
          transaction_type: 'Shipment',
          transaction_status: 'RELEASED',
          amazon_order_id: 'A-1',
          posted_date: '2026-06-10T10:00:00+00:00',
          gross_sales_amount: 99,
          total_fees: 16,
          total_amount: 83,
          breakdowns: shipmentBreakdowns(100, 16, 1),
        },
      ],
      platform_orders: [
        {
          user_id: USER,
          platform: 'amazon',
          status: 'Shipped',
          order_date: '2026-06-09T10:00:00+00:00',
          total: 120,
        },
      ],
      monzo_transactions: [
        {
          user_id: USER,
          local_category: 'Lego Stock',
          created: '2026-06-03T10:00:00+00:00',
          amount: -5000,
        },
      ],
    };

    it('defaults to accrual (order-date platform_orders income)', async () => {
      const supabase = createFilterAwareSupabaseMock(mixedData);
      const service = new ProfitLossReportService(supabase as never);

      const result = await service.generateReport(USER, {
        startMonth: '2026-06',
        endMonth: '2026-06',
      });

      expect(getRow(result, 'Amazon Sales')!.monthlyValues['2026-06']).toBe(120);
      expect(getRow(result, 'Amazon Sales (funds released)')).toBeUndefined();
    });

    it('cash basis replaces income rows but keeps accrual rows absent', async () => {
      const supabase = createFilterAwareSupabaseMock(mixedData);
      const service = new ProfitLossReportService(supabase as never);

      const result = await service.generateReport(USER, {
        startMonth: '2026-06',
        endMonth: '2026-06',
        basis: 'cash',
      });

      expect(getRow(result, 'Amazon Sales (funds released)')!.monthlyValues['2026-06']).toBe(100);
      expect(getRow(result, 'Amazon Sales')).toBeUndefined();
    });

    it('expense rows are identical across bases on the same data', async () => {
      const supabase1 = createFilterAwareSupabaseMock(mixedData);
      const supabase2 = createFilterAwareSupabaseMock(mixedData);
      const service1 = new ProfitLossReportService(supabase1 as never);
      const service2 = new ProfitLossReportService(supabase2 as never);

      const accrual = await service1.generateReport(USER, {
        startMonth: '2026-06',
        endMonth: '2026-06',
      });
      const cash = await service2.generateReport(USER, {
        startMonth: '2026-06',
        endMonth: '2026-06',
        basis: 'cash',
      });

      const expenseRows = (r: typeof accrual) =>
        r.rows
          .filter((row) => row.category !== 'Income')
          .map((row) => ({ t: row.transactionType, v: row.monthlyValues }));

      expect(expenseRows(cash)).toEqual(expenseRows(accrual));
      // And the seeded Monzo stock purchase appears identically in both
      expect(cash.categoryTotals['Stock Purchase']['2026-06']).toBe(
        accrual.categoryTotals['Stock Purchase']['2026-06']
      );
      expect(cash.categoryTotals['Stock Purchase']['2026-06']).toBe(-50);
    });
  });
});
