import { NextRequest, NextResponse } from 'next/server';
import { verifyCronAuth } from '@/lib/api/cron-auth';
import { createServiceRoleClient } from '@/lib/supabase/server';
import { PayPalTransactionSyncService } from '@/lib/paypal';
import { DEFAULT_USER_ID } from '@/lib/minifig-sync/types';

export const runtime = 'nodejs';
export const maxDuration = 300;

async function handler(request: NextRequest) {
  try {
    const unauthorized = verifyCronAuth(request);
    if (unauthorized) return unauthorized;

    // Service-role client so RLS-gated inserts (paypal_sync_log) succeed without
    // a Supabase user session. The service singleton uses cookie auth which
    // would fail here.
    const service = new PayPalTransactionSyncService(createServiceRoleClient());
    const result = await service.syncTransactions(DEFAULT_USER_ID, {
      fullSync: false,
    });

    return NextResponse.json({ data: result });
  } catch (error) {
    console.error('[/api/cron/paypal-sync] Error:', error);
    return NextResponse.json(
      {
        error: 'Failed to sync PayPal',
        details: error instanceof Error ? error.message : String(error),
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
