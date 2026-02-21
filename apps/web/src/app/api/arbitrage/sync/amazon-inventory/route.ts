/**
 * Amazon Inventory Sync API Route with Streaming Progress
 *
 * POST /api/arbitrage/sync/amazon-inventory - Trigger Amazon inventory sync with progress streaming
 */

import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { ArbitrageService, AmazonArbitrageSyncService } from '@/lib/arbitrage';

// Increase timeout for sync operations
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
      const arbitrageService = new ArbitrageService(supabase);
      const amazonSyncService = new AmazonArbitrageSyncService(supabase);

      try {
        // Update status to running
        await arbitrageService.updateSyncStatus(user.id, 'inventory_asins', { status: 'running' });

        // Send initial message
        await writer.write(
          encoder.encode(
            `data: ${JSON.stringify({ type: 'start', message: 'Starting Amazon inventory sync...' })}\n\n`
          )
        );

        // Run sync with progress callback
        const result = await amazonSyncService.syncInventoryAsins(
          user.id,
          async (processed: number, total: number) => {
            const progress = {
              type: 'progress',
              processed,
              total,
              percent: total > 0 ? Math.round((processed / total) * 100) : 0,
            };
            await writer.write(encoder.encode(`data: ${JSON.stringify(progress)}\n\n`));
          }
        );

        // Send completion message
        await writer.write(
          encoder.encode(
            `data: ${JSON.stringify({
              type: 'complete',
              result,
              message: `Sync complete: ${result.added} added, ${result.updated} updated`,
            })}\n\n`
          )
        );
      } catch (error) {
        console.error('[POST /api/arbitrage/sync/amazon-inventory] Error:', error);
        await writer.write(
          encoder.encode(
            `data: ${JSON.stringify({
              type: 'error',
              message: error instanceof Error ? error.message : 'Sync failed',
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
    console.error('[POST /api/arbitrage/sync/amazon-inventory] Error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
