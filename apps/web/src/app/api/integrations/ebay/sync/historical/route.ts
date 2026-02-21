import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { ebayAutoSyncService } from '@/lib/ebay';

const HistoricalImportSchema = z.object({
  fromDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be in YYYY-MM-DD format'),
});

/**
 * POST /api/integrations/ebay/sync/historical
 * Trigger a historical import of eBay data
 * This fetches all transactions, payouts, and orders from the specified date
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

    const body = await request.json();
    const parsed = HistoricalImportSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Validation failed', details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const { fromDate } = parsed.data;

    // Check if historical import is already running
    const status = await ebayAutoSyncService.getSyncStatusSummary(user.id);
    if (status.isRunning) {
      return NextResponse.json(
        { error: 'A sync is already running. Please wait for it to complete.' },
        { status: 409 }
      );
    }

    // Start historical import
    // Convert date to ISO string with time
    const fromDateTime = `${fromDate}T00:00:00.000Z`;

    console.log(`[Historical Import] Starting import from ${fromDateTime} for user ${user.id}`);

    const result = await ebayAutoSyncService.performHistoricalImport(user.id, fromDateTime);

    const allSuccess =
      result.orders.success && result.transactions.success && result.payouts.success;

    return NextResponse.json({
      success: allSuccess,
      results: {
        orders: {
          success: result.orders.success,
          ordersProcessed: result.orders.ordersProcessed,
          ordersCreated: result.orders.ordersCreated,
          ordersUpdated: result.orders.ordersUpdated,
          lineItemsCreated: result.orders.lineItemsCreated,
          transactionsEnriched: result.orders.transactionsEnriched,
          error: result.orders.error,
        },
        transactions: {
          success: result.transactions.success,
          recordsProcessed: result.transactions.recordsProcessed,
          recordsCreated: result.transactions.recordsCreated,
          recordsUpdated: result.transactions.recordsUpdated,
          error: result.transactions.error,
        },
        payouts: {
          success: result.payouts.success,
          recordsProcessed: result.payouts.recordsProcessed,
          recordsCreated: result.payouts.recordsCreated,
          recordsUpdated: result.payouts.recordsUpdated,
          error: result.payouts.error,
        },
      },
      totalDuration: result.totalDuration,
      durationFormatted: formatDuration(result.totalDuration),
    });
  } catch (error) {
    console.error('[POST /api/integrations/ebay/sync/historical] Error:', error);

    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : 'Historical import failed',
      },
      { status: 500 }
    );
  }
}

/**
 * Format duration in milliseconds to human readable string
 */
function formatDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);

  if (hours > 0) {
    return `${hours}h ${minutes % 60}m ${seconds % 60}s`;
  }
  if (minutes > 0) {
    return `${minutes}m ${seconds % 60}s`;
  }
  return `${seconds}s`;
}
