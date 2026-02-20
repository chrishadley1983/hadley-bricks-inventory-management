import { NextRequest, NextResponse } from 'next/server';
import { createServiceRoleClient } from '@/lib/supabase/server';
import { InventoryPullService } from '@/lib/minifig-sync/inventory-pull.service';
import { OrderPollService } from '@/lib/minifig-sync/order-poll.service';
import { ResearchService } from '@/lib/minifig-sync/research.service';
import { RepricingService } from '@/lib/minifig-sync/repricing.service';
import { DEFAULT_USER_ID } from '@/lib/minifig-sync/types';

export const runtime = 'nodejs';
export const maxDuration = 300;

/**
 * Daily maintenance cron — runs all daily tasks in sequence:
 * 1. Crash recovery (stuck PUBLISHING items)
 * 2. Inventory pull from Bricqer
 * 3. Bricqer order polling
 * 4. Research refresh (expired cache)
 * 5. Repricing (Mondays only)
 */
export async function GET(request: NextRequest) {
  try {
    const authHeader = request.headers.get('Authorization');
    const cronSecret = process.env.CRON_SECRET;

    if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const supabase = createServiceRoleClient();
    const results: Record<string, unknown> = {};

    // 1. CR-002: Reset any items stuck in PUBLISHING status (crash recovery)
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
    results.stuckItemsReset = stuckItems?.length ?? 0;

    // 2. Inventory pull (time-budgeted to leave room for other tasks)
    const pullService = new InventoryPullService(supabase, DEFAULT_USER_ID);
    results.inventoryPull = await pullService.pull({ maxDurationMs: 40_000 });

    // 3. Bricqer order polling
    try {
      const orderPollService = new OrderPollService(supabase, DEFAULT_USER_ID);
      results.bricqerOrderPoll = await orderPollService.pollBricqerOrders();
    } catch (err) {
      console.error('[daily-inventory] Bricqer order poll failed:', err);
      results.bricqerOrderPoll = { error: err instanceof Error ? err.message : String(err) };
    }

    // 4. Research refresh (expired cache)
    try {
      const { data: expiredItems } = await supabase
        .from('minifig_price_cache')
        .select('bricklink_id')
        .lt('expires_at', new Date().toISOString());

      if (expiredItems && expiredItems.length > 0) {
        const expiredBricklinkIds = expiredItems.map((e: { bricklink_id: string }) => e.bricklink_id);
        const { data: syncItems } = await supabase
          .from('minifig_sync_items')
          .select('id')
          .eq('user_id', DEFAULT_USER_ID)
          .in('bricklink_id', expiredBricklinkIds);

        if (syncItems && syncItems.length > 0) {
          const researchService = new ResearchService(supabase, DEFAULT_USER_ID);
          results.researchRefresh = await researchService.researchAll(syncItems.map((si: { id: string }) => si.id));
        } else {
          results.researchRefresh = { message: 'No sync items need refresh', itemsRefreshed: 0 };
        }
      } else {
        results.researchRefresh = { message: 'No expired cache entries', itemsRefreshed: 0 };
      }
    } catch (err) {
      console.error('[daily-inventory] Research refresh failed:', err);
      results.researchRefresh = { error: err instanceof Error ? err.message : String(err) };
    }

    // 5. Repricing (Mondays only)
    const dayOfWeek = new Date().getUTCDay();
    if (dayOfWeek === 1) {
      try {
        const repricingService = new RepricingService(supabase, DEFAULT_USER_ID);
        results.repricing = await repricingService.repriceStaleListings();
      } catch (err) {
        console.error('[daily-inventory] Repricing failed:', err);
        results.repricing = { error: err instanceof Error ? err.message : String(err) };
      }
    } else {
      results.repricing = { skipped: true, reason: 'Only runs on Mondays' };
    }

    return NextResponse.json({ data: results });
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
