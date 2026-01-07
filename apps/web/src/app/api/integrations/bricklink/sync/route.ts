import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { BrickLinkSyncService } from '@/lib/services';
import { createBrickLinkTransactionSyncService } from '@/lib/bricklink';

const SyncOptionsSchema = z.object({
  includeFiled: z.boolean().optional().default(false),
  fullSync: z.boolean().optional().default(false),
  includeItems: z.boolean().optional().default(true),
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
    let options = { includeFiled: false, fullSync: false, includeItems: true };
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

    // Check if configured
    const isConfigured = await syncService.isConfigured(user.id);
    if (!isConfigured) {
      return NextResponse.json(
        { error: 'BrickLink credentials not configured' },
        { status: 400 }
      );
    }

    // Run both syncs in parallel:
    // 1. Original sync to platform_orders (for order management)
    // 2. New sync to bricklink_transactions (for transaction staging)
    const [orderResult, transactionResult] = await Promise.all([
      syncService.syncOrders(user.id, options),
      transactionSyncService.syncTransactions(user.id, {
        fullSync: options.fullSync,
        includeFiled: options.includeFiled,
      }),
    ]);

    return NextResponse.json({
      success: orderResult.success && transactionResult.success,
      data: {
        // Order sync results (platform_orders)
        ordersProcessed: orderResult.ordersProcessed,
        ordersCreated: orderResult.ordersCreated,
        ordersUpdated: orderResult.ordersUpdated,
        errors: orderResult.errors,
        lastSyncedAt: orderResult.lastSyncedAt.toISOString(),
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
