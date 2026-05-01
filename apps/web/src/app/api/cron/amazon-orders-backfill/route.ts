import { NextRequest, NextResponse } from 'next/server';
import { createServiceRoleClient } from '@/lib/supabase/server';
import { AmazonBackfillService } from '@/lib/services/amazon-backfill.service';
import { DEFAULT_USER_ID } from '@/lib/minifig-sync/types';

export const runtime = 'nodejs';
export const maxDuration = 300;

/**
 * AmazonBackfillService.startBackfill is fire-and-forget — it kicks off
 * processBackfillBatch in the background and returns immediately. On Vercel
 * the function instance terminates as soon as we return, so the background
 * loop never finishes. To make this useful from a cron, we poll the in-memory
 * progressMap (kept by getProgress) until isRunning flips to false, capped
 * well below the function's maxDuration.
 */
const POLL_INTERVAL_MS = 2000;
const POLL_DEADLINE_MS = 270_000; // 4.5 min — leaves buffer under maxDuration=300s

async function handler(request: NextRequest) {
  try {
    const authHeader = request.headers.get('authorization');
    const cronSecret = process.env.CRON_SECRET;
    if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const supabase = createServiceRoleClient();
    const service = new AmazonBackfillService(supabase);

    const initial = await service.startBackfill(DEFAULT_USER_ID, { batchSize: 50 });

    if (initial.total === 0) {
      return NextResponse.json({
        data: { ...initial, message: 'No orders need backfill' },
      });
    }

    const deadline = Date.now() + POLL_DEADLINE_MS;
    while (Date.now() < deadline) {
      const p = service.getProgress(DEFAULT_USER_ID);
      if (!p || !p.isRunning) break;
      await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
    }

    const finalProgress = service.getProgress(DEFAULT_USER_ID) ?? initial;
    const timedOut = finalProgress.isRunning;

    return NextResponse.json({
      data: {
        ...finalProgress,
        timedOut,
        message: timedOut
          ? `Hit ${POLL_DEADLINE_MS / 1000}s poll deadline with ${finalProgress.processed}/${finalProgress.total} processed; remaining will pick up next run`
          : `Completed ${finalProgress.processed}/${finalProgress.total}`,
      },
    });
  } catch (error) {
    console.error('[/api/cron/amazon-orders-backfill] Error:', error);
    return NextResponse.json(
      {
        error: 'Failed to backfill Amazon order items',
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}

export async function GET(request: NextRequest) {
  return handler(request);
}

export async function POST(request: NextRequest) {
  return handler(request);
}
