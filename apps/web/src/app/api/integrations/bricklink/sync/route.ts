import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { BrickLinkSyncService } from '@/lib/services';
import { createBrickLinkTransactionSyncService } from '@/lib/bricklink/bricklink-transaction-sync.service';

const SyncOptionsSchema = z.object({
  includeFiled: z.boolean().optional().default(false),
  fullSync: z.boolean().optional().default(false),
  includeItems: z.boolean().optional().default(true),
  resetBeforeSync: z.boolean().optional().default(false), // Clear existing transactions before sync
  transactionsOnly: z.boolean().optional().default(false), // Skip platform_orders sync (faster)
});

/**
 * POST /api/integrations/bricklink/sync
 * Trigger a sync of BrickLink orders to both platform_orders AND bricklink_transactions
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

    // Parse options
    let options = {
      includeFiled: false,
      fullSync: false,
      includeItems: true,
      resetBeforeSync: false,
      transactionsOnly: false,
    };
    try {
      const body = await request.json();
      const parsed = SyncOptionsSchema.safeParse(body);
      if (parsed.success) {
        options = parsed.data;
      }
    } catch {
      // Use defaults if no body provided
    }

    const syncService = new BrickLinkSyncService(supabase);
    const transactionSyncService = createBrickLinkTransactionSyncService();

    // Reset before sync if requested (clears bad data from previous syncs)
    if (options.resetBeforeSync) {
      console.log('[POST /api/integrations/bricklink/sync] Resetting transactions before sync...');
      await supabase.from('bricklink_transactions').delete().eq('user_id', user.id);
      await supabase.from('bricklink_sync_config').delete().eq('user_id', user.id);
      await supabase.from('bricklink_sync_log').delete().eq('user_id', user.id);
      // Force full sync after reset
      options.fullSync = true;
    }

    // Check if configured
    const isConfigured = await syncService.isConfigured(user.id);
    if (!isConfigured) {
      return NextResponse.json({ error: 'BrickLink credentials not configured' }, { status: 400 });
    }

    // Sync transactions (to bricklink_transactions table)
    const transactionResult = await transactionSyncService.syncTransactions(user.id, {
      fullSync: options.fullSync,
      includeFiled: options.includeFiled,
    });

    // Optionally sync to platform_orders (slower, fetches each order individually)
    let orderResult = null;
    if (!options.transactionsOnly) {
      orderResult = await syncService.syncOrders(user.id, options);
    }

    return NextResponse.json({
      success: transactionResult.success && (orderResult?.success ?? true),
      data: {
        // Order sync results (platform_orders) - only if not transactionsOnly
        ordersProcessed: orderResult?.ordersProcessed ?? 0,
        ordersCreated: orderResult?.ordersCreated ?? 0,
        ordersUpdated: orderResult?.ordersUpdated ?? 0,
        ordersSkipped: orderResult?.ordersSkipped ?? 0,
        errors: orderResult?.errors ?? [],
        lastSyncedAt: orderResult?.lastSyncedAt?.toISOString() ?? new Date().toISOString(),
        // Transaction sync results (bricklink_transactions)
        transactions: {
          processed: transactionResult.ordersProcessed,
          created: transactionResult.ordersCreated,
          updated: transactionResult.ordersUpdated,
          error: transactionResult.error,
        },
      },
    });
  } catch (error) {
    console.error('[POST /api/integrations/bricklink/sync] Error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

/**
 * GET /api/integrations/bricklink/sync
 * Get sync status
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

    const syncService = new BrickLinkSyncService(supabase);
    const transactionSyncService = createBrickLinkTransactionSyncService();

    const [status, transactionStatus] = await Promise.all([
      syncService.getSyncStatus(user.id),
      transactionSyncService.getConnectionStatus(user.id),
    ]);

    return NextResponse.json({
      data: {
        isConfigured: status.isConfigured,
        totalOrders: status.totalOrders,
        lastSyncedAt: status.lastSyncedAt?.toISOString() || null,
        transactions: {
          count: transactionStatus.transactionCount ?? 0,
          lastSyncAt: transactionStatus.lastSyncAt ?? null,
        },
      },
    });
  } catch (error) {
    console.error('[GET /api/integrations/bricklink/sync] Error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
