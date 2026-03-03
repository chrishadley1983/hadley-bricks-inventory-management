/**
 * BrickLink Store Scrape Batch API Route with Streaming Progress
 *
 * POST /api/arbitrage/sync/bricklink-stores - Trigger batch store scrape with SSE progress
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { ArbitrageService } from '@/lib/arbitrage';
import { BrickLinkStoreDealService } from '@/lib/arbitrage/bricklink-store-deal.service';
import { BrickLinkSessionExpiredError } from '@/lib/arbitrage/bricklink-store-scraper';

export const maxDuration = 300;

const BatchScrapeSchema = z.object({
  minMarginPercent: z.number().optional().default(25),
  setNumbers: z.array(z.string()).optional(),
});

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
    const parsed = BatchScrapeSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid request body', details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const encoder = new TextEncoder();
    const stream = new TransformStream();
    const writer = stream.writable.getWriter();

    const syncPromise = (async () => {
      const service = new BrickLinkStoreDealService(supabase);
      const arbitrageService = new ArbitrageService(supabase);

      try {
        // Update status to running
        await arbitrageService.updateSyncStatus(user.id, 'bricklink_store_scrape', {
          status: 'running',
        });

        // Determine which sets to scrape
        let setNumbers = parsed.data.setNumbers;
        if (!setNumbers || setNumbers.length === 0) {
          setNumbers = await service.getPromisingSetNumbers(
            user.id,
            parsed.data.minMarginPercent
          );
        }

        await writer.write(
          encoder.encode(
            `data: ${JSON.stringify({
              type: 'start',
              message: `Starting BrickLink store scrape for ${setNumbers.length} sets...`,
              total: setNumbers.length,
            })}\n\n`
          )
        );

        if (setNumbers.length === 0) {
          await arbitrageService.updateSyncStatus(user.id, 'bricklink_store_scrape', {
            status: 'completed',
            itemsProcessed: 0,
            itemsFailed: 0,
          });
          await writer.write(
            encoder.encode(
              `data: ${JSON.stringify({
                type: 'complete',
                message: 'No sets to scrape (no sets above margin threshold)',
                result: { processed: 0, failed: 0, totalListings: 0 },
              })}\n\n`
            )
          );
          return;
        }

        const result = await service.scrapeAndStoreBatch(
          user.id,
          setNumbers,
          async (processed: number, total: number) => {
            await writer.write(
              encoder.encode(
                `data: ${JSON.stringify({
                  type: 'progress',
                  processed,
                  total,
                  percent: total > 0 ? Math.round((processed / total) * 100) : 0,
                })}\n\n`
              )
            );
          }
        );

        // Update sync status to completed
        await arbitrageService.updateSyncStatus(user.id, 'bricklink_store_scrape', {
          status: result.failed > 0 && result.processed === result.failed ? 'failed' : 'completed',
          itemsProcessed: result.processed,
          itemsFailed: result.failed,
        });

        await writer.write(
          encoder.encode(
            `data: ${JSON.stringify({
              type: 'complete',
              result,
              message: `Scrape complete: ${result.processed} sets, ${result.totalListings} listings, ${result.failed} failed`,
            })}\n\n`
          )
        );
      } catch (error) {
        const message =
          error instanceof BrickLinkSessionExpiredError
            ? 'BrickLink session expired. Run `npm run bricklink:login` to refresh.'
            : error instanceof Error
              ? error.message
              : 'Scrape failed';

        console.error('[POST /api/arbitrage/sync/bricklink-stores] Error:', error);

        // Update sync status to failed
        await arbitrageService.updateSyncStatus(user.id, 'bricklink_store_scrape', {
          status: 'failed',
          errorMessage: message,
        }).catch(() => {/* ignore status update errors */});

        await writer.write(
          encoder.encode(`data: ${JSON.stringify({ type: 'error', message })}\n\n`)
        );
      } finally {
        await writer.close();
      }
    })();

    syncPromise.catch(console.error);

    return new Response(stream.readable, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      },
    });
  } catch (error) {
    console.error('[POST /api/arbitrage/sync/bricklink-stores] Error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
