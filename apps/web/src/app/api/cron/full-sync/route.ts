/**
 * POST /api/cron/full-sync
 *
 * Scheduled cron job that runs twice daily (7:45 AM and 1:45 PM UK time) to:
 * 1. Run full platform syncs (eBay, Amazon, BrickLink, Brick Owl)
 * 2. Sync Amazon inventory ASINs to tracked_asins
 * 3. Detect and reset stuck jobs (running > 30 minutes)
 * 4. Send a comprehensive Discord status report
 *
 * Schedule: "45 7,13 * * *" (UTC - adjust for BST)
 */

import { NextRequest, NextResponse } from 'next/server';
import { createServiceRoleClient } from '@/lib/supabase/server';
import { ebayOrderSyncService, ebayAutoSyncService } from '@/lib/ebay';
import { AmazonSyncService } from '@/lib/services/amazon-sync.service';
import { BrickLinkSyncService } from '@/lib/services/bricklink-sync.service';
import { BrickOwlSyncService } from '@/lib/services/brickowl-sync.service';
import { AmazonArbitrageSyncService } from '@/lib/arbitrage/amazon-sync.service';
import { discordService, DiscordColors } from '@/lib/notifications/discord.service';

export const runtime = 'nodejs';
export const maxDuration = 300; // 5 minutes max

/** Individual sync result */
interface SyncResult {
  platform: string;
  status: 'success' | 'failed' | 'skipped';
  processed?: number;
  created?: number;
  updated?: number;
  failed?: number;
  error?: string;
  durationMs?: number;
}

/** Stuck job info */
interface StuckJob {
  table: string;
  id: string;
  type: string;
  stuckSince: string;
}

/** Weekly stats */
interface WeeklyStats {
  listedCount: number;
  listedValue: number;
  soldCount: number;
  soldValue: number;
  backlogCount: number;
}

/** Full sync results */
interface FullSyncResults {
  platformSyncs: SyncResult[];
  inventoryAsinSync: SyncResult | null;
  stuckJobs: StuckJob[];
  stuckJobsReset: number;
  weeklyStats: WeeklyStats;
  totalDurationMs: number;
}

/** Timeout wrapper for individual sync operations */
async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  operationName: string
): Promise<T> {
  let timeoutId: NodeJS.Timeout;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(new Error(`${operationName} timed out after ${timeoutMs}ms`));
    }, timeoutMs);
  });

  try {
    const result = await Promise.race([promise, timeoutPromise]);
    clearTimeout(timeoutId!);
    return result;
  } catch (error) {
    clearTimeout(timeoutId!);
    throw error;
  }
}

/** Get all user IDs with platform credentials */
async function getUsersWithCredentials(supabase: ReturnType<typeof createServiceRoleClient>): Promise<string[]> {
  const { data, error } = await supabase
    .from('platform_credentials')
    .select('user_id')
    .in('platform', ['ebay', 'amazon', 'bricklink', 'brickowl']);

  if (error) {
    console.error('[Cron FullSync] Error fetching users with credentials:', error);
    return [];
  }

  // Deduplicate user IDs
  const userIds = [...new Set(data?.map((d) => d.user_id) ?? [])];
  return userIds;
}

