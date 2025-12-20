import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { ReportingService } from '@/lib/services';

/**
 * GET /api/reports/inventory-aging
 * Get inventory aging report with age bracket analysis
 */
export async function GET(_request: NextRequest) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const reportingService = new ReportingService(supabase);
    const report = await reportingService.getInventoryAgingReport(user.id);

    return NextResponse.json({ data: report });
  } catch (error) {
    console.error('[GET /api/reports/inventory-aging] Error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
