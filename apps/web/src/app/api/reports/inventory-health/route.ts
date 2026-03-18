import { NextRequest, NextResponse } from 'next/server';
import { createClient, createServiceRoleClient } from '@/lib/supabase/server';
import { validateAuth } from '@/lib/api/validate-auth';
import { ReportingService } from '@/lib/services';

/**
 * GET /api/reports/inventory-health
 * Get inventory health dashboard data (KPIs, velocity, sourcing, aging, pipeline, trends)
 */
export async function GET(request: NextRequest) {
  try {
    const auth = await validateAuth(request);
    if (!auth) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const isApiKeyAuth = !!request.headers.get('x-api-key');
    const supabase = isApiKeyAuth ? createServiceRoleClient() : await createClient();
    const userId = auth.userId;

    const reportingService = new ReportingService(supabase);
    const report = await reportingService.getInventoryHealthReport(userId);

    return NextResponse.json({ data: report });
  } catch (error) {
    console.error('[GET /api/reports/inventory-health] Error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
