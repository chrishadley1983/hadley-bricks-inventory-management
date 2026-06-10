/**
 * BrickLink Historical Import API
 *
 * POST /api/integrations/bricklink/sync/historical
 * Triggers a historical import of BrickLink transactions from a specific date
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireUser } from '@/lib/api/require-user';
import { createBrickLinkTransactionSyncService } from '@/lib/bricklink/bricklink-transaction-sync.service';

const HistoricalImportSchema = z.object({
  fromDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be in YYYY-MM-DD format'),
});

export async function POST(request: NextRequest) {
  try {
    const { user, unauthorized } = await requireUser();
    if (unauthorized) return unauthorized;

    // Validate request body
    const body = await request.json();
    const parsed = HistoricalImportSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Validation failed', details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const { fromDate } = parsed.data;

    // Perform historical import
    const syncService = createBrickLinkTransactionSyncService(
      undefined,
      'manual-bricklink-historical'
    );
    const result = await syncService.performHistoricalImport(user.id, fromDate);

    return NextResponse.json(result);
  } catch (error) {
    console.error('[POST /api/integrations/bricklink/sync/historical] Error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
