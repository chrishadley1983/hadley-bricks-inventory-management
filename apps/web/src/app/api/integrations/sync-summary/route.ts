/**
 * Sync Summary API
 *
 * GET: Fetch summary of recent sync operations and latest data dates
 */

import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

interface SyncSummaryItem {
  platform: string;
  type: 'order' | 'transaction';
  status: 'COMPLETED' | 'FAILED' | 'RUNNING';
  processed: number;
  created: number;
  updated: number;
  error?: string;
  syncedAt: string;
  latestDataDate?: string;
}

interface SyncSummaryResponse {
  items: SyncSummaryItem[];
  overallStatus: 'success' | 'partial' | 'failed';
  syncedAt: string;
}

export async function GET() {
  try {
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const items: SyncSummaryItem[] = [];
    const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000).toISOString();

    // eBay sync logs
    const { data: ebayLogs } = await supabase
      .from('ebay_sync_log')
      .select('sync_type, status, records_processed, records_created, records_updated, error_message, completed_at')
      .eq('user_id', user.id)
      .gte('started_at', tenMinutesAgo)
      .order('started_at', { ascending: false });

    // Get latest eBay order date (column is creation_date)
    const { data: latestEbayOrder } = await supabase
      .from('ebay_orders')
      .select('creation_date')
      .eq('user_id', user.id)
      .order('creation_date', { ascending: false })
      .limit(1)
      .single();

    // Get latest eBay transaction date
    const { data: latestEbayTransaction } = await supabase
      .from('ebay_transactions')
      .select('transaction_date')
      .eq('user_id', user.id)
      .order('transaction_date', { ascending: false })
      .limit(1)
      .single();

    if (ebayLogs) {
      // Group by sync_type and take the most recent
      const ebayByType = new Map<string, (typeof ebayLogs)[0]>();
      for (const log of ebayLogs) {
        if (!ebayByType.has(log.sync_type)) {
          ebayByType.set(log.sync_type, log);
        }
      }

      for (const [syncType, log] of ebayByType) {
        const isOrder = syncType === 'ORDERS';
        items.push({
          platform: 'eBay',
          type: isOrder ? 'order' : 'transaction',
          status: log.status as 'COMPLETED' | 'FAILED' | 'RUNNING',
          processed: log.records_processed ?? 0,
          created: log.records_created ?? 0,
          updated: log.records_updated ?? 0,
          error: log.error_message ?? undefined,
          syncedAt: log.completed_at ?? new Date().toISOString(),
          latestDataDate: isOrder
            ? (latestEbayOrder?.creation_date ?? undefined)
            : (latestEbayTransaction?.transaction_date ?? undefined),
        });
      }
    }

    // Amazon sync logs (both ORDERS and TRANSACTIONS)
    const { data: amazonLogs } = await supabase
      .from('amazon_sync_log')
      .select('sync_type, status, records_processed, records_created, records_updated, error_message, completed_at')
      .eq('user_id', user.id)
      .gte('started_at', tenMinutesAgo)
      .order('started_at', { ascending: false });

    // Get latest Amazon order date
    const { data: latestAmazonOrder } = await supabase
      .from('platform_orders')
      .select('order_date')
      .eq('user_id', user.id)
      .eq('platform', 'amazon')
      .order('order_date', { ascending: false })
      .limit(1)
      .single();

    // Get latest Amazon transaction date
    const { data: latestAmazonTransaction } = await supabase
      .from('amazon_transactions')
      .select('posted_date')
      .eq('user_id', user.id)
      .order('posted_date', { ascending: false })
      .limit(1)
      .single();

    if (amazonLogs) {
      // Group by sync_type and take the most recent of each type
      const amazonByType = new Map<string, (typeof amazonLogs)[0]>();
      for (const log of amazonLogs) {
        if (!amazonByType.has(log.sync_type)) {
          amazonByType.set(log.sync_type, log);
        }
      }

      for (const [syncType, log] of amazonByType) {
        const isOrder = syncType === 'ORDERS';
        items.push({
          platform: 'Amazon',
          type: isOrder ? 'order' : 'transaction',
          status: log.status as 'COMPLETED' | 'FAILED' | 'RUNNING',
          processed: log.records_processed ?? 0,
          created: log.records_created ?? 0,
          updated: log.records_updated ?? 0,
          error: log.error_message ?? undefined,
          syncedAt: log.completed_at ?? new Date().toISOString(),
          latestDataDate: isOrder
            ? (latestAmazonOrder?.order_date ?? undefined)
            : (latestAmazonTransaction?.posted_date ?? undefined),
        });
      }
    }

    // BrickLink sync logs
    const { data: bricklinkLogs } = await supabase
      .from('bricklink_sync_log')
      .select('sync_mode, status, orders_processed, orders_created, orders_updated, error_message, completed_at')
      .eq('user_id', user.id)
      .gte('started_at', tenMinutesAgo)
      .order('started_at', { ascending: false })
      .limit(1);

    // Get latest BrickLink order date
    const { data: latestBricklinkOrder } = await supabase
      .from('platform_orders')
      .select('order_date')
      .eq('user_id', user.id)
      .eq('platform', 'bricklink')
      .order('order_date', { ascending: false })
      .limit(1)
      .single();

    if (bricklinkLogs?.[0]) {
      const log = bricklinkLogs[0];
      items.push({
        platform: 'BrickLink',
        type: 'order',
        status: log.status as 'COMPLETED' | 'FAILED' | 'RUNNING',
        processed: log.orders_processed ?? 0,
        created: log.orders_created ?? 0,
        updated: log.orders_updated ?? 0,
        error: log.error_message ?? undefined,
        syncedAt: log.completed_at ?? new Date().toISOString(),
        latestDataDate: latestBricklinkOrder?.order_date ?? undefined,
      });
    }

    // BrickOwl sync logs
    const { data: brickowlLogs } = await supabase
      .from('brickowl_sync_log')
      .select('sync_mode, status, orders_processed, orders_created, orders_updated, error_message, completed_at')
      .eq('user_id', user.id)
      .gte('started_at', tenMinutesAgo)
      .order('started_at', { ascending: false })
      .limit(1);

    // Get latest BrickOwl order date
    const { data: latestBrickowlOrder } = await supabase
      .from('platform_orders')
      .select('order_date')
      .eq('user_id', user.id)
      .eq('platform', 'brickowl')
      .order('order_date', { ascending: false })
      .limit(1)
      .single();

    if (brickowlLogs?.[0]) {
      const log = brickowlLogs[0];
      items.push({
        platform: 'Brick Owl',
        type: 'order',
        status: log.status as 'COMPLETED' | 'FAILED' | 'RUNNING',
        processed: log.orders_processed ?? 0,
        created: log.orders_created ?? 0,
        updated: log.orders_updated ?? 0,
        error: log.error_message ?? undefined,
        syncedAt: log.completed_at ?? new Date().toISOString(),
        latestDataDate: latestBrickowlOrder?.order_date ?? undefined,
      });
    }

    // Monzo sync logs
    const { data: monzoLogs } = await supabase
      .from('monzo_sync_log')
      .select('status, transactions_processed, transactions_created, transactions_updated, error_message, completed_at')
      .eq('user_id', user.id)
      .gte('started_at', tenMinutesAgo)
      .order('started_at', { ascending: false })
      .limit(1);

    // Get latest Monzo transaction date
    const { data: latestMonzoTransaction } = await supabase
      .from('monzo_transactions')
      .select('created')
      .eq('user_id', user.id)
      .order('created', { ascending: false })
      .limit(1)
      .single();

    if (monzoLogs?.[0]) {
      const log = monzoLogs[0];
      items.push({
        platform: 'Monzo',
        type: 'transaction',
        status: log.status as 'COMPLETED' | 'FAILED' | 'RUNNING',
        processed: log.transactions_processed ?? 0,
        created: log.transactions_created ?? 0,
        updated: log.transactions_updated ?? 0,
        error: log.error_message ?? undefined,
        syncedAt: log.completed_at ?? new Date().toISOString(),
        latestDataDate: latestMonzoTransaction?.created ?? undefined,
      });
    }

    // PayPal sync logs
    const { data: paypalLogs } = await supabase
      .from('paypal_sync_log')
      .select('status, transactions_processed, transactions_created, transactions_updated, error_message, completed_at')
      .eq('user_id', user.id)
      .gte('started_at', tenMinutesAgo)
      .order('started_at', { ascending: false })
      .limit(1);

    // Get latest PayPal transaction date
    const { data: latestPaypalTransaction } = await supabase
      .from('paypal_transactions')
      .select('transaction_date')
      .eq('user_id', user.id)
      .order('transaction_date', { ascending: false })
      .limit(1)
      .single();

    if (paypalLogs?.[0]) {
      const log = paypalLogs[0];
      items.push({
        platform: 'PayPal',
        type: 'transaction',
        status: log.status as 'COMPLETED' | 'FAILED' | 'RUNNING',
        processed: log.transactions_processed ?? 0,
        created: log.transactions_created ?? 0,
        updated: log.transactions_updated ?? 0,
        error: log.error_message ?? undefined,
        syncedAt: log.completed_at ?? new Date().toISOString(),
        latestDataDate: latestPaypalTransaction?.transaction_date ?? undefined,
      });
    }

    // Determine overall status
    const hasFailures = items.some((item) => item.status === 'FAILED');
    const hasRunning = items.some((item) => item.status === 'RUNNING');
    const allCompleted = items.every((item) => item.status === 'COMPLETED');

    let overallStatus: 'success' | 'partial' | 'failed' = 'success';
    if (hasRunning) {
      overallStatus = 'partial';
    } else if (hasFailures && !allCompleted) {
      overallStatus = items.some((item) => item.status === 'COMPLETED') ? 'partial' : 'failed';
    } else if (hasFailures) {
      overallStatus = 'partial';
    }

    return NextResponse.json({
      items,
      overallStatus,
      syncedAt: new Date().toISOString(),
    } as SyncSummaryResponse);
  } catch (error) {
    console.error('[GET /api/integrations/sync-summary] Error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
