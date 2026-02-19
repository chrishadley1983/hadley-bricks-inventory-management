import { NextRequest, NextResponse } from 'next/server';
import { createServiceRoleClient } from '@/lib/supabase/server';
import { InventoryPullService } from '@/lib/minifig-sync/inventory-pull.service';
import { DEFAULT_USER_ID } from '@/lib/minifig-sync/types';

export const runtime = 'nodejs';
export const maxDuration = 300;

export async function GET(request: NextRequest) {
  try {
    const authHeader = request.headers.get('Authorization');
    const cronSecret = process.env.CRON_SECRET;

    if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const supabase = createServiceRoleClient();
    const service = new InventoryPullService(supabase, DEFAULT_USER_ID);
    const result = await service.pull();

    return NextResponse.json({ data: result });
  } catch (error) {
    console.error('[GET /api/cron/minifigs/daily-inventory] Error:', error);
    return NextResponse.json(
      {
        error: 'Daily inventory pull failed',
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 },
    );
  }
}
