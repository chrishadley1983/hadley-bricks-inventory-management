import { NextRequest, NextResponse } from 'next/server';
import { createServiceRoleClient } from '@/lib/supabase/server';
import { OrderPollService } from '@/lib/minifig-sync/order-poll.service';
import { DEFAULT_USER_ID } from '@/lib/minifig-sync/types';

export const runtime = 'nodejs';
export const maxDuration = 300;

export async function GET(request: NextRequest) {
  try {
    // Verify cron secret
    const authHeader = request.headers.get('authorization');
    const cronSecret = process.env.CRON_SECRET;
    if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const supabase = createServiceRoleClient();
    const service = new OrderPollService(supabase, DEFAULT_USER_ID);
    const result = await service.pollEbayOrders();

    return NextResponse.json({ data: result });
  } catch (error) {
    console.error('[GET /api/cron/minifigs/poll-ebay-orders] Error:', error);
    return NextResponse.json(
      {
        error: 'Failed to poll eBay orders',
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 },
    );
  }
}