/** Detect stuck jobs (running/in_progress for > 30 minutes) */
async function detectStuckJobs(supabase: ReturnType<typeof createServiceRoleClient>): Promise<StuckJob[]> {
  const stuckJobs: StuckJob[] = [];
  const thirtyMinutesAgo = new Date(Date.now() - 30 * 60 * 1000).toISOString();

  // Check ebay_sync_log - status IN_PROGRESS, started > 30 min ago, not completed
  const { data: ebayStuck } = await supabase
    .from('ebay_sync_log')
    .select('id, sync_type, started_at')
    .eq('status', 'IN_PROGRESS')
    .is('completed_at', null)
    .lt('started_at', thirtyMinutesAgo);

  for (const job of ebayStuck ?? []) {
    stuckJobs.push({
      table: 'ebay_sync_log',
      id: job.id,
      type: `eBay ${job.sync_type}`,
      stuckSince: job.started_at,
    });
  }

  // Check amazon_sync_log - status IN_PROGRESS, started > 30 min ago, not completed
  const { data: amazonStuck } = await supabase
    .from('amazon_sync_log')
    .select('id, sync_type, started_at')
    .eq('status', 'IN_PROGRESS')
    .is('completed_at', null)
    .lt('started_at', thirtyMinutesAgo);

  for (const job of amazonStuck ?? []) {
    stuckJobs.push({
      table: 'amazon_sync_log',
      id: job.id,
      type: `Amazon ${job.sync_type}`,
      stuckSince: job.started_at,
    });
  }

  // Check bricklink_sync_log - status IN_PROGRESS, started > 30 min ago, not completed
  const { data: bricklinkStuck } = await supabase
    .from('bricklink_sync_log')
    .select('id, started_at')
    .eq('status', 'IN_PROGRESS')
    .is('completed_at', null)
    .lt('started_at', thirtyMinutesAgo);

  for (const job of bricklinkStuck ?? []) {
    stuckJobs.push({
      table: 'bricklink_sync_log',
      id: job.id,
      type: 'BrickLink Orders',
      stuckSince: job.started_at,
    });
  }

  // Check brickowl_sync_log - status IN_PROGRESS, started > 30 min ago, not completed
  const { data: brickowlStuck } = await supabase
    .from('brickowl_sync_log')
    .select('id, started_at')
    .eq('status', 'IN_PROGRESS')
    .is('completed_at', null)
    .lt('started_at', thirtyMinutesAgo);

  for (const job of brickowlStuck ?? []) {
    stuckJobs.push({
      table: 'brickowl_sync_log',
      id: job.id,
      type: 'Brick Owl Orders',
      stuckSince: job.started_at,
    });
  }

  // Check amazon_sync_feeds (two-phase sync) - these have updated_at
  const { data: feedsStuck } = await supabase
    .from('amazon_sync_feeds')
    .select('id, two_phase_step, updated_at')
    .eq('sync_mode', 'two_phase')
    .in('status', ['processing', 'submitted'])
    .lt('updated_at', thirtyMinutesAgo);

  for (const feed of feedsStuck ?? []) {
    stuckJobs.push({
      table: 'amazon_sync_feeds',
      id: feed.id,
      type: `Amazon Feed (${feed.two_phase_step ?? 'processing'})`,
      stuckSince: feed.updated_at,
    });
  }

  return stuckJobs;
}

/** Reset stuck jobs to failed/timeout status */
async function resetStuckJobs(
  supabase: ReturnType<typeof createServiceRoleClient>,
  stuckJobs: StuckJob[]
): Promise<number> {
  let resetCount = 0;
  const errorMessage = 'Automatically reset by full-sync cron job - stuck for > 30 minutes';

  for (const job of stuckJobs) {
    let result;

    switch (job.table) {
      case 'ebay_sync_log':
        result = await supabase
          .from('ebay_sync_log')
          .update({ status: 'FAILED', error_message: errorMessage, completed_at: new Date().toISOString() })
          .eq('id', job.id);
        break;

      case 'amazon_sync_log':
        result = await supabase
          .from('amazon_sync_log')
          .update({ status: 'FAILED', error_message: errorMessage, completed_at: new Date().toISOString() })
          .eq('id', job.id);
        break;

      case 'bricklink_sync_log':
        result = await supabase
          .from('bricklink_sync_log')
          .update({ status: 'FAILED', error_message: errorMessage, completed_at: new Date().toISOString() })
          .eq('id', job.id);
        break;

      case 'brickowl_sync_log':
        result = await supabase
          .from('brickowl_sync_log')
          .update({ status: 'FAILED', error_message: errorMessage, completed_at: new Date().toISOString() })
          .eq('id', job.id);
        break;

      case 'amazon_sync_feeds':
        result = await supabase
          .from('amazon_sync_feeds')
          .update({ status: 'processing_timeout', error_message: errorMessage, completed_at: new Date().toISOString() })
          .eq('id', job.id);
        break;
    }

    if (!result?.error) {
      resetCount++;
      console.log(`[Cron FullSync] Reset stuck job: ${job.type} (${job.id})`);
    } else {
      console.error(`[Cron FullSync] Failed to reset stuck job ${job.id}:`, result.error);
    }
  }

  return resetCount;
}

