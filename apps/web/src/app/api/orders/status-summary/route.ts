import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { OrderStatusService } from '@/lib/services';

/**
 * GET /api/orders/status-summary
 * Get order counts by status
 *
 * Query params:
 * - platform: Filter by platform (optional)
 * - days: Filter to last N days (7, 30, 90, or 'all') (optional, default: 'all')
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
    const days = request.nextUrl.searchParams.get('days');

    // Calculate date range
    let startDate: Date | undefined;
    if (days && days !== 'all') {
      const daysNum = parseInt(days, 10);
      if (!isNaN(daysNum) && daysNum > 0) {
        startDate = new Date();
        startDate.setDate(startDate.getDate() - daysNum);
      }
    }

    const statusService = new OrderStatusService(supabase);
    const summary = await statusService.getStatusSummary(user.id, platform, {
      startDate,
    });

    // Calculate total from the summary
    const total = Object.values(summary).reduce((sum, count) => sum + count, 0);

    return NextResponse.json({
      data: summary,
      total,
      dateRange: days || 'all',
    });
  } catch (error) {
    console.error('[GET /api/orders/status-summary] Error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
