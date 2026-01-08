import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { amazonTransactionSyncService } from '@/lib/amazon';

const HistoricalImportSchema = z.object({
  fromDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be in YYYY-MM-DD format'),
});

/**
 * POST /api/integrations/amazon/transactions/sync/historical
 * Trigger a historical import of Amazon transaction data
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
    const parsed = HistoricalImportSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Validation failed', details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const { fromDate } = parsed.data;

    // Convert date to ISO string (start of day)
    const fromDateISO = new Date(`${fromDate}T00:00:00.000Z`).toISOString();

    // Perform the historical import
    const result = await amazonTransactionSyncService.performHistoricalImport(
      user.id,
      fromDateISO
    );

    return NextResponse.json({
      success: result.transactions.success,
      result: result.transactions,
    });
  } catch (error) {
    console.error(
      '[POST /api/integrations/amazon/transactions/sync/historical] Error:',
      error
    );

    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : 'Historical import failed',
      },
      { status: 500 }
    );
  }
}
