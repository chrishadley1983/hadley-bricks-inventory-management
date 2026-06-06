import { NextRequest, NextResponse } from 'next/server';
import { verifyCronAuth } from '@/lib/api/cron-auth';
import { createServiceRoleClient } from '@/lib/supabase/server';
import { AmazonFeeReconciliationService } from '@/lib/services';
import { DEFAULT_USER_ID } from '@/lib/minifig-sync/types';

export const runtime = 'nodejs';
export const maxDuration = 300;

async function handler(request: NextRequest) {
  try {
    const unauthorized = verifyCronAuth(request);
    if (unauthorized) return unauthorized;

    const supabase = createServiceRoleClient();
    const service = new AmazonFeeReconciliationService(supabase);
    const result = await service.reconcileFees(DEFAULT_USER_ID);

    return NextResponse.json({ data: result });
  } catch (error) {
    console.error('[/api/cron/amazon-fee-reconcile] Error:', error);
    return NextResponse.json(
      {
        error: 'Failed to reconcile Amazon fees',
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
