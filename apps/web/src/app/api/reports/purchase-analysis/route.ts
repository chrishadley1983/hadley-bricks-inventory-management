import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { ReportingService } from '@/lib/services';

const QueryParamsSchema = z.object({
  preset: z
    .enum([
      'this_month',
      'last_month',
      'this_quarter',
      'last_quarter',
      'this_year',
      'last_year',
      'last_30_days',
      'last_90_days',
      'custom',
    ])
    .optional(),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
});

/**
 * GET /api/reports/purchase-analysis
 * Get purchase ROI analysis report
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

    const { preset, startDate, endDate } = parsed.data;

    const reportingService = new ReportingService(supabase);

    // Get date range from preset or custom dates
    const dateRange = reportingService.getDateRangeFromPreset(
      preset || 'this_year',
      startDate && endDate
        ? { startDate: new Date(startDate), endDate: new Date(endDate) }
        : undefined
    );

    const report = await reportingService.getPurchaseAnalysisReport(user.id, dateRange);

    return NextResponse.json({ data: report });
  } catch (error) {
    console.error('[GET /api/reports/purchase-analysis] Error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
