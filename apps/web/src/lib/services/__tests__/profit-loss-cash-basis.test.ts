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
        gross_sales_amount: 100,
        total_fees: 17,
        total_amount: 83,
      },
      // Deferred in June, released in July — BOTH rows exist
      {
        user_id: USER,
        transaction_type: 'Shipment',
        transaction_status: 'DEFERRED',
        amazon_order_id: 'A-2',
        posted_date: '2026-06-22T10:00:00+00:00',
        gross_sales_amount: 50,
        total_fees: 9,
        total_amount: 41,
      },
      {
        user_id: USER,
        transaction_type: 'Shipment',
        transaction_status: 'RELEASED',
        amazon_order_id: 'A-2',
        posted_date: '2026-07-01T10:00:00+00:00',
        gross_sales_amount: 50,
        total_fees: 9,
        total_amount: 41,
      },
      // Legacy intermediate row — must never be counted (RELEASED sibling exists)
      {
        user_id: USER,
        transaction_type: 'Shipment',
        transaction_status: 'DEFERRED_RELEASED',
        amazon_order_id: 'A-3',
        posted_date: '2026-06-05T10:00:00+00:00',
        gross_sales_amount: 30,
        total_fees: 5,
        total_amount: 25,
      },
      {
        user_id: USER,
        transaction_type: 'Shipment',
        transaction_status: 'RELEASED',
        amazon_order_id: 'A-3',
        posted_date: '2026-06-12T10:00:00+00:00',
        gross_sales_amount: 30,
        total_fees: 5,
        total_amount: 25,
      },
      // Still deferred — money not received, must be excluded entirely
      {
        user_id: USER,
        transaction_type: 'Shipment',
        transaction_status: 'DEFERRED',
        amazon_order_id: 'A-4',
        posted_date: '2026-06-28T10:00:00+00:00',
        gross_sales_amount: 999,
        total_fees: 170,
        total_amount: 829,
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
        total_amount: -20,
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
        total_amount: -15,
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
          gross_sales_amount: 100,
          total_fees: 17,
          total_amount: 83,
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
