import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { amazonTransactionSyncService } from '@/lib/amazon';
import { AmazonInventoryLinkingService } from '@/lib/amazon/amazon-inventory-linking.service';

const SyncSchema = z.object({
  fullSync: z.boolean().optional().default(false),
});

/**
 * POST /api/integrations/amazon/transactions/sync
 * Trigger a sync of Amazon transaction data
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

    const { fullSync } = parsed.data;

    // Perform the sync
    const result = await amazonTransactionSyncService.syncTransactions(user.id, { fullSync });

    // After syncing transactions, backfill fee data for linked inventory items
    let backfillResult = null;
    if (result.success && result.recordsCreated > 0) {
      try {
        const linkingService = new AmazonInventoryLinkingService(supabase, user.id);
        backfillResult = await linkingService.backfillFeeData();
        console.log('[Amazon Transaction Sync] Fee backfill complete:', backfillResult);
      } catch (backfillError) {
        console.error('[Amazon Transaction Sync] Fee backfill error:', backfillError);
      }
    }

    return NextResponse.json({
      success: result.success,
      result,
      backfill: backfillResult,
    });
  } catch (error) {
    console.error('[POST /api/integrations/amazon/transactions/sync] Error:', error);

    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : 'Sync failed',
      },
      { status: 500 }
    );
  }
}

/**
 * GET /api/integrations/amazon/transactions/sync
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
    const status = await amazonTransactionSyncService.getSyncStatus(user.id);

    return NextResponse.json({
      isConnected: status.isConnected,
      isRunning: status.transactions.isRunning,
      lastSync: status.transactions.lastSync,
      config: status.config,
      logs: status.logs,
      transactionCount: status.transactionCount,
    });
  } catch (error) {
    console.error('[GET /api/integrations/amazon/transactions/sync] Error:', error);

    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : 'Failed to fetch sync status',
      },
      { status: 500 }
    );
  }
}
