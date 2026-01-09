import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { AmazonInventoryLinkingService } from '@/lib/amazon/amazon-inventory-linking.service';

/**
 * POST /api/amazon/inventory-linking/process-historical
 * Process all historical shipped Amazon orders that haven't been linked to inventory
 * Returns a streaming response with progress updates
 *
 * Body params:
 * - includeSold: boolean - Include already-sold inventory items in matching (for legacy data)
 * - mode: 'auto' | 'picklist' | 'non_picklist' - Processing mode
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

    // Parse request body for options
    let includeSold = false;
    let mode: 'auto' | 'picklist' | 'non_picklist' = 'auto';
    try {
      const body = await request.json();
      includeSold = body.includeSold === true;
      if (body.mode && ['auto', 'picklist', 'non_picklist'].includes(body.mode)) {
        mode = body.mode;
      }
    } catch {
      // No body or invalid JSON - use defaults
    }

    // Create a streaming response
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        const linkingService = new AmazonInventoryLinkingService(supabase, user.id);

        // Progress callback
        const onProgress = (current: number, total: number, autoLinked: number, queued: number) => {
          const progress = { type: 'progress', current, total, autoLinked, queued };
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(progress)}\n\n`));
        };

        try {
          const result = await linkingService.processHistoricalOrders({
            includeSold,
            mode,
            onProgress,
          });

          // Send final result
          const finalResult = { type: 'complete', data: result };
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(finalResult)}\n\n`));
        } catch (error) {
          const errorResult = {
            type: 'error',
            error: error instanceof Error ? error.message : 'Unknown error',
          };
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(errorResult)}\n\n`));
        }

        controller.close();
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
    console.error('[POST /api/amazon/inventory-linking/process-historical] Error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    );
  }
}
