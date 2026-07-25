import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient, createServiceRoleClient } from '@/lib/supabase/server';
import { validateAuth } from '@/lib/api/validate-auth';
import { ProfitLossReportService } from '@/lib/services/profit-loss-report.service';

const QueryParamsSchema = z.object({
  startMonth: z
    .string()
    .regex(/^\d{4}-\d{2}$/)
    .optional(),
  endMonth: z
    .string()
    .regex(/^\d{4}-\d{2}$/)
    .optional(),
  startDate: z.string().optional(), // For backwards compatibility - will convert to month
  endDate: z.string().optional(), // For backwards compatibility - will convert to month
  includeZeroRows: z
    .string()
    .transform((v) => v === 'true')
    .optional(),
  /**
   * Reporting basis. Defaults to accrual, which is what this report has always
   * shown — but the MTD return is filed on CASH, and until this param existed
   * there was no way to see the filed figures in the app at all. They diverge
   * meaningfully within a quarter (Q1 2026/27: accrual £17,306.06 vs cash
   * £16,423.34) and converge over a year (rolling 12mo: £185 apart).
   */
  basis: z.enum(['accrual', 'cash']).optional(),
});

/**
 * GET /api/reports/profit-loss
 * Get profit and loss report using the detailed transaction-based service
 */
export async function GET(request: NextRequest) {
  try {
    // Validate auth via API key or session cookie
    const auth = await validateAuth(request);
    if (!auth) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Use service role client for API key auth (bypasses RLS)
    const isApiKeyAuth = !!request.headers.get('x-api-key');
    const supabase = isApiKeyAuth ? createServiceRoleClient() : await createClient();
    const userId = auth.userId;

    const searchParams = Object.fromEntries(request.nextUrl.searchParams);
    const parsed = QueryParamsSchema.safeParse(searchParams);

    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid parameters', details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const { startMonth, endMonth, startDate, endDate, includeZeroRows, basis } = parsed.data;

    // Convert date params to month format if provided (backwards compatibility)
    let resolvedStartMonth = startMonth;
    let resolvedEndMonth = endMonth;

    if (!resolvedStartMonth && startDate) {
      resolvedStartMonth = startDate.substring(0, 7);
    }
    if (!resolvedEndMonth && endDate) {
      resolvedEndMonth = endDate.substring(0, 7);
    }

    const reportService = new ProfitLossReportService(supabase);

    const report = await reportService.generateReport(userId, {
      startMonth: resolvedStartMonth,
      endMonth: resolvedEndMonth,
      includeZeroRows: includeZeroRows ?? false,
      basis: basis ?? 'accrual',
    });

    return NextResponse.json({ data: report });
  } catch (error) {
    console.error('[GET /api/reports/profit-loss] Error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
