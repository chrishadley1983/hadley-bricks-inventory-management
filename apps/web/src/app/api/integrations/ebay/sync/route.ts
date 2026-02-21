import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { ebayTransactionSyncService, ebayOrderSyncService, ebayAutoSyncService } from '@/lib/ebay';

const SyncSchema = z.object({
  type: z.enum(['orders', 'transactions', 'payouts', 'all']).default('all'),
  fullSync: z.boolean().optional().default(false),
});

/**
 * POST /api/integrations/ebay/sync
 * Trigger a sync of eBay data
 */
export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json().catch(() => ({}));
    const parsed = SyncSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Validation failed', details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const { type, fullSync } = parsed.data;

    // For 'all' type, use the auto sync service for coordinated sync
    if (type === 'all') {
      const result = fullSync
        ? await ebayAutoSyncService.performFullSync(user.id)
        : await ebayAutoSyncService.performIncrementalSync(user.id);

      return NextResponse.json({
        success: result.orders.success && result.transactions.success && result.payouts.success,
        results: {
          orders: result.orders,
          transactions: result.transactions,
          payouts: result.payouts,
        },
        totalDuration: result.totalDuration,
      });
    }

    // Handle individual sync types
    const results: Record<string, unknown> = {};

    if (type === 'orders') {
      results.orders = await ebayOrderSyncService.syncOrders(user.id, { fullSync });
    }

    if (type === 'transactions') {
      results.transactions = await ebayTransactionSyncService.syncTransactions(user.id, {
        fullSync,
      });
    }

    if (type === 'payouts') {
      results.payouts = await ebayTransactionSyncService.syncPayouts(user.id, { fullSync });
    }

    // Check for any failures
    const hasFailures = Object.values(results).some(
      (r) =>
        typeof r === 'object' &&
        r !== null &&
        'success' in r &&
        !(r as { success: boolean }).success
    );

    return NextResponse.json({
      success: !hasFailures,
      results,
    });
  } catch (error) {
    console.error('[POST /api/integrations/ebay/sync] Error:', error);

    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : 'Sync failed',
      },
      { status: 500 }
    );
  }
}

/**
 * GET /api/integrations/ebay/sync
 * Get sync status and history
 */
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

    // Get comprehensive sync status
    const status = await ebayAutoSyncService.getSyncStatusSummary(user.id);

    // Get recent sync logs
    const { data: syncLogs, error } = await supabase
      .from('ebay_sync_log')
      .select('*')
      .eq('user_id', user.id)
      .order('started_at', { ascending: false })
      .limit(20);

    if (error) {
      console.error('[GET /api/integrations/ebay/sync] Error fetching logs:', error);
      return NextResponse.json({ error: 'Failed to fetch sync logs' }, { status: 500 });
    }

    return NextResponse.json({
      status,
      logs: syncLogs || [],
    });
  } catch (error) {
    console.error('[GET /api/integrations/ebay/sync] Error:', error);

    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : 'Failed to fetch sync status',
      },
      { status: 500 }
    );
  }
}
