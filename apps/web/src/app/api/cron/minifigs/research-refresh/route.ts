import { NextRequest, NextResponse } from 'next/server';
import { createServiceRoleClient } from '@/lib/supabase/server';
import { ResearchService } from '@/lib/minifig-sync/research.service';
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
    const service = new ResearchService(supabase, DEFAULT_USER_ID);

    // Find items with expired cache and re-research them
    const { data: expiredItems } = await supabase
      .from('minifig_price_cache')
      .select('bricklink_id')
      .lt('expires_at', new Date().toISOString());

    if (!expiredItems || expiredItems.length === 0) {
      return NextResponse.json({ data: { message: 'No expired cache entries', itemsRefreshed: 0 } });
    }

    // Find sync items that match expired cache entries
    const expiredBricklinkIds = expiredItems.map((e: { bricklink_id: string }) => e.bricklink_id);
    const { data: syncItems } = await supabase
      .from('minifig_sync_items')
      .select('id')
      .eq('user_id', DEFAULT_USER_ID)
      .in('bricklink_id', expiredBricklinkIds);

    if (!syncItems || syncItems.length === 0) {
      return NextResponse.json({ data: { message: 'No sync items need refresh', itemsRefreshed: 0 } });
    }

    const itemIds = syncItems.map((si: { id: string }) => si.id);
    const result = await service.researchAll(itemIds);

    return NextResponse.json({ data: result });
  } catch (error) {
    console.error('[GET /api/cron/minifigs/research-refresh] Error:', error);
    return NextResponse.json(
      {
        error: 'Research refresh failed',
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 },
    );
  }
}
