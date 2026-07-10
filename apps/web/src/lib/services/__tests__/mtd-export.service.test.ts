/**
 * MTD export service tests — CSV construction, nominal-code mapping, basis
 * threading, refund netting, and export-history basis handling. These outputs
 * feed HMRC MTD submissions via QuickFile.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MtdExportService } from '../mtd-export.service';
import type { ProfitLossReport } from '../profit-loss-report.service';

const { generateReportMock } = vi.hoisted(() => ({ generateReportMock: vi.fn() }));

vi.mock('../profit-loss-report.service', () => ({
  ProfitLossReportService: vi.fn(function (this: unknown) {
    return { generateReport: generateReportMock };
  }),
}));

/** Minimal report factory matching ProfitLossReport's shape. */
function makeReport(
  rows: Array<{ category: string; transactionType: string; monthlyValues: Record<string, number> }>
): ProfitLossReport {
  return {
    generatedAt: '2026-07-02T00:00:00Z',
    dateRange: { startMonth: '2026-06', endMonth: '2026-06' },
    months: ['2026-06'],
    rows: rows.map((r) => ({ ...r, total: 0 })),
    categoryTotals: {},
    grandTotal: {},
  } as unknown as ProfitLossReport;
}

function makeSupabaseMock(historyRows: unknown[] = []) {
  const chain = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    limit: vi.fn().mockResolvedValue({ data: historyRows, error: null }),
    insert: vi.fn().mockResolvedValue({ error: null }),
    then: (onF: (r: unknown) => unknown, onR?: (e: unknown) => unknown) =>
      Promise.resolve({ data: historyRows, error: null }).then(onF, onR),
  };
  return { from: vi.fn().mockReturnValue(chain), _chain: chain };
}

const USER = 'test-user';

