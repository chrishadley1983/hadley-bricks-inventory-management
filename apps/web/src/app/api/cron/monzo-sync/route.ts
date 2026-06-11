import { NextRequest, NextResponse } from 'next/server';
import { verifyCronAuth } from '@/lib/api/cron-auth';
import { createServiceRoleClient } from '@/lib/supabase/server';
import { MonzoSheetsSyncService } from '@/lib/monzo/monzo-sheets-sync.service';
import { MonzoBalanceService } from '@/lib/monzo/monzo-balance.service';
import type { BalanceSnapshotResult } from '@/lib/monzo/monzo-balance.service';
import { DEFAULT_USER_ID } from '@/lib/minifig-sync/types';

export const runtime = 'nodejs';
export const maxDuration = 300;

async function handler(request: NextRequest) {
  try {
    const unauthorized = verifyCronAuth(request);
    if (unauthorized) return unauthorized;

    // Service-role client so RLS-gated inserts (monzo_sync_log) succeed without
    // a Supabase user session. The service singleton uses cookie auth which
    // would fail here.
    const serviceClient = createServiceRoleClient();
    const service = new MonzoSheetsSyncService(serviceClient);
    const result = await service.performIncrementalSync(DEFAULT_USER_ID);

    // Balance snapshot + low-balance alert; never fails the transaction sync
    let balance: BalanceSnapshotResult | null = null;
    try {
      balance = await new MonzoBalanceService(serviceClient).recordDailySnapshot(DEFAULT_USER_ID);
    } catch (balanceError) {
      console.error('[/api/cron/monzo-sync] Balance snapshot failed:', balanceError);
    }

    return NextResponse.json({ data: { ...result, balance } });
  } catch (error) {
    console.error('[/api/cron/monzo-sync] Error:', error);
    return NextResponse.json(
      {
        error: 'Failed to sync Monzo',
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
