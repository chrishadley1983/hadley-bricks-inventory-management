/**
 * Keepa Pricing Sync API Route with Streaming Progress
 *
 * POST /api/arbitrage/sync/keepa-pricing - Trigger Keepa pricing sync for seeded ASINs missing pricing
 */

import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { KeepaPricingSyncService } from '@/lib/arbitrage/keepa-pricing-sync.service';

// Long timeout for Keepa sync (rate-limited, ~15-20 min for ~1,000 ASINs)
export const maxDuration = 300;

export async function POST() {
  try {
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Create a TransformStream for streaming progress updates
    const encoder = new TextEncoder();
    const stream = new TransformStream();
    const writer = stream.writable.getWriter();

    // Start sync in background
    const syncPromise = (async () => {
      const keepaSyncService = new KeepaPricingSyncService(supabase);

      try {
        // Send initial message
        await writer.write(
          encoder.encode(
            `data: ${JSON.stringify({ type: 'start', message: 'Checking for seeded ASINs missing pricing...' })}\n\n`
          )
        );

        // Run sync with progress callback
        const result = await keepaSyncService.syncMissingPricing(user.id, async (progress) => {
          await writer.write(encoder.encode(`data: ${JSON.stringify(progress)}\n\n`));
        });

        // Send completion message
        await writer.write(
          encoder.encode(
            `data: ${JSON.stringify({
              type: 'complete',
              result,
              message: `Keepa sync complete: ${result.upserted} upserted, ${result.skipped} skipped, ${result.failed} failed out of ${result.total} total`,
            })}\n\n`
          )
        );
      } catch (error) {
        console.error('[POST /api/arbitrage/sync/keepa-pricing] Error:', error);
        await writer.write(
          encoder.encode(
            `data: ${JSON.stringify({
              type: 'error',
              message: error instanceof Error ? error.message : 'Keepa pricing sync failed',
            })}\n\n`
          )
        );
      } finally {
        await writer.close();
      }
    })();

    // Don't await - let it run in background while streaming
    syncPromise.catch(console.error);

    return new Response(stream.readable, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      },
    });
  } catch (error) {
    console.error('[POST /api/arbitrage/sync/keepa-pricing] Error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
