import { NextRequest, NextResponse } from 'next/server';
import { createClient, createServiceRoleClient } from '@/lib/supabase/server';
import { validateAuth } from '@/lib/api/validate-auth';
import { ReportingService } from '@/lib/services';

/**
 * GET /api/reports/inventory-aging
 * Get inventory aging report with age bracket analysis
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

    const reportingService = new ReportingService(supabase);
    // Always include items for drill-down functionality
    const report = await reportingService.getInventoryAgingReport(userId, true);

    return NextResponse.json({ data: report });
  } catch (error) {
    console.error('[GET /api/reports/inventory-aging] Error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
