import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { ReportingService } from '@/lib/services';

const QueryParamsSchema = z.object({
  financialYear: z.coerce.number().optional(),
});

/**
 * GET /api/reports/tax-summary
 * Get UK tax summary report for a financial year (April-April)
 */
export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const searchParams = Object.fromEntries(request.nextUrl.searchParams);
    const parsed = QueryParamsSchema.safeParse(searchParams);

    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid parameters', details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    // Default to current financial year if not specified
    const now = new Date();
    const currentMonth = now.getMonth();
    const defaultYear = currentMonth >= 3 ? now.getFullYear() : now.getFullYear() - 1;
    const year = parsed.data.financialYear ?? defaultYear;

    const reportingService = new ReportingService(supabase);
    const report = await reportingService.getTaxSummaryReport(user.id, year);

    return NextResponse.json({ data: report });
  } catch (error) {
    console.error('[GET /api/reports/tax-summary] Error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