describe('MtdExportService', () => {
  beforeEach(() => {
    generateReportMock.mockReset();
  });

  describe('generateCsvData — cash basis', () => {
    const cashReport = makeReport([
      { category: 'Income', transactionType: 'eBay Gross Sales', monthlyValues: { '2026-06': 870.72 } },
      { category: 'Income', transactionType: 'eBay Refunds', monthlyValues: { '2026-06': -12.5 } },
      {
        category: 'Income',
        transactionType: 'BrickLink Sales (cash received)',
        monthlyValues: { '2026-06': 2958.98 },
      },
      {
        category: 'Income',
        transactionType: 'Brick Owl Sales (cash received)',
        monthlyValues: { '2026-06': 409.02 },
      },
      {
        category: 'Income',
        transactionType: 'BrickLink / Brick Owl Refunds (cash)',
        monthlyValues: { '2026-06': -77.62 },
      },
      {
        category: 'Income',
        transactionType: 'Amazon Sales (funds released)',
        monthlyValues: { '2026-06': 1947.82 },
      },
      {
        category: 'Income',
        transactionType: 'Amazon Refunds (funds released)',
        monthlyValues: { '2026-06': -20 },
      },
      { category: 'Selling Fees', transactionType: 'PayPal Fees', monthlyValues: { '2026-06': -152.92 } },
      { category: 'Stock Purchase', transactionType: 'Lego Stock Purchases', monthlyValues: { '2026-06': -1781.25 } },
      { category: 'Packing & Postage', transactionType: 'Postage', monthlyValues: { '2026-06': -1091.03 } },
      { category: 'Bills', transactionType: 'Website', monthlyValues: { '2026-06': -169.83 } },
    ]);

    it('passes the basis through to the P&L service', async () => {
      generateReportMock.mockResolvedValue(cashReport);
      const service = new MtdExportService(makeSupabaseMock() as never);

      await service.generateCsvData(USER, '2026-06', '2026-06', 'cash');

      expect(generateReportMock).toHaveBeenCalledWith(USER, {
        startMonth: '2026-06',
        endMonth: '2026-06',
        basis: 'cash',
      });
    });

    it('defaults to accrual basis', async () => {
      generateReportMock.mockResolvedValue(cashReport);
      const service = new MtdExportService(makeSupabaseMock() as never);

      const data = await service.generateCsvData(USER, '2026-06');

      expect(generateReportMock).toHaveBeenCalledWith(USER, {
        startMonth: '2026-06',
        endMonth: '2026-06',
        basis: 'accrual',
      });
      expect(data.basis).toBe('accrual');
    });

    it('buckets cash income rows to the right platforms and nets refunds', async () => {
      generateReportMock.mockResolvedValue(cashReport);
      const service = new MtdExportService(makeSupabaseMock() as never);

      const data = await service.generateCsvData(USER, '2026-06', '2026-06', 'cash');

      const byRef = Object.fromEntries(data.sales.map((s) => [s.reference, s]));
      // eBay: 870.72 − 12.50 refunds
      expect(byRef['EBAY-202606'].netAmount).toBe(858.22);
      // BrickLink: 2958.98 − 77.62 BL/BO refunds (netted against BL bucket)
      expect(byRef['BRICKLINK-202606'].netAmount).toBe(2881.36);
      expect(byRef['BRICKOWL-202606'].netAmount).toBe(409.02);
      // Amazon: 1947.82 − 20
      expect(byRef['AMAZON-202606'].netAmount).toBe(1927.82);
      expect(data.sales).toHaveLength(4);
    });

    it('uses nominal code 4000 for all sales and correct codes for expenses', async () => {
      generateReportMock.mockResolvedValue(cashReport);
      const service = new MtdExportService(makeSupabaseMock() as never);

      const data = await service.generateCsvData(USER, '2026-06', '2026-06', 'cash');

      for (const sale of data.sales) {
        expect(sale.nominalCode).toBe('4000');
        expect(sale.vat).toBe(0);
        expect(sale.date).toBe('2026-06-30');
      }
      const byRef = Object.fromEntries(data.expenses.map((e) => [e.reference, e]));
      expect(byRef['STOCK-202606'].nominalCode).toBe('5000');
      expect(byRef['STOCK-202606'].netAmount).toBe(1781.25);
      expect(byRef['FEES-202606'].nominalCode).toBe('7502');
      expect(byRef['FEES-202606'].netAmount).toBe(152.92);
      expect(byRef['POSTAGE-202606'].nominalCode).toBe('7503');
      expect(byRef['SOFTWARE-202606'].nominalCode).toBe('7600');
    });

    it('produces well-formed CSV output (headers, 2dp, ISO dates)', async () => {
      generateReportMock.mockResolvedValue(cashReport);
      const service = new MtdExportService(makeSupabaseMock() as never);

      const data = await service.generateCsvData(USER, '2026-06', '2026-06', 'cash');
      const salesCsv = service.generateSalesCsv(data);
      const expensesCsv = service.generateExpensesCsv(data);

      const salesLines = salesCsv.split('\n');
      expect(salesLines[0]).toBe('Date,Reference,Description,Net Amount,VAT,Gross Amount,Nominal Code');
      expect(expensesCsv.split('\n')[0]).toBe(
        'Date,Reference,Supplier,Description,Net Amount,VAT,Gross Amount,Nominal Code'
      );
      for (const line of salesLines.slice(1)) {
        const cols = line.split(',');
        expect(cols[0]).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        expect(cols[3]).toMatch(/^\d+\.\d{2}$/); // 2dp, no currency symbols
        expect(cols[4]).toBe('0.00');
      }
    });

    it('skips platforms whose net income is zero or negative', async () => {
      generateReportMock.mockResolvedValue(
        makeReport([
          { category: 'Income', transactionType: 'eBay Gross Sales', monthlyValues: { '2026-06': 10 } },
          { category: 'Income', transactionType: 'eBay Refunds', monthlyValues: { '2026-06': -15 } },
          {
            category: 'Income',
            transactionType: 'Amazon Sales (funds released)',
            monthlyValues: { '2026-06': 100 },
          },
        ])
      );
      const service = new MtdExportService(makeSupabaseMock() as never);

      const data = await service.generateCsvData(USER, '2026-06', '2026-06', 'cash');

      expect(data.sales.map((s) => s.reference)).toEqual(['AMAZON-202606']);
    });

    it('emits one row per month across a quarter range', async () => {
      const report = {
        ...makeReport([
          {
            category: 'Income',
            transactionType: 'Amazon Sales (funds released)',
            monthlyValues: { '2026-04': 100, '2026-05': 200, '2026-06': 300 },
          },
        ]),
        months: ['2026-04', '2026-05', '2026-06'],
      };
      generateReportMock.mockResolvedValue(report);
      const service = new MtdExportService(makeSupabaseMock() as never);

      const data = await service.generateCsvData(USER, '2026-04', '2026-06', 'cash');

      expect(data.sales.map((s) => [s.reference, s.netAmount, s.date])).toEqual([
        ['AMAZON-202604', 100, '2026-04-30'],
        ['AMAZON-202605', 200, '2026-05-31'],
        ['AMAZON-202606', 300, '2026-06-30'],
      ]);
    });
  });

  describe('export history basis handling', () => {
    it('logExport stores the basis inside quickfile_response', async () => {
      const supabase = makeSupabaseMock();
      const service = new MtdExportService(supabase as never);

      await service.logExport(USER, '2026-06', 'csv', 5, { endMonth: '2026-06' }, 'cash');

      expect(supabase._chain.insert).toHaveBeenCalledWith(
        expect.objectContaining({
          month: '2026-06',
          export_type: 'csv',
          quickfile_response: expect.objectContaining({ basis: 'cash', endMonth: '2026-06' }),
        })
      );
    });

    it('getQuickFileExportHistory matches only the requested basis', async () => {
      const history = [
        { created_at: '2026-07-01T10:00:00Z', quickfile_response: { basis: 'cash' } },
        { created_at: '2026-06-01T10:00:00Z', quickfile_response: { basis: 'accrual' } },
      ];
      const supabase = makeSupabaseMock(history);
      const service = new MtdExportService(supabase as never);

      const cash = await service.getQuickFileExportHistory(USER, '2026-06', 'cash');
      const accrual = await service.getQuickFileExportHistory(USER, '2026-06', 'accrual');

      expect(cash).toEqual({ exported: true, exportedAt: '2026-07-01T10:00:00Z' });
      expect(accrual).toEqual({ exported: true, exportedAt: '2026-06-01T10:00:00Z' });
    });

    it('treats legacy rows without a stored basis as accrual', async () => {
      const history = [{ created_at: '2026-01-23T10:00:00Z', quickfile_response: { endMonth: '2025-04' } }];
      const supabase = makeSupabaseMock(history);
      const service = new MtdExportService(supabase as never);

      const accrual = await service.getQuickFileExportHistory(USER, '2025-04', 'accrual');
      const cash = await service.getQuickFileExportHistory(USER, '2025-04', 'cash');

      expect(accrual.exported).toBe(true);
      expect(cash.exported).toBe(false);
    });
  });
});
