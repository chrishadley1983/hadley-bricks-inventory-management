import { NextRequest, NextResponse } from 'next/server';
import { createServiceRoleClient } from '@/lib/supabase/server';
import { RepricingService } from '@/lib/minifig-sync/repricing.service';
import { DEFAULT_USER_ID } from '@/lib/minifig-sync/types';

export const runtime = 'nodejs';
export const maxDuration = 300;

export async function GET(request: NextRequest) {
  try {
    const authHeader = request.headers.get('Authorization');
    const cronSecret = process.env.CRON_SECRET;

    if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const supabase = createServiceRoleClient();
    const service = new RepricingService(supabase, DEFAULT_USER_ID);
    const result = await service.repriceStaleListings();

    return NextResponse.json({ data: result });
  } catch (error) {
    console.error('[GET /api/cron/minifigs/reprice] Error:', error);
    return NextResponse.json(
      {
        error: 'Repricing failed',
        details: process.env.NODE_ENV === 'development' ? (error instanceof Error ? error.message : String(error)) : undefined,
      },
      { status: 500 },
    );
  }
}
