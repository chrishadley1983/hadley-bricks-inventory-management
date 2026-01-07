import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { paypalTransactionSyncService } from '@/lib/paypal';

const HistoricalSyncSchema = z.object({
  fromDate: z.string().refine(
    (date) => !isNaN(Date.parse(date)),
    { message: 'Invalid date format. Use ISO 8601 format (e.g., 2024-01-01)' }
  ),
});

/**
 * POST /api/integrations/paypal/sync/historical
 * Trigger a historical import of PayPal transactions
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
    const parsed = HistoricalSyncSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Validation failed', details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const { fromDate } = parsed.data;

    // Validate date is not in the future
    const fromDateObj = new Date(fromDate);
    if (fromDateObj > new Date()) {
      return NextResponse.json(
        { error: 'From date cannot be in the future' },
        { status: 400 }
      );
    }

    // PayPal typically allows up to 3 years of history
    const threeYearsAgo = new Date();
    threeYearsAgo.setFullYear(threeYearsAgo.getFullYear() - 3);
    if (fromDateObj < threeYearsAgo) {
      return NextResponse.json(
        { error: 'From date cannot be more than 3 years ago (PayPal API limitation)' },
        { status: 400 }
      );
    }

    const result = await paypalTransactionSyncService.performHistoricalImport(user.id, fromDate);

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
    console.error('[POST /api/integrations/paypal/sync/historical] Error:', error);

    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : 'Historical import failed',
      },
      { status: 500 }
    );
  }
}
