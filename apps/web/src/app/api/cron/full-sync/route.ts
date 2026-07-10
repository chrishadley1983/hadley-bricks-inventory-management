/**
 * POST /api/cron/full-sync
 *
 * Scheduled cron job that runs 6 times daily (every 4 hours) to:
 * 1. Run full platform syncs (eBay, Amazon, BrickLink, Brick Owl)
 * 2. Sync Amazon inventory ASINs to tracked_asins
 * 3. Detect and reset stuck jobs (running > 30 minutes)
 * 4. Shopify batch sync (archive sold items, create new products)
 * 5. Send a comprehensive Discord status report
 *
 * Schedule: "45 3,7,11,15,19,23 * * *" (UTC)
 */

import { NextRequest, NextResponse } from 'next/server';
import { verifyCronAuth } from '@/lib/api/cron-auth';
import { createServiceRoleClient } from '@/lib/supabase/server';
import { jobExecutionService, noopHandle } from '@/lib/services/job-execution.service';
import type { ExecutionHandle } from '@/lib/services/job-execution.service';

// Heavy service imports are deferred to inside the handler. Loading them
// at module scope was paying the cold-start CPU cost (Amazon SP-API clients,
// BrickLink/BrickOwl adapters, Shopify GraphQL client, Discord webhook
// client) on every invocation — even on the unauthorized / no-users paths.
// See `loadServices()` below.

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

/** Shopify alignment stats */
interface ShopifyAlignment {
  listedOnShopify: number;
  listedTotal: number;
  mismatches: number;
  orphanedProducts: number;
}

/** Full sync results */
interface FullSyncResults {
  platformSyncs: SyncResult[];
  inventoryAsinSync: SyncResult | null;
  amazonLinking: { autoLinked: number; queuedForResolution: number; autoCompleted: number } | null;
  ebayLinking: { autoLinked: number; queuedForResolution: number } | null;
  shopifyArchiveSync: SyncResult | null;
  shopifyOrderSync: SyncResult | null;
  shopifyJanitors: {
    dedupeDuplicateSkus: number;
    dedupeArchived: number;
    driftFound: number;
    driftArchived: number;
    errors: string[];
  } | null;
  shopifyAlignment: ShopifyAlignment | null;
  stuckJobs: StuckJob[];
  stuckJobsReset: number;
  weeklyStats: WeeklyStats;
  totalDurationMs: number;
}

/**
 * Map an order-sync result to a report row, honouring per-order errors.
 * Previously every resolved sync was labelled 'success', which hid a
 * BrickOwl sync that errored on ALL 148 orders ("Invalid time value") for
 * months while Discord reported it green.
 */
