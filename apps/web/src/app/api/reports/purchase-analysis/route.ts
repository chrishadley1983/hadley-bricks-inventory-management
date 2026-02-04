import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient, createServiceRoleClient } from '@/lib/supabase/server';
import { validateAuth } from '@/lib/api/validate-auth';
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

    const { preset, startDate, endDate } = parsed.data;

    const reportingService = new ReportingService(supabase);

    // Get date range from preset or custom dates
    const dateRange = reportingService.getDateRangeFromPreset(
      preset || 'this_year',
      startDate && endDate
        ? { startDate: new Date(startDate), endDate: new Date(endDate) }
        : undefined
    );

    const report = await reportingService.getPurchaseAnalysisReport(userId, dateRange);

    return NextResponse.json({ data: report });
  } catch (error) {
    console.error('[GET /api/reports/purchase-analysis] Error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
