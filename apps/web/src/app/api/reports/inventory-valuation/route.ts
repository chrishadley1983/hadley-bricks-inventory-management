import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { ReportingService } from '@/lib/services';

const QueryParamsSchema = z.object({
  condition: z.enum(['all', 'new', 'used']).optional(),
  category: z.string().optional(),
});

/**
 * GET /api/reports/inventory-valuation
 * Get inventory valuation report
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

    const reportingService = new ReportingService(supabase);
    const report = await reportingService.getInventoryValuationReport(user.id);

    return NextResponse.json({ data: report });
  } catch (error) {
    console.error('[GET /api/reports/inventory-valuation] Error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
