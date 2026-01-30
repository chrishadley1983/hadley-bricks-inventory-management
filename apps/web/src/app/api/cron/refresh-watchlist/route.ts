/**
 * POST /api/cron/refresh-watchlist
 *
 * One-time endpoint to populate the arbitrage_watchlist table.
 * This should be run once initially, then periodically (e.g., weekly) to pick up new sold items.
 */

import { NextRequest, NextResponse } from 'next/server';
import { createServiceRoleClient } from '@/lib/supabase/server';
import { ArbitrageWatchlistService } from '@/lib/arbitrage';
import { discordService, DiscordColors } from '@/lib/notifications/discord.service';

export const runtime = 'nodejs';
export const maxDuration = 300; // 5 minutes

const DEFAULT_USER_ID = '4b6e94b4-661c-4462-9d14-b21df7d51e5b';

export async function POST(request: NextRequest) {
  const startTime = Date.now();

  try {
    // Verify cron secret
    const authHeader = request.headers.get('authorization');
    const cronSecret = process.env.CRON_SECRET;

    if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
      console.warn('[Cron RefreshWatchlist] Unauthorized request');
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const supabase = createServiceRoleClient();
    const watchlistService = new ArbitrageWatchlistService(supabase);

    console.log('[Cron RefreshWatchlist] Starting watchlist refresh...');

    const result = await watchlistService.refreshWatchlist(DEFAULT_USER_ID);

    const duration = Date.now() - startTime;
    console.log(`[Cron RefreshWatchlist] Completed in ${duration}ms:`, result);

    // Send Discord notification
    try {
      await discordService.send('sync-status', {
        title: '✅ Watchlist Refresh Complete',
        description: [
          `**Added:** ${result.added} items`,
          `**Removed:** ${result.removed} items (no longer relevant)`,
          `**Total in watchlist:** ${result.total}`,
          `**Sources:** ${result.soldInventoryCount} sold inventory, ${result.retiredWithPricingCount} retired sets`,
        ].join('\n'),
        color: DiscordColors.GREEN,
        footer: { text: `Duration: ${Math.round(duration / 1000)}s | Weekly refresh` },
      });
    } catch (discordError) {
      console.error('[Cron RefreshWatchlist] Discord notification failed:', discordError);
    }

    return NextResponse.json({
      success: true,
      ...result,
      duration,
    });
  } catch (error) {
    const duration = Date.now() - startTime;
    const errorMsg = error instanceof Error ? error.message : 'Unknown error';

    console.error('[Cron RefreshWatchlist] Error:', error);

    // Send error notification to Discord
    try {
      await discordService.sendAlert({
        title: '❌ Watchlist Refresh Failed',
        message: errorMsg,
        priority: 'high',
      });
    } catch {
      // Ignore Discord errors
    }

    return NextResponse.json(
      {
        error: errorMsg,
        duration,
      },
      { status: 500 }
    );
  }
}

// Also support GET for manual testing
export async function GET(request: NextRequest) {
  return POST(request);
}
