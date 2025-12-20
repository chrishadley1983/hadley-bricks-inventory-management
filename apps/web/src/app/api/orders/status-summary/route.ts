import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { OrderStatusService } from '@/lib/services';

/**
 * GET /api/orders/status-summary
 * Get order counts by status
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

    const platform = request.nextUrl.searchParams.get('platform') || undefined;

    const statusService = new OrderStatusService(supabase);
    const summary = await statusService.getStatusSummary(user.id, platform);

    return NextResponse.json({
      data: summary,
    });
  } catch (error) {
    console.error('[GET /api/orders/status-summary] Error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
