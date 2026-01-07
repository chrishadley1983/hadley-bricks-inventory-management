import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { paypalTransactionSyncService } from '@/lib/paypal';

const SyncSchema = z.object({
  fullSync: z.boolean().optional().default(false),
});

/**
 * POST /api/integrations/paypal/sync
 * Trigger a sync of PayPal transactions
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

    const result = await paypalTransactionSyncService.syncTransactions(user.id, { fullSync });

    return NextResponse.json({
      success: result.success,
      syncMode: result.syncMode,
      transactionsProcessed: result.transactionsProcessed,
      transactionsCreated: result.transactionsCreated,
      transactionsUpdated: result.transactionsUpdated,
      transactionsSkipped: result.transactionsSkipped,
      lastSyncCursor: result.lastSyncCursor,
      error: result.error,
      startedAt: result.startedAt.toISOString(),
      completedAt: result.completedAt.toISOString(),
    });
  } catch (error) {
    console.error('[POST /api/integrations/paypal/sync] Error:', error);

    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : 'Sync failed',
      },
      { status: 500 }
    );
  }
}

/**
 * GET /api/integrations/paypal/sync
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

    // Get sync status
    const status = await paypalTransactionSyncService.getSyncStatus(user.id);

    // Get recent sync logs
    const { data: syncLogs, error } = await supabase
      .from('paypal_sync_log')
      .select('*')
      .eq('user_id', user.id)
      .order('started_at', { ascending: false })
      .limit(20);

    if (error) {
      console.error('[GET /api/integrations/paypal/sync] Error fetching logs:', error);
      return NextResponse.json({ error: 'Failed to fetch sync logs' }, { status: 500 });
    }

    return NextResponse.json({
      status,
      logs: syncLogs || [],
    });
  } catch (error) {
    console.error('[GET /api/integrations/paypal/sync] Error:', error);

    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : 'Failed to fetch sync status',
      },
      { status: 500 }
    );
  }
}
