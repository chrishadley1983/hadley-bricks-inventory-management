/**
 * Amazon Order Items Backfill API
 *
 * GET: Get backfill status and count of orders needing backfill
 * POST: Start backfill process
 * DELETE: Stop backfill process
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import {
  AmazonBackfillService,
  type BackfillOptions,
} from '@/lib/services/amazon-backfill.service';

const StartBackfillSchema = z.object({
  batchSize: z.number().min(1).max(200).optional(),
  delayMs: z.number().min(500).max(5000).optional(),
});

/**
 * GET /api/orders/backfill
 *
 * Get backfill status and count of orders needing items
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

    const backfillService = new AmazonBackfillService(supabase);

    // Get current progress
    const progress = backfillService.getProgress(user.id);

    // Get count of orders needing backfill
    const needsBackfill = await backfillService.countOrdersNeedingBackfill(user.id);

    return NextResponse.json({
      data: {
        progress,
        ordersNeedingBackfill: needsBackfill,
      },
    });
  } catch (error) {
    console.error('[GET /api/orders/backfill] Error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    );
  }
}

/**
 * POST /api/orders/backfill
 *
 * Start the backfill process
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
    let options: BackfillOptions = {};
    try {
      const body = await request.json();
      const parsed = StartBackfillSchema.safeParse(body);
      if (parsed.success) {
        options = parsed.data;
      }
    } catch {
      // No body or invalid JSON - use defaults
    }

    const backfillService = new AmazonBackfillService(supabase);

    // Start backfill
    const progress = await backfillService.startBackfill(user.id, options);

    return NextResponse.json({
      data: {
        message: progress.isRunning
          ? `Started backfill for ${progress.total} orders`
          : 'No orders need backfill',
        progress,
      },
    });
  } catch (error) {
    console.error('[POST /api/orders/backfill] Error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/orders/backfill
 *
 * Stop the backfill process
 */
export async function DELETE() {
  try {
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const backfillService = new AmazonBackfillService(supabase);

    // Stop backfill
    backfillService.stopBackfill(user.id);

    // Get final progress
    const progress = backfillService.getProgress(user.id);

    return NextResponse.json({
      data: {
        message: 'Backfill stopped',
        progress,
      },
    });
  } catch (error) {
    console.error('[DELETE /api/orders/backfill] Error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    );
  }
}
