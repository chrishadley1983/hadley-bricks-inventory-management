import { NextRequest, NextResponse } from 'next/server';
import { createClient, createServiceRoleClient } from '@/lib/supabase/server';
import { validateAuth } from '@/lib/api/validate-auth';
import { SupabaseClient } from '@supabase/supabase-js';
import { ebayOrderSyncService, ebayAutoSyncService } from '@/lib/ebay';
import { AmazonSyncService } from '@/lib/services/amazon-sync.service';
import { BrickLinkSyncService } from '@/lib/services/bricklink-sync.service';
import { BrickOwlSyncService } from '@/lib/services/brickowl-sync.service';

interface SyncResult {
  platform: string;
  type: 'order' | 'transaction' | 'stock';
  status: 'COMPLETED' | 'FAILED';
  processed: number;
  created: number;
  updated: number;
  error?: string;
  latestDataDate?: string;
}

interface WeeklyStats {
  listed: { count: number; value: number };
  sold: { count: number; value: number };
  backlog: number;
}

interface SyncAllResponse {
  success: boolean;
  orders: Record<string, SyncResult>;
  transactions: Record<string, SyncResult>;
  stockImports: Record<string, SyncResult>;
  weeklyStats: WeeklyStats;
  syncedAt: string;
}

/**
 * Get weekly stats from database
 */
async function getWeeklyStats(userId: string, supabase: SupabaseClient): Promise<WeeklyStats> {
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
    .eq('user_id', userId)
    .eq('status', 'LISTED')
    .gte('created_at', weekStartIso);

  const listedCount = listedItems?.length || 0;
  const listedValue =
    listedItems?.reduce((sum, item) => sum + (Number(item.listing_value) || 0), 0) || 0;

  // Sold this week (from platform_orders fulfilled this week)
  const { data: soldOrders } = await supabase
    .from('platform_orders')
    .select('id, total')
    .eq('user_id', userId)
    .gte('fulfilled_at', weekStartIso);

  const soldCount = soldOrders?.length || 0;
  const soldValue = soldOrders?.reduce((sum, order) => sum + (Number(order.total) || 0), 0) || 0;

  // Backlog (items with status BACKLOG)
  const { count: backlogCount } = await supabase
    .from('inventory_items')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
    .eq('status', 'BACKLOG');

  return {
    listed: { count: listedCount, value: Math.round(listedValue * 100) / 100 },
    sold: { count: soldCount, value: Math.round(soldValue * 100) / 100 },
    backlog: backlogCount || 0,
  };
}

/**
 * Fetch sync summary from database (last 10 minutes)
 */
