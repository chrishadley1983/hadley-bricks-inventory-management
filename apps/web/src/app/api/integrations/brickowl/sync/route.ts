import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { BrickOwlSyncService } from '@/lib/services';
import { createBrickOwlTransactionSyncService } from '@/lib/brickowl/brickowl-transaction-sync.service';

const SyncOptionsSchema = z.object({
  fullSync: z.boolean().optional().default(false),
  includeItems: z.boolean().optional().default(true),
  limit: z.number().optional(),
  resetBeforeSync: z.boolean().optional().default(false),
  transactionsOnly: z.boolean().optional().default(false),
});

/**
 * POST /api/integrations/brickowl/sync
 * Trigger a sync of Brick Owl orders to both platform_orders AND brickowl_transactions
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
      fullSync: false,
      includeItems: true,
      limit: undefined as number | undefined,
      resetBeforeSync: false,
      transactionsOnly: false,
    };
    try {
      const body = await request.json();
      const parsed = SyncOptionsSchema.safeParse(body);
      if (parsed.success) {
        options = {
          fullSync: parsed.data.fullSync,
          includeItems: parsed.data.includeItems,
          limit: parsed.data.limit,
          resetBeforeSync: parsed.data.resetBeforeSync,
          transactionsOnly: parsed.data.transactionsOnly,
        };
      }
    } catch {
      // Use defaults if no body provided
    }

    const syncService = new BrickOwlSyncService(supabase);
    const transactionSyncService = createBrickOwlTransactionSyncService();

    // Reset before sync if requested (clears bad data from previous syncs)
    if (options.resetBeforeSync) {
      console.log('[POST /api/integrations/brickowl/sync] Resetting transactions before sync...');
      await supabase.from('brickowl_transactions').delete().eq('user_id', user.id);
      await supabase.from('brickowl_sync_config').delete().eq('user_id', user.id);
      await supabase.from('brickowl_sync_log').delete().eq('user_id', user.id);
      // Force full sync after reset
      options.fullSync = true;
    }

    // Check if configured
    const isConfigured = await syncService.isConfigured(user.id);
    if (!isConfigured) {
      return NextResponse.json({ error: 'Brick Owl credentials not configured' }, { status: 400 });
    }

    // Sync transactions (to brickowl_transactions table)
    const transactionResult = await transactionSyncService.syncTransactions(user.id, {
      fullSync: options.fullSync,
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
        errors: orderResult?.errors ?? [],
        lastSyncedAt: orderResult?.lastSyncedAt?.toISOString() ?? new Date().toISOString(),
        // Transaction sync results (brickowl_transactions)
        transactions: {
          processed: transactionResult.ordersProcessed,
          created: transactionResult.ordersCreated,
          updated: transactionResult.ordersUpdated,
          error: transactionResult.error,
        },
      },
    });
  } catch (error) {
    console.error('[POST /api/integrations/brickowl/sync] Error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

/**
 * GET /api/integrations/brickowl/sync
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

    const syncService = new BrickOwlSyncService(supabase);
    const transactionSyncService = createBrickOwlTransactionSyncService();

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
    console.error('[GET /api/integrations/brickowl/sync] Error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
