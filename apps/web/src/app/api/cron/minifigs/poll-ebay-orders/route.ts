import { NextRequest, NextResponse } from 'next/server';
import { verifyCronAuth } from '@/lib/api/cron-auth';
import { createServiceRoleClient } from '@/lib/supabase/server';
import { OrderPollService } from '@/lib/minifig-sync/order-poll.service';
import { DEFAULT_USER_ID } from '@/lib/minifig-sync/types';

export const runtime = 'nodejs';
export const maxDuration = 300;

async function handler(request: NextRequest) {
  try {
    const unauthorized = verifyCronAuth(request);
    if (unauthorized) return unauthorized;

    const supabase = createServiceRoleClient();
    const service = new OrderPollService(supabase, DEFAULT_USER_ID);
    const result = await service.pollEbayOrders();

    return NextResponse.json({ data: result });
  } catch (error) {
    console.error('[/api/cron/minifigs/poll-ebay-orders] Error:', error);
    return NextResponse.json(
      {
        error: 'Failed to poll eBay orders',
        details:
          process.env.NODE_ENV === 'development'
            ? error instanceof Error
              ? error.message
              : String(error)
            : undefined,
      },
      { status: 500 }
    );
  }
}

export async function GET(request: NextRequest) {
  return handler(request);
}

export async function POST(request: NextRequest) {
  return handler(request);
}
