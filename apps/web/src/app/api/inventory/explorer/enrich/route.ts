import { createClient } from '@/lib/supabase/server';
import { EnrichmentService } from '@/lib/inventory-explorer/enrichment.service';

export const runtime = 'nodejs';
export const maxDuration = 300;

export async function POST() {
  try {
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Stream SSE progress
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        const send = (event: string, data: unknown) => {
          controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
        };

        try {
          const service = new EnrichmentService(supabase, user.id);
          const result = await service.enrich({
            onProgress: (progress) => {
              send('progress', progress);
            },
          });
          send('complete', result);
        } catch (error) {
          send('error', {
            error: error instanceof Error ? error.message : String(error),
          });
        } finally {
          controller.close();
        }
      },
    });

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      },
    });
  } catch (error) {
    console.error('[POST /api/inventory/explorer/enrich] Error:', error);
    return new Response(
      JSON.stringify({ error: 'Failed to enrich inventory' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
}