/** Get weekly stats */
async function getWeeklyStats(supabase: ReturnType<typeof createServiceRoleClient>): Promise<WeeklyStats> {
  // Get start of current week (Monday)
  const now = new Date();
  const dayOfWeek = now.getDay();
  const daysFromMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
  const weekStart = new Date(now);
  weekStart.setDate(now.getDate() - daysFromMonday);
  weekStart.setHours(0, 0, 0, 0);
  const weekStartIso = weekStart.toISOString();

  // Listed this week (inventory items created this week with status LISTED)
  const { data: listedItems } = await supabase
    .from('inventory_items')
    .select('id, listing_value')
    .eq('status', 'LISTED')
    .gte('created_at', weekStartIso);

  const listedCount = listedItems?.length ?? 0;
  const listedValue = listedItems?.reduce((sum, item) => sum + (Number(item.listing_value) || 0), 0) ?? 0;

  // Sold this week (from platform_orders fulfilled this week)
  const { data: soldOrders } = await supabase
    .from('platform_orders')
    .select('id, total')
    .gte('fulfilled_at', weekStartIso);

  const soldCount = soldOrders?.length ?? 0;
  const soldValue = soldOrders?.reduce((sum, order) => sum + (Number(order.total) || 0), 0) ?? 0;

  // Backlog (items with status BACKLOG)
  const { count: backlogCount } = await supabase
    .from('inventory_items')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'BACKLOG');

  return {
    listedCount,
    listedValue: Math.round(listedValue * 100) / 100,
    soldCount,
    soldValue: Math.round(soldValue * 100) / 100,
    backlogCount: backlogCount ?? 0,
  };
}

/** Calculate next run time */
function getNextRunTime(): string {
  const now = new Date();
  const ukOffset = now.toLocaleString('en-GB', { timeZone: 'Europe/London', hour: 'numeric', hour12: false });
  const currentHour = parseInt(ukOffset, 10);

  // Scheduled times are 7:45 and 13:45 UK time
  const nextRunDate = new Date(now);

  if (currentHour < 7 || (currentHour === 7 && now.getMinutes() < 45)) {
    // Next run is 7:45 today
    nextRunDate.setHours(7, 45, 0, 0);
  } else if (currentHour < 13 || (currentHour === 13 && now.getMinutes() < 45)) {
    // Next run is 13:45 today
    nextRunDate.setHours(13, 45, 0, 0);
  } else {
    // Next run is 7:45 tomorrow
    nextRunDate.setDate(nextRunDate.getDate() + 1);
    nextRunDate.setHours(7, 45, 0, 0);
  }

  // Format for UK timezone
  return nextRunDate.toLocaleString('en-GB', {
    timeZone: 'Europe/London',
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/** Send Discord status report */
async function sendDiscordReport(results: FullSyncResults): Promise<void> {
  const now = new Date();
  const dateStr = now.toLocaleDateString('en-GB', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });
  const timeStr = now.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'UTC' });

  // Determine overall status color
  const allSucceeded = results.platformSyncs.every((s) => s.status === 'success' || s.status === 'skipped');
  const allFailed = results.platformSyncs.every((s) => s.status === 'failed');
  let color: number;
  if (allSucceeded && (!results.inventoryAsinSync || results.inventoryAsinSync.status === 'success')) {
    color = DiscordColors.GREEN;
  } else if (allFailed) {
    color = DiscordColors.RED;
  } else {
    color = DiscordColors.ORANGE;
  }

  // Build stuck jobs section
  let stuckJobsText: string;
  if (results.stuckJobs.length === 0) {
    stuckJobsText = '✅ None found - All jobs running within normal time limits';
  } else {
    stuckJobsText = results.stuckJobs
      .map((j) => `• ${j.type}: stuck since ${new Date(j.stuckSince).toLocaleTimeString('en-GB')}`)
      .join('\n');
    stuckJobsText += `\n\n🧹 ${results.stuckJobsReset} job(s) automatically reset`;
  }

  // Build platform sync results section
  const platformResultsLines: string[] = [];
  for (const sync of results.platformSyncs) {
    let statusEmoji: string;
    let statusText: string;

    if (sync.status === 'success') {
      statusEmoji = '✅';
      statusText = `${sync.processed ?? 0} processed`;
      if (sync.created) statusText += `, ${sync.created} created`;
      if (sync.updated) statusText += `, ${sync.updated} updated`;
      if (sync.failed) statusText += `, ${sync.failed} failed`;
    } else if (sync.status === 'skipped') {
      statusEmoji = '⏭️';
      statusText = 'Skipped - No credentials';
    } else {
      statusEmoji = '❌';
      statusText = sync.error ?? 'Failed';
    }

    platformResultsLines.push(`${statusEmoji} **${sync.platform}**: ${statusText}`);
  }

  // Build inventory ASIN sync section
  let inventoryAsinText: string;
  if (!results.inventoryAsinSync) {
    inventoryAsinText = '⏭️ Not available';
  } else if (results.inventoryAsinSync.status === 'success') {
    inventoryAsinText = `✅ ${results.inventoryAsinSync.created ?? 0} added, ${results.inventoryAsinSync.updated ?? 0} updated`;
  } else if (results.inventoryAsinSync.status === 'skipped') {
    inventoryAsinText = '⏭️ Skipped - No credentials';
  } else {
    inventoryAsinText = `❌ ${results.inventoryAsinSync.error ?? 'Failed'}`;
  }

  // Build weekly stats section
  const weeklyStatsText = [
    `📦 **Listed:** ${results.weeklyStats.listedCount} items (£${results.weeklyStats.listedValue.toFixed(2)})`,
    `💰 **Sold:** ${results.weeklyStats.soldCount} orders (£${results.weeklyStats.soldValue.toFixed(2)})`,
    `📋 **Backlog:** ${results.weeklyStats.backlogCount} items`,
  ].join('\n');

  // Build the message
  const description = [
    '## 🛑 STUCK JOBS',
    stuckJobsText,
    '',
    '## 📊 PLATFORM SYNCS',
    platformResultsLines.join('\n'),
    '',
    '## 📦 INVENTORY ASIN SYNC',
    inventoryAsinText,
    '',
    '## 📈 WEEKLY STATS',
    weeklyStatsText,
  ].join('\n');

  try {
    await discordService.send('sync-status', {
      title: `Hadley Bricks Full Sync - ${dateStr} (${timeStr} UTC)`,
      description,
      color,
      footer: { text: `Next sync: ${getNextRunTime()} | Duration: ${Math.round(results.totalDurationMs / 1000)}s` },
    });
    console.log('[Cron FullSync] Discord notification sent');
  } catch (error) {
    // Discord webhook failure is non-fatal
    console.error('[Cron FullSync] Failed to send Discord notification:', error);
  }
}