async function fetchSyncSummary(userId: string, supabase: SupabaseClient): Promise<SyncResult[]> {
  const items: SyncResult[] = [];

  // eBay sync logs - get latest of each type
  const { data: ebayLogs } = await supabase
    .from('ebay_sync_log')
    .select(
      'sync_type, status, records_processed, records_created, records_updated, error_message, completed_at'
    )
    .eq('user_id', userId)
    .order('started_at', { ascending: false })
    .limit(10);

  const { data: latestEbayOrder } = await supabase
    .from('ebay_orders')
    .select('creation_date')
    .eq('user_id', userId)
    .order('creation_date', { ascending: false })
    .limit(1)
    .single();

  if (ebayLogs) {
    const ebayByType = new Map<string, (typeof ebayLogs)[0]>();
    for (const log of ebayLogs) {
      if (!ebayByType.has(log.sync_type)) {
        ebayByType.set(log.sync_type, log);
      }
    }
    for (const [syncType, log] of ebayByType) {
      items.push({
        platform: 'eBay',
        type: syncType === 'ORDERS' ? 'order' : 'transaction',
        status: log.status === 'COMPLETED' ? 'COMPLETED' : 'FAILED',
        processed: log.records_processed ?? 0,
        created: log.records_created ?? 0,
        updated: log.records_updated ?? 0,
        error: log.error_message ?? undefined,
        latestDataDate: latestEbayOrder?.creation_date ?? undefined,
      });
    }
  }

  // Amazon sync logs - get latest of each type
  const { data: amazonLogs } = await supabase
    .from('amazon_sync_log')
    .select('sync_type, status, records_processed, records_created, records_updated, error_message')
    .eq('user_id', userId)
    .order('started_at', { ascending: false })
    .limit(10);

  const { data: latestAmazonOrder } = await supabase
    .from('platform_orders')
    .select('order_date')
    .eq('user_id', userId)
    .eq('platform', 'amazon')
    .order('order_date', { ascending: false })
    .limit(1)
    .single();

  if (amazonLogs) {
    const amazonByType = new Map<string, (typeof amazonLogs)[0]>();
    for (const log of amazonLogs) {
      if (!amazonByType.has(log.sync_type)) {
        amazonByType.set(log.sync_type, log);
      }
    }
    for (const [syncType, log] of amazonByType) {
      items.push({
        platform: 'Amazon',
        type: syncType === 'ORDERS' ? 'order' : 'transaction',
        status: log.status === 'COMPLETED' ? 'COMPLETED' : 'FAILED',
        processed: log.records_processed ?? 0,
        created: log.records_created ?? 0,
        updated: log.records_updated ?? 0,
        error: log.error_message ?? undefined,
        latestDataDate: latestAmazonOrder?.order_date ?? undefined,
      });
    }
  }

  // BrickLink sync logs - get latest
  const { data: bricklinkLogs } = await supabase
    .from('bricklink_sync_log')
    .select('status, orders_processed, orders_created, orders_updated, error_message')
    .eq('user_id', userId)
    .order('started_at', { ascending: false })
    .limit(1);

  const { data: latestBricklinkOrder } = await supabase
    .from('platform_orders')
    .select('order_date')
    .eq('user_id', userId)
    .eq('platform', 'bricklink')
    .order('order_date', { ascending: false })
    .limit(1)
    .single();

  if (bricklinkLogs?.[0]) {
    const log = bricklinkLogs[0];
    items.push({
      platform: 'BrickLink',
      type: 'order',
      status: log.status === 'COMPLETED' ? 'COMPLETED' : 'FAILED',
      processed: log.orders_processed ?? 0,
      created: log.orders_created ?? 0,
      updated: log.orders_updated ?? 0,
      error: log.error_message ?? undefined,
      latestDataDate: latestBricklinkOrder?.order_date ?? undefined,
    });
  }

  // BrickOwl sync logs - get latest
  const { data: brickowlLogs } = await supabase
    .from('brickowl_sync_log')
    .select('status, orders_processed, orders_created, orders_updated, error_message')
    .eq('user_id', userId)
    .order('started_at', { ascending: false })
    .limit(1);

  const { data: latestBrickowlOrder } = await supabase
    .from('platform_orders')
    .select('order_date')
    .eq('user_id', userId)
    .eq('platform', 'brickowl')
    .order('order_date', { ascending: false })
    .limit(1)
    .single();

  if (brickowlLogs?.[0]) {
    const log = brickowlLogs[0];
    items.push({
      platform: 'Brick Owl',
      type: 'order',
      status: log.status === 'COMPLETED' ? 'COMPLETED' : 'FAILED',
      processed: log.orders_processed ?? 0,
      created: log.orders_created ?? 0,
      updated: log.orders_updated ?? 0,
      error: log.error_message ?? undefined,
      latestDataDate: latestBrickowlOrder?.order_date ?? undefined,
    });
  }

  // Stock imports - get latest of each platform
  const { data: stockImportLogs } = await supabase
    .from('platform_listing_imports')
    .select('platform, status, processed_rows, total_rows, error_message')
    .eq('user_id', userId)
    .order('started_at', { ascending: false })
    .limit(10);

  if (stockImportLogs) {
    const stockByPlatform = new Map<string, (typeof stockImportLogs)[0]>();
    for (const log of stockImportLogs) {
      if (!stockByPlatform.has(log.platform)) {
        stockByPlatform.set(log.platform, log);
      }
    }
    for (const [platform, log] of stockByPlatform) {
      items.push({
        platform:
          platform === 'ebay'
            ? 'eBay Stock'
            : platform === 'amazon'
              ? 'Amazon Stock'
              : `${platform} Stock`,
        type: 'stock',
        status: log.status === 'completed' ? 'COMPLETED' : 'FAILED',
        processed: log.processed_rows ?? 0,
        created: 0,
        updated: log.total_rows ?? 0,
        error: log.error_message ?? undefined,
      });
    }
  }

  return items;
}

