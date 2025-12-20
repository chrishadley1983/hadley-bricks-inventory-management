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
  granularity: z.enum(['daily', 'weekly', 'monthly']).optional(),
});

/**
 * GET /api/reports/sales-trends
 * Get sales trends time-series report
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

    const { preset, startDate, endDate, granularity } = parsed.data;

    const reportingService = new ReportingService(supabase);

    // Get date range from preset or custom dates
    const dateRange = reportingService.getDateRangeFromPreset(
      preset || 'last_30_days',
      startDate && endDate
        ? { startDate: new Date(startDate), endDate: new Date(endDate) }
        : undefined
    );

    const report = await reportingService.getSalesTrendsReport(
      user.id,
      dateRange,
      granularity || 'daily'
    );

    return NextResponse.json({ data: report });
  } catch (error) {
    console.error('[GET /api/reports/sales-trends] Error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