/** Main cron handler */
export async function POST(request: NextRequest) {
  const startTime = Date.now();

  try {
    // Verify cron secret
    const authHeader = request.headers.get('authorization');
    const cronSecret = process.env.CRON_SECRET;

    if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
      console.warn('[Cron FullSync] Unauthorized request');
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    console.log('[Cron FullSync] Starting full sync job');

    const supabase = createServiceRoleClient();
    const results: FullSyncResults = {
      platformSyncs: [],
      inventoryAsinSync: null,
      stuckJobs: [],
      stuckJobsReset: 0,
      weeklyStats: { listedCount: 0, listedValue: 0, soldCount: 0, soldValue: 0, backlogCount: 0 },
      totalDurationMs: 0,
    };

    // Step 1: Detect and reset stuck jobs
    console.log('[Cron FullSync] Detecting stuck jobs...');
    results.stuckJobs = await detectStuckJobs(supabase);
    console.log(`[Cron FullSync] Found ${results.stuckJobs.length} stuck job(s)`);

    if (results.stuckJobs.length > 0) {
      results.stuckJobsReset = await resetStuckJobs(supabase, results.stuckJobs);
      console.log(`[Cron FullSync] Reset ${results.stuckJobsReset} stuck job(s)`);
    }

    // Step 2: Get users with credentials
    const userIds = await getUsersWithCredentials(supabase);
    console.log(`[Cron FullSync] Found ${userIds.length} user(s) with credentials`);

    if (userIds.length === 0) {
      console.log('[Cron FullSync] No users with credentials, skipping syncs');
    } else {
      // For now, process first user (single-tenant assumption)
      // TODO: Support multi-tenant by iterating over all users
      const userId = userIds[0];

      // Step 3: Run platform syncs in parallel with individual timeouts
      const SYNC_TIMEOUT = 60000; // 60 seconds per sync

      const syncPromises = [
        // eBay Orders
        withTimeout(
          ebayOrderSyncService.syncOrders(userId),
          SYNC_TIMEOUT,
          'eBay Orders'
        )
          .then((result) => ({
            platform: 'eBay Orders',
            status: 'success' as const,
            processed: result?.ordersProcessed ?? 0,
            created: result?.ordersCreated ?? 0,
            updated: result?.ordersUpdated ?? 0,
          }))
          .catch((error) => ({
            platform: 'eBay Orders',
            status: 'failed' as const,
            error: error instanceof Error ? error.message : 'Unknown error',
          })),

        // eBay Auto Sync (transactions)
        withTimeout(
          ebayAutoSyncService.performIncrementalSync(userId),
          SYNC_TIMEOUT,
          'eBay Auto Sync'
        )
          .then((result) => ({
            platform: 'eBay Transactions',
            status: 'success' as const,
            processed: result?.transactions?.recordsProcessed ?? 0,
            created: result?.transactions?.recordsCreated ?? 0,
          }))
          .catch((error) => ({
            platform: 'eBay Transactions',
            status: 'failed' as const,
            error: error instanceof Error ? error.message : 'Unknown error',
          })),

        // Amazon Orders
        withTimeout(
          new AmazonSyncService(supabase).syncOrders(userId),
          SYNC_TIMEOUT,
          'Amazon Orders'
        )
          .then((result) => ({
            platform: 'Amazon Orders',
            status: 'success' as const,
            processed: result?.ordersProcessed ?? 0,
            created: result?.ordersCreated ?? 0,
            updated: result?.ordersUpdated ?? 0,
          }))
          .catch((error) => ({
            platform: 'Amazon Orders',
            status: error.message.includes('credentials') ? ('skipped' as const) : ('failed' as const),
            error: error instanceof Error ? error.message : 'Unknown error',
          })),

        // BrickLink Orders
        withTimeout(
          new BrickLinkSyncService(supabase).syncOrders(userId),
          SYNC_TIMEOUT,
          'BrickLink Orders'
        )
          .then((result) => ({
            platform: 'BrickLink Orders',
            status: 'success' as const,
            processed: result?.ordersProcessed ?? 0,
            created: result?.ordersCreated ?? 0,
            updated: result?.ordersUpdated ?? 0,
          }))
          .catch((error) => ({
            platform: 'BrickLink Orders',
            status: error.message.includes('credentials') ? ('skipped' as const) : ('failed' as const),
            error: error instanceof Error ? error.message : 'Unknown error',
          })),

        // Brick Owl Orders
        withTimeout(
          new BrickOwlSyncService(supabase).syncOrders(userId),
          SYNC_TIMEOUT,
          'Brick Owl Orders'
        )
          .then((result) => ({
            platform: 'Brick Owl Orders',
            status: 'success' as const,
            processed: result?.ordersProcessed ?? 0,
            created: result?.ordersCreated ?? 0,
            updated: result?.ordersUpdated ?? 0,
          }))
          .catch((error) => ({
            platform: 'Brick Owl Orders',
            status: error.message.includes('credentials') ? ('skipped' as const) : ('failed' as const),
            error: error instanceof Error ? error.message : 'Unknown error',
          })),
      ];

      // Wait for all syncs using Promise.allSettled
      const syncResults = await Promise.allSettled(syncPromises);

      for (const result of syncResults) {
        if (result.status === 'fulfilled') {
          results.platformSyncs.push(result.value);
        } else {
          results.platformSyncs.push({
            platform: 'Unknown',
            status: 'failed',
            error: result.reason?.message ?? 'Unknown error',
          });
        }
      }

      console.log('[Cron FullSync] Platform syncs completed');

      // Step 4: Run Amazon Inventory ASIN sync
      console.log('[Cron FullSync] Running Amazon Inventory ASIN sync...');
      try {
        const asinSyncResult = await withTimeout(
          new AmazonArbitrageSyncService(supabase).syncInventoryAsins(userId),
          SYNC_TIMEOUT,
          'Amazon Inventory ASIN Sync'
        );
        results.inventoryAsinSync = {
          platform: 'Amazon Inventory ASINs',
          status: 'success',
          created: asinSyncResult.added,
          updated: asinSyncResult.updated,
          processed: asinSyncResult.total,
        };
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : 'Unknown error';
        results.inventoryAsinSync = {
          platform: 'Amazon Inventory ASINs',
          status: errorMsg.includes('credentials') ? 'skipped' : 'failed',
          error: errorMsg,
        };
      }
    }

    // Step 5: Get weekly stats
    console.log('[Cron FullSync] Calculating weekly stats...');
    results.weeklyStats = await getWeeklyStats(supabase);

    // Step 6: Calculate total duration
    results.totalDurationMs = Date.now() - startTime;

    // Step 7: Send Discord notification
    console.log('[Cron FullSync] Sending Discord notification...');
    await sendDiscordReport(results);

    console.log(`[Cron FullSync] Completed in ${results.totalDurationMs}ms`);

    return NextResponse.json({
      success: true,
      duration: results.totalDurationMs,
      platformSyncs: results.platformSyncs.length,
      stuckJobsFound: results.stuckJobs.length,
      stuckJobsReset: results.stuckJobsReset,
      weeklyStats: results.weeklyStats,
    });
  } catch (error) {
    const duration = Date.now() - startTime;
    console.error('[Cron FullSync] Error:', error);

    // Try to send error notification to Discord
    try {
      await discordService.sendAlert({
        title: '❌ Full Sync Job Failed',
        message: error instanceof Error ? error.message : 'Unknown error',
        priority: 'high',
      });
    } catch {
      // Ignore Discord errors
    }

    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : 'Internal error',
        duration,
      },
      { status: 500 }
    );
  }
}

// Also support GET for manual testing (requires same auth)
export async function GET(request: NextRequest) {
  return POST(request);
}