/**
 * POST /api/workflow/sync-all
 *
 * Runs all platform syncs and returns consolidated results with weekly stats.
 */
export async function POST(request: NextRequest) {
  try {
    // Validate auth via API key or session cookie
    const auth = await validateAuth(request);
    if (!auth) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Use service role client for API key auth (bypasses RLS)
    // Use regular client for cookie auth (respects RLS)
    const isApiKeyAuth = !!request.headers.get('x-api-key');
    const supabase = isApiKeyAuth ? createServiceRoleClient() : await createClient();
    const userId = auth.userId;

    console.log('[sync-all] Starting sync for user:', userId);

    // Instantiate services that need supabase
    const amazonSyncService = new AmazonSyncService(supabase);
    const bricklinkSyncService = new BrickLinkSyncService(supabase);
    const brickowlSyncService = new BrickOwlSyncService(supabase);

    // Run all syncs in parallel
    const syncPromises = [
      // eBay syncs (uses singleton services)
      ebayOrderSyncService.syncOrders(userId).catch((e: Error) => {
        console.error('[sync-all] eBay orders error:', e.message);
        return null;
      }),
      ebayAutoSyncService.performIncrementalSync(userId).catch((e: Error) => {
        console.error('[sync-all] eBay auto sync error:', e.message);
        return null;
      }),

      // Amazon sync
      amazonSyncService.syncOrders(userId).catch((e: Error) => {
        console.error('[sync-all] Amazon orders error:', e.message);
        return null;
      }),

      // BrickLink sync
      bricklinkSyncService.syncOrders(userId).catch((e: Error) => {
        console.error('[sync-all] BrickLink orders error:', e.message);
        return null;
      }),

      // BrickOwl sync
      brickowlSyncService.syncOrders(userId).catch((e: Error) => {
        console.error('[sync-all] BrickOwl orders error:', e.message);
        return null;
      }),
    ];

    // Wait for all syncs to complete
    await Promise.allSettled(syncPromises);

    console.log('[sync-all] All syncs completed, fetching summary...');

    // Give a moment for logs to be written
    await new Promise((resolve) => setTimeout(resolve, 1000));

    // Fetch sync summary from database
    const syncResults = await fetchSyncSummary(userId, supabase);

    // Organize results by type
    const orders: Record<string, SyncResult> = {};
    const transactions: Record<string, SyncResult> = {};
    const stockImports: Record<string, SyncResult> = {};

    for (const result of syncResults) {
      const key = result.platform.toLowerCase().replace(/\s+/g, '-');
      switch (result.type) {
        case 'order':
          orders[key] = result;
          break;
        case 'transaction':
          transactions[key] = result;
          break;
        case 'stock':
          stockImports[key] = result;
          break;
      }
    }

    // Get weekly stats
    const weeklyStats = await getWeeklyStats(userId, supabase);

    const response: SyncAllResponse = {
      success: true,
      orders,
      transactions,
      stockImports,
      weeklyStats,
      syncedAt: new Date().toISOString(),
    };

    console.log('[sync-all] Sync complete');

    return NextResponse.json({ data: response });
  } catch (error) {
    console.error('[POST /api/workflow/sync-all] Error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    );
  }
}