function reportPlatformSync(
  platform: string,
  result:
    | {
        success?: boolean;
        ordersProcessed?: number;
        ordersCreated?: number;
        ordersUpdated?: number;
        errors?: string[];
        error?: string;
      }
    | undefined
): SyncResult {
  const errors = result?.errors ?? [];
  const isFailed = result ? result.success === false || errors.length > 0 : true;
  return {
    platform,
    status: isFailed ? 'failed' : 'success',
    processed: result?.ordersProcessed ?? 0,
    created: result?.ordersCreated ?? 0,
    updated: result?.ordersUpdated ?? 0,
    failed: errors.length || undefined,
    error: errors.length
      ? `${errors.length} order error(s), first: ${errors[0]}`
      : (result?.error ?? (result ? undefined : 'No result returned')),
  };
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
async function getUsersWithCredentials(
  supabase: ReturnType<typeof createServiceRoleClient>
): Promise<string[]> {
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
async function detectStuckJobs(
  supabase: ReturnType<typeof createServiceRoleClient>
): Promise<StuckJob[]> {
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
          .update({
            status: 'FAILED',
            error_message: errorMessage,
            completed_at: new Date().toISOString(),
          })
          .eq('id', job.id);
        break;

      case 'amazon_sync_log':
        result = await supabase
          .from('amazon_sync_log')
          .update({
            status: 'FAILED',
            error_message: errorMessage,
            completed_at: new Date().toISOString(),
          })
          .eq('id', job.id);
        break;

      case 'bricklink_sync_log':
        result = await supabase
          .from('bricklink_sync_log')
          .update({
            status: 'FAILED',
            error_message: errorMessage,
            completed_at: new Date().toISOString(),
          })
          .eq('id', job.id);
        break;

      case 'brickowl_sync_log':
        result = await supabase
          .from('brickowl_sync_log')
          .update({
            status: 'FAILED',
            error_message: errorMessage,
            completed_at: new Date().toISOString(),
          })
          .eq('id', job.id);
        break;

      case 'amazon_sync_feeds':
        result = await supabase
          .from('amazon_sync_feeds')
          .update({
            status: 'processing_timeout',
            error_message: errorMessage,
            completed_at: new Date().toISOString(),
          })
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

/** Get weekly stats (aligned with /api/workflow/metrics) */
async function getShopifyAlignment(
  supabase: ReturnType<typeof createServiceRoleClient>
): Promise<ShopifyAlignment> {
  // LISTED items eligible for Shopify (has set_number, not Strictly Briks)
  const { count: listedTotal } = await supabase
    .from('inventory_items')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'LISTED')
    .not('set_number', 'is', null)
    .neq('set_number', 'NA');

  // LISTED items that ARE on Shopify (active)
  const { count: listedOnShopify } = await supabase
    .from('shopify_products')
    .select('id', { count: 'exact', head: true })
    .neq('shopify_status', 'archived');

  // LISTED items missing from Shopify
  const { data: missing } = await supabase
    .from('inventory_items')
    .select('id, shopify_products!left(id)')
    .eq('status', 'LISTED')
    .not('set_number', 'is', null)
    .neq('set_number', 'NA')
    .is('shopify_products.id', null)
    .limit(1000);

  // Non-LISTED items still active on Shopify (should be archived)
  const { count: orphanedProducts } = await supabase
    .from('shopify_products')
    .select('id, inventory_items!inner(status)', { count: 'exact', head: true })
    .neq('shopify_status', 'archived')
    .neq('inventory_items.status', 'LISTED');

  return {
    listedOnShopify: listedOnShopify ?? 0,
    listedTotal: listedTotal ?? 0,
    mismatches: missing?.length ?? 0,
    orphanedProducts: orphanedProducts ?? 0,
  };
}

async function getWeeklyStats(
  supabase: ReturnType<typeof createServiceRoleClient>
): Promise<WeeklyStats> {
  // Get start of current week (Monday) - use date strings to match workflow metrics
  const now = new Date();
  const dayOfWeek = now.getDay();
  const daysFromMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
  const weekStart = new Date(now);
  weekStart.setDate(now.getDate() - daysFromMonday);
  weekStart.setHours(0, 0, 0, 0);
  const weekEnd = new Date(weekStart);
  weekEnd.setDate(weekStart.getDate() + 6);

  const weekStartStr = weekStart.toISOString().split('T')[0]; // yyyy-MM-dd
  const weekEndStr = weekEnd.toISOString().split('T')[0];

  // Listed this week - inventory items by listing_date (matches workflow metrics)
  const { data: listedItems } = await supabase
    .from('inventory_items')
    .select('id, listing_value')
    .gte('listing_date', weekStartStr)
    .lte('listing_date', weekEndStr);

  // Also include BrickLink batch uploads (tracked in bricklink_uploads table)
  const { data: bricklinkUploads } = await supabase
    .from('bricklink_uploads')
    .select('id, selling_price')
    .gte('upload_date', weekStartStr)
    .lte('upload_date', weekEndStr);

  const listedCount = (listedItems?.length ?? 0) + (bricklinkUploads?.length ?? 0);
  const listedValue =
    (listedItems?.reduce((sum, item) => sum + (Number(item.listing_value) || 0), 0) ?? 0) +
    (bricklinkUploads?.reduce((sum, u) => sum + (Number(u.selling_price) || 0), 0) ?? 0);

  // Sold this week - combine platform_orders and ebay_orders
  const { data: platformOrders } = await supabase
    .from('platform_orders')
    .select('id, total')
    .gte('order_date', weekStartStr)
    .lte('order_date', weekEndStr);

  const { data: ebayOrders } = await supabase
    .from('ebay_orders')
    .select('id, total_fee_basis_amount')
    .gte('creation_date', weekStartStr)
    .lte('creation_date', weekEndStr);

  const soldCount = (platformOrders?.length ?? 0) + (ebayOrders?.length ?? 0);
  const soldValue =
    (platformOrders?.reduce((sum, order) => sum + (Number(order.total) || 0), 0) ?? 0) +
    (ebayOrders?.reduce((sum, order) => sum + (Number(order.total_fee_basis_amount) || 0), 0) ?? 0);

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
  const ukOffset = now.toLocaleString('en-GB', {
    timeZone: 'Europe/London',
    hour: 'numeric',
    hour12: false,
  });
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

/**
 * Lazy-load all heavy service modules in parallel.
 * Called only after the auth check passes and there's work to do.
 */
async function loadServices() {
  const [
    ebay,
    amazon,
    amazonLinking,
    bricklink,
    brickowl,
    amazonArbitrage,
    shopify,
    notifications,
  ] = await Promise.all([
    import('@/lib/ebay'),
    import('@/lib/services/amazon-sync.service'),
    import('@/lib/amazon/amazon-inventory-linking.service'),
    import('@/lib/services/bricklink-sync.service'),
    import('@/lib/services/brickowl-sync.service'),
    import('@/lib/arbitrage/amazon-sync.service'),
    import('@/lib/shopify/sync.service'),
    import('@/lib/notifications/discord.service'),
  ]);

  return {
    EbayOrderSyncService: ebay.EbayOrderSyncService,
    EbayAutoSyncService: ebay.EbayAutoSyncService,
    EbayInventoryLinkingService: ebay.EbayInventoryLinkingService,
    AmazonSyncService: amazon.AmazonSyncService,
    AmazonInventoryLinkingService: amazonLinking.AmazonInventoryLinkingService,
    BrickLinkSyncService: bricklink.BrickLinkSyncService,
    BrickOwlSyncService: brickowl.BrickOwlSyncService,
    AmazonArbitrageSyncService: amazonArbitrage.AmazonArbitrageSyncService,
    ShopifySyncService: shopify.ShopifySyncService,
    discordService: notifications.discordService,
    DiscordColors: notifications.DiscordColors,
  };
}

type LoadedServices = Awaited<ReturnType<typeof loadServices>>;

/** Send Discord status report */
async function sendDiscordReport(
  results: FullSyncResults,
  discordService: LoadedServices['discordService'],
  DiscordColors: LoadedServices['DiscordColors']
): Promise<void> {
  const now = new Date();
  const dateStr = now.toLocaleDateString('en-GB', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });
  const timeStr = now.toLocaleTimeString('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'UTC',
  });

  // Determine overall status color
  const allSucceeded = results.platformSyncs.every(
    (s) => s.status === 'success' || s.status === 'skipped'
  );
  const allFailed = results.platformSyncs.every((s) => s.status === 'failed');
  let color: number;
  if (
    allSucceeded &&
    (!results.inventoryAsinSync || results.inventoryAsinSync.status === 'success')
  ) {
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

  // Build Amazon inventory linking section
  let amazonLinkingText: string;
  if (!results.amazonLinking) {
    amazonLinkingText = '⏭️ No orders to link';
  } else {
    const { autoLinked, queuedForResolution, autoCompleted } = results.amazonLinking;
    const parts: string[] = [];
    if (autoLinked > 0) parts.push(`✅ **${autoLinked}** auto-linked`);
    if (queuedForResolution > 0) parts.push(`🔍 **${queuedForResolution}** queued for resolution`);
    if (autoCompleted > 0) parts.push(`📦 **${autoCompleted}** auto-completed`);
    amazonLinkingText = parts.length > 0 ? parts.join(', ') : '✅ No unlinked orders found';
  }

  // Build eBay inventory linking section
  let ebayLinkingText: string;
  if (!results.ebayLinking) {
    ebayLinkingText = '⏭️ No orders to link';
  } else {
    const { autoLinked, queuedForResolution } = results.ebayLinking;
    const parts: string[] = [];
    if (autoLinked > 0) parts.push(`✅ **${autoLinked}** auto-linked`);
    if (queuedForResolution > 0) parts.push(`🔍 **${queuedForResolution}** queued for resolution`);
    ebayLinkingText = parts.length > 0 ? parts.join(', ') : '✅ No unlinked orders found';
  }

  // Build Shopify archive sync section
  let shopifyArchiveText: string;
  if (!results.shopifyArchiveSync) {
    shopifyArchiveText = '⏭️ Not available';
  } else if (results.shopifyArchiveSync.status === 'success') {
    shopifyArchiveText = `✅ ${results.shopifyArchiveSync.updated ?? 0} archived, ${results.shopifyArchiveSync.created ?? 0} created`;
  } else if (results.shopifyArchiveSync.status === 'skipped') {
    shopifyArchiveText = '⏭️ Skipped - No Shopify config';
  } else {
    shopifyArchiveText = `❌ ${results.shopifyArchiveSync.error ?? 'Failed'}`;
  }

  // Build Shopify alignment section
  let shopifyAlignmentText: string;
  if (!results.shopifyAlignment) {
    shopifyAlignmentText = '⏭️ Not available';
  } else {
    const { listedOnShopify, listedTotal, mismatches, orphanedProducts } = results.shopifyAlignment;
    const aligned = mismatches === 0 && orphanedProducts === 0;
    const statusEmoji = aligned ? '✅' : '⚠️';
    shopifyAlignmentText = [
      `${statusEmoji} **${listedOnShopify}** of **${listedTotal}** eligible items on Shopify`,
      mismatches > 0 ? `⚠️ **${mismatches}** LISTED items missing from Shopify` : null,
      orphanedProducts > 0
        ? `⚠️ **${orphanedProducts}** sold/non-LISTED items still active on Shopify`
        : null,
      aligned ? '🟢 Fully aligned' : null,
    ]
      .filter(Boolean)
      .join('\n');
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
    '## 🔗 AMAZON INVENTORY LINKING',
    amazonLinkingText,
    '',
    '## 🔗 EBAY INVENTORY LINKING',
    ebayLinkingText,
    '',
    '## 🏪 SHOPIFY SYNC',
    shopifyArchiveText,
    '',
    '## 🔗 SHOPIFY ALIGNMENT',
    shopifyAlignmentText,
    '',
    '## 📈 WEEKLY STATS',
    weeklyStatsText,
  ].join('\n');

  try {
    await discordService.send('sync-status', {
      title: `Hadley Bricks Full Sync - ${dateStr} (${timeStr} UTC)`,
      description,
      color,
      footer: {
        text: `Next sync: ${getNextRunTime()} | Duration: ${Math.round(results.totalDurationMs / 1000)}s`,
      },
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

  let execution: ExecutionHandle = noopHandle;
  try {
    // Verify cron secret
    const unauthorized = verifyCronAuth(request, 'FullSync');
    if (unauthorized) return unauthorized;

    execution = await jobExecutionService.start('full-sync', 'cron');

    console.log('[Cron FullSync] Starting full sync job');

    // Lazy-load all heavy service modules in parallel, after auth has passed.
    // Unauthorized requests skip this entirely.
    const services = await loadServices();
    const {
      EbayOrderSyncService,
      EbayAutoSyncService,
      EbayInventoryLinkingService,
      AmazonSyncService,
      AmazonInventoryLinkingService,
      BrickLinkSyncService,
      BrickOwlSyncService,
      AmazonArbitrageSyncService,
      ShopifySyncService,
      discordService,
      DiscordColors,
    } = services;

    const supabase = createServiceRoleClient();
    const results: FullSyncResults = {
      platformSyncs: [],
      inventoryAsinSync: null,
      amazonLinking: null,
      ebayLinking: null,
      shopifyArchiveSync: null,
      shopifyOrderSync: null,
      shopifyJanitors: null,
      shopifyAlignment: null,
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
      const BRICKLINK_TIMEOUT = 90000; // 90 seconds for BrickLink (slower API)

      // Create eBay services with service role client for cron context
      const ebayOrderSyncService = new EbayOrderSyncService(supabase);
      const ebayAutoSyncService = new EbayAutoSyncService(supabase);

      const syncPromises = [
        // eBay Orders
        withTimeout(ebayOrderSyncService.syncOrders(userId), SYNC_TIMEOUT, 'eBay Orders')
          .then((result) => reportPlatformSync('eBay Orders', result))
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
          .then((result) => reportPlatformSync('Amazon Orders', result))
          .catch((error) => ({
            platform: 'Amazon Orders',
            status: error.message.includes('credentials')
              ? ('skipped' as const)
              : ('failed' as const),
            error: error instanceof Error ? error.message : 'Unknown error',
          })),

        // BrickLink Orders
        // includeItems=true → BL detail endpoint per order (real cost.shipping breakdown)
        // includeFiled=true → capture orders the seller has filed (typically post-Shipped)
        withTimeout(
          new BrickLinkSyncService(supabase).syncOrders(userId, {
            includeItems: true,
            includeFiled: true,
          }),
          BRICKLINK_TIMEOUT,
          'BrickLink Orders'
        )
          .then((result) => reportPlatformSync('BrickLink Orders', result))
          .catch((error) => ({
            platform: 'BrickLink Orders',
            status: error.message.includes('credentials')
              ? ('skipped' as const)
              : ('failed' as const),
            error: error instanceof Error ? error.message : 'Unknown error',
          })),

        // Brick Owl Orders
        withTimeout(
          new BrickOwlSyncService(supabase).syncOrders(userId),
          SYNC_TIMEOUT,
          'Brick Owl Orders'
        )
          .then((result) => reportPlatformSync('Brick Owl Orders', result))
          .catch((error) => ({
            platform: 'Brick Owl Orders',
            status: error.message.includes('credentials')
              ? ('skipped' as const)
              : ('failed' as const),
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

      // Step 4b: Run Amazon Inventory Linking (match orders to inventory, mark SOLD, archive Shopify)
      console.log('[Cron FullSync] Running Amazon Inventory Linking...');
      try {
        const linkingService = new AmazonInventoryLinkingService(supabase, userId);

        const linkingResult = await withTimeout(
          linkingService.processHistoricalOrders({ mode: 'auto', includeSold: true }),
          90000,
          'Amazon Inventory Linking'
        );

        const autoCompleteResult = await withTimeout(
          linkingService.autoCompleteOldOrders(14),
          SYNC_TIMEOUT,
          'Amazon Auto-Complete Old Orders'
        );

        results.amazonLinking = {
          autoLinked: linkingResult.totalAutoLinked,
          queuedForResolution: linkingResult.totalQueuedForResolution,
          autoCompleted: autoCompleteResult.completed,
        };

        console.log(
          `[Cron FullSync] Amazon linking: ${linkingResult.totalAutoLinked} auto-linked, ${linkingResult.totalQueuedForResolution} queued, ${autoCompleteResult.completed} auto-completed`
        );
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : 'Unknown error';
        console.error('[Cron FullSync] Amazon Inventory Linking failed:', errorMsg);
        // Non-fatal - don't block the rest of the sync
      }

      // Step 4b-2: Amazon phantom-stock reconcile — surface units still shown as
      // available that actually sold (order shipped, sale never linked). Sends its
      // own Discord alert on candidates. Non-fatal.
      try {
        const phantom = await withTimeout(
          new AmazonInventoryLinkingService(supabase, userId).reconcilePhantomStock(),
          SYNC_TIMEOUT,
          'Amazon Phantom Reconcile'
        );
        console.log(
          `[Cron FullSync] Phantom reconcile: ${phantom.phantoms.length} candidate(s) across ${phantom.checkedOrders} order(s), ${phantom.uncoveredUnits} uncovered unit(s)`
        );
      } catch (error) {
        console.error(
          '[Cron FullSync] Phantom reconcile failed:',
          error instanceof Error ? error.message : 'Unknown error'
        );
        // Non-fatal
      }

      // Step 4c: Run eBay Inventory Linking (match orders to inventory, mark SOLD, archive Shopify)
      console.log('[Cron FullSync] Running eBay Inventory Linking...');
      try {
        const ebayLinkingService = new EbayInventoryLinkingService(supabase, userId);

        const ebayLinkingResult = await withTimeout(
          ebayLinkingService.processHistoricalOrders({ includePaid: true }),
          90000,
          'eBay Inventory Linking'
        );

        results.ebayLinking = {
          autoLinked: ebayLinkingResult.totalAutoLinked,
          queuedForResolution: ebayLinkingResult.totalQueuedForResolution,
        };

        console.log(
          `[Cron FullSync] eBay linking: ${ebayLinkingResult.totalAutoLinked} auto-linked, ${ebayLinkingResult.totalQueuedForResolution} queued`
        );
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : 'Unknown error';
        console.error('[Cron FullSync] eBay Inventory Linking failed:', errorMsg);
        // Non-fatal - don't block the rest of the sync
      }
    }

    // Step 5: Shopify archive safety-net — archive products for items no longer LISTED
    if (userIds.length > 0) {
      const userId = userIds[0];
      console.log('[Cron FullSync] Running Shopify archive safety-net...');
      try {
        const shopifySync = new ShopifySyncService(supabase, userId);
        const batchResult = await withTimeout(
          shopifySync.batchSync(100),
          180000,
          'Shopify Batch Sync'
        );
        results.shopifyArchiveSync = {
          platform: 'Shopify Batch Sync',
          status: 'success',
          processed: batchResult.items_processed,
          created: batchResult.items_created + batchResult.items_added_to_group,
          updated: batchResult.items_archived,
        };
        console.log(
          `[Cron FullSync] Shopify: ${batchResult.items_archived} archived, ${batchResult.items_created} created, ${batchResult.items_added_to_group} added to groups`
        );

        if (batchResult.items_archived > 0) {
          discordService
            .sendSyncStatus({
              title: '🏪 Shopify Safety-Net Archive',
              message: `Archived **${batchResult.items_archived}** product(s) that were no longer LISTED.\nThese were missed by the direct sale hooks.`,
              success: true,
            })
            .catch(() => {});
        }
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : 'Unknown error';
        results.shopifyArchiveSync = {
          platform: 'Shopify Archive',
          status:
            errorMsg.includes('config') || errorMsg.includes('disabled') ? 'skipped' : 'failed',
          error: errorMsg,
        };
      }
    }

    // Step 5b: Shopify inbound sales — ingest Shopify orders, mark items SOLD,
    // de-list them on eBay, then reconcile Shopify quantities. Closes the
    // double-sell gap where a Shopify sale left the same item live on eBay.
    // Resolve the Shopify-enabled user directly (may differ from userIds[0],
    // which is the first user with eBay/Amazon credentials).
    const { data: shopifyUserRows } = await supabase
      .from('shopify_config')
      .select('user_id')
      .eq('sync_enabled', true)
      .limit(1);
    const shopifyUserId = shopifyUserRows?.[0]?.user_id;
    if (shopifyUserId) {
      const userId = shopifyUserId;
      console.log('[Cron FullSync] Running Shopify inbound order sync...');
      try {
        const [{ ShopifyOrderSyncService }, { ShopifySyncService: ShopifySyncSvc }] =
          await Promise.all([
            import('@/lib/shopify/order-sync.service'),
            import('@/lib/shopify/sync.service'),
          ]);
        const orderResult = await withTimeout(
          new ShopifyOrderSyncService(supabase, userId).syncOrders(),
          180000,
          'Shopify Order Sync'
        );
        // Reconcile quantities (orphans + drift) after ingestion.
        const syncSvc = new ShopifySyncSvc(supabase, userId);
        const reconcile = await withTimeout(
          syncSvc.reconcileInventoryQuantities(),
          180000,
          'Shopify Reconcile'
        ).catch((e) => ({ reduced: 0, errors: [{ sku: null, error: String(e) }] }));

        // Janitors that previously lived only in the unscheduled /api/cron/shopify-orders
        // route (so they never ran): archive untracked orphan duplicates, then re-archive
        // sold products still ACTIVE on live Shopify (cache-vs-live archive drift, which
        // otherwise leaves sold items buyable indefinitely). Both non-fatal.
        const janitorErrors: string[] = [];
        const dedupe = await withTimeout(syncSvc.dedupeBySku(), 120000, 'Shopify Dedupe').catch(
          (e) => {
            janitorErrors.push(`dedupe: ${e instanceof Error ? e.message : String(e)}`);
            return null;
          }
        );
        const drift = await withTimeout(
          syncSvc.reconcileArchiveDrift(),
          120000,
          'Shopify Archive Drift'
        ).catch((e) => {
          janitorErrors.push(`archiveDrift: ${e instanceof Error ? e.message : String(e)}`);
          return null;
        });
        results.shopifyJanitors = {
          dedupeDuplicateSkus: dedupe?.duplicate_skus ?? 0,
          dedupeArchived: dedupe?.archived ?? 0,
          driftFound: drift?.drifted ?? 0,
          driftArchived: drift?.archived ?? 0,
          errors: janitorErrors,
        };
        console.log(
          `[Cron FullSync] Shopify janitors: ${dedupe?.archived ?? 0} dupes archived, ${drift?.archived ?? 0}/${drift?.drifted ?? 0} drifted re-archived${janitorErrors.length ? `, errors: ${janitorErrors.join('; ')}` : ''}`
        );

        results.shopifyOrderSync = {
          platform: 'Shopify Order Sync',
          status: orderResult.success ? 'success' : 'failed',
          processed: orderResult.lineItemsProcessed,
          updated: orderResult.itemsMarkedSold,
          created: reconcile.reduced,
          error: orderResult.errors.length ? orderResult.errors[0].error : undefined,
        };
        console.log(
          `[Cron FullSync] Shopify orders: ${orderResult.itemsMarkedSold} sold, ${orderResult.ebayListingsEnded} eBay ended, ${reconcile.reduced} qty clamped`
        );
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : 'Unknown error';
        results.shopifyOrderSync = {
          platform: 'Shopify Order Sync',
          status:
            errorMsg.includes('config') || errorMsg.includes('disabled') ? 'skipped' : 'failed',
          error: errorMsg,
        };
      }
    }

    // Step 6: Shopify alignment check
    console.log('[Cron FullSync] Checking Shopify alignment...');
    try {
      results.shopifyAlignment = await getShopifyAlignment(supabase);
      console.log(
        `[Cron FullSync] Shopify alignment: ${results.shopifyAlignment.listedOnShopify}/${results.shopifyAlignment.listedTotal} on Shopify, ${results.shopifyAlignment.mismatches} missing, ${results.shopifyAlignment.orphanedProducts} orphaned`
      );
    } catch (error) {
      console.error('[Cron FullSync] Shopify alignment check failed:', error);
    }

    // Step 7: Get weekly stats
    console.log('[Cron FullSync] Calculating weekly stats...');
    results.weeklyStats = await getWeeklyStats(supabase);

    // Step 8: Calculate total duration
    results.totalDurationMs = Date.now() - startTime;

    // Step 9: Send Discord notification
    console.log('[Cron FullSync] Sending Discord notification...');
    await sendDiscordReport(results, discordService, DiscordColors);

    console.log(`[Cron FullSync] Completed in ${results.totalDurationMs}ms`);

    await execution.complete(
      {
        platformSyncs: results.platformSyncs.length,
        stuckJobsFound: results.stuckJobs.length,
        stuckJobsReset: results.stuckJobsReset,
      },
      200,
      results.platformSyncs.filter((s) => s.status === 'success').length,
      results.platformSyncs.filter((s) => s.status === 'failed').length
    );

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

    await execution.fail(error, 500);

    // Try to send error notification to Discord. Lazy-load here so the catch
    // block doesn't depend on whether `loadServices()` ran or threw.
    try {
      const { discordService } = await import('@/lib/notifications/discord.service');
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
