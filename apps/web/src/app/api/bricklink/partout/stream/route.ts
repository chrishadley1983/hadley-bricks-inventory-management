/**
 * BrickLink Partout Value Streaming API Route
 *
 * GET /api/bricklink/partout/stream?setNumber=XXX
 *
 * Streams partout value progress updates via Server-Sent Events.
 * Emits progress events as parts are fetched in batches.
 */

import { NextRequest } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { BrickLinkClient } from '@/lib/bricklink';
import type { BrickLinkCredentials } from '@/lib/bricklink';
import { CredentialsRepository } from '@/lib/repositories';
import { PartoutService } from '@/lib/bricklink/partout.service';
import { PartPriceCacheService } from '@/lib/bricklink/part-price-cache.service';
import type { PartoutStreamEvent } from '@/types/partout';

// Increase timeout for large sets (5 minutes)
export const maxDuration = 300;

const QuerySchema = z.object({
  setNumber: z.string().min(1, 'Set number is required'),
  forceRefresh: z.coerce.boolean().optional().default(false),
});

/**
 * Helper to write SSE event
 */
function formatSSE(event: PartoutStreamEvent): string {
  return `data: ${JSON.stringify(event)}\n\n`;
}

export async function GET(request: NextRequest): Promise<Response> {
  // Create stream for SSE
  const encoder = new TextEncoder();
  const stream = new TransformStream();
  const writer = stream.writable.getWriter();

  // Start async processing
  (async () => {
    try {
      // 1. Auth check
      const supabase = await createClient();
      const {
        data: { user },
        error: authError,
      } = await supabase.auth.getUser();

      if (authError || !user) {
        await writer.write(
          encoder.encode(formatSSE({ type: 'error', error: 'Unauthorized' }))
        );
        await writer.close();
        return;
      }

      // 2. Validate input
      const { searchParams } = new URL(request.url);
      const parsed = QuerySchema.safeParse({
        setNumber: searchParams.get('setNumber'),
        forceRefresh: searchParams.get('forceRefresh'),
      });

      if (!parsed.success) {
        await writer.write(
          encoder.encode(formatSSE({ type: 'error', error: 'Invalid set number' }))
        );
        await writer.close();
        return;
      }

      const { setNumber, forceRefresh } = parsed.data;
      console.log(
        `[GET /api/bricklink/partout/stream] Starting stream for set ${setNumber}${forceRefresh ? ' (force refresh)' : ''}`
      );

      // 3. Get BrickLink credentials
      const credentialsRepo = new CredentialsRepository(supabase);
      const credentials = await credentialsRepo.getCredentials<BrickLinkCredentials>(
        user.id,
        'bricklink'
      );

      if (!credentials) {
        await writer.write(
          encoder.encode(
            formatSSE({
              type: 'error',
              error: 'BrickLink not configured. Please configure BrickLink credentials in Settings.',
            })
          )
        );
        await writer.close();
        return;
      }

      // 4. Create services
      const brickLinkClient = new BrickLinkClient(credentials);
      const cacheService = new PartPriceCacheService(supabase);
      const partoutService = new PartoutService(brickLinkClient, cacheService);

      // 5. Emit start event
      await writer.write(
        encoder.encode(
          formatSSE({
            type: 'start',
            message: 'Fetching partout data...',
          })
        )
      );

      // 6. Get partout value with progress callback
      const data = await partoutService.getPartoutValue(setNumber, {
        forceRefresh,
        onProgress: async (fetched: number, total: number, cached: number) => {
          await writer.write(
            encoder.encode(
              formatSSE({
                type: 'progress',
                fetched,
                total,
                cached,
              })
            )
          );
        },
      });

      // 7. Emit complete event with full data
      await writer.write(
        encoder.encode(
          formatSSE({
            type: 'complete',
            data,
            cached: data.cacheStats.fromCache,
          })
        )
      );

      console.log(
        `[GET /api/bricklink/partout/stream] Complete: ${data.totalParts} parts, POV £${data.povNew.toFixed(2)} (new)`
      );
    } catch (error) {
      console.error('[GET /api/bricklink/partout/stream] Error:', error);

      const errorMessage = error instanceof Error ? error.message : 'Internal server error';

      await writer.write(
        encoder.encode(formatSSE({ type: 'error', error: errorMessage }))
      );
    } finally {
      await writer.close();
    }
  })();

  // Return SSE response immediately
  return new Response(stream.readable, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    },
  });
}
