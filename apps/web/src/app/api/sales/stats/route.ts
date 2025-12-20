import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { ProfitService } from '@/lib/services';

const QueryParamsSchema = z.object({
  platform: z.string().optional(),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  year: z.coerce.number().optional(),
});

/**
 * GET /api/sales/stats
 * Get sales and profit statistics
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
    const params = parsed.success ? parsed.data : {};

    const profitService = new ProfitService(supabase);

    const dateRange =
      params.startDate && params.endDate
        ? {
            startDate: new Date(params.startDate),
            endDate: new Date(params.endDate),
          }
        : undefined;

    const [metrics, platformBreakdown, monthlySummary, rollingTurnover] = await Promise.all([
      profitService.getMetrics(user.id, dateRange),
      profitService.getPlatformBreakdown(user.id, dateRange),
      profitService.getMonthlyProfitSummary(user.id, params.year || new Date().getFullYear()),
      profitService.getRolling12MonthTurnover(user.id),
    ]);

    return NextResponse.json({
      data: {
        metrics,
        platformBreakdown,
        monthlySummary,
        rollingTurnover,
      },
    });
  } catch (error) {
    console.error('[GET /api/sales/stats] Error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
