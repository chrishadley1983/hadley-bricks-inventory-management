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

    if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const supabase = createServiceRoleClient();

    // CR-002: Reset any items stuck in PUBLISHING status (crash recovery)
    const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    const { data: stuckItems } = await supabase
      .from('minifig_sync_items')
      .update({ listing_status: 'STAGED', updated_at: new Date().toISOString() })
      .eq('user_id', DEFAULT_USER_ID)
      .eq('listing_status', 'PUBLISHING')
      .lt('updated_at', fiveMinAgo)
      .select('id');

    if (stuckItems && stuckItems.length > 0) {
      console.log(`[daily-inventory] Reset ${stuckItems.length} stuck PUBLISHING items back to STAGED`);
    }

    const service = new InventoryPullService(supabase, DEFAULT_USER_ID);
    const result = await service.pull();

    return NextResponse.json({ data: result });
  } catch (error) {
    console.error('[GET /api/cron/minifigs/daily-inventory] Error:', error);
    return NextResponse.json(
      {
        error: 'Daily inventory pull failed',
        details: process.env.NODE_ENV === 'development' ? (error instanceof Error ? error.message : String(error)) : undefined,
      },
      { status: 500 },
    );
  }
}
