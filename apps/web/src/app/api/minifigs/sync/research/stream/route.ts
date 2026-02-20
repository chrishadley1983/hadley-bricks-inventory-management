/**
 * Research Streaming API Route
 *
 * GET /api/minifigs/sync/research/stream
 *
 * Streams progress updates via Server-Sent Events during market research.
 */

import { NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { ResearchService } from '@/lib/minifig-sync/research.service';
import { formatSSE } from '@/types/minifig-sync-stream';

export const runtime = 'nodejs';
export const maxDuration = 300;

export async function GET(_request: NextRequest): Promise<Response> {
  const encoder = new TextEncoder();
  const stream = new TransformStream();
  const writer = stream.writable.getWriter();

  (async () => {
    try {
      const supabase = await createClient();
      const {
        data: { user },
        error: authError,
      } = await supabase.auth.getUser();

      if (authError || !user) {
        await writer.write(encoder.encode(formatSSE({ type: 'error', error: 'Unauthorized' })));
        await writer.close();
        return;
      }

      const service = new ResearchService(supabase, user.id);
      const result = await service.researchAll(undefined, {
        onProgress: async (event) => {
          await writer.write(encoder.encode(formatSSE(event)));
        },
      });

      await writer.write(
        encoder.encode(
          formatSSE({
            type: 'complete',
            data: {
              jobId: result.jobId,
              itemsProcessed: result.itemsProcessed,
              itemsResearched: result.itemsResearched,
              itemsCached: result.itemsCached,
              itemsErrored: result.itemsErrored,
              errors: result.errors,
            },
          }),
        ),
      );
    } catch (error) {
      console.error('[GET /api/minifigs/sync/research/stream] Error:', error);
      const errorMessage = error instanceof Error ? error.message : 'Internal server error';
      await writer.write(encoder.encode(formatSSE({ type: 'error', error: errorMessage })));
    } finally {
      await writer.close();
    }
  })();

  return new Response(stream.readable, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    },
  });
}
