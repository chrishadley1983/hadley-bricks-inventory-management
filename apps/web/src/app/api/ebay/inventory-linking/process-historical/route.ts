import { NextRequest, NextResponse } from 'next/server';
import { requireUser } from '@/lib/api/require-user';
import { EbayInventoryLinkingService } from '@/lib/ebay/ebay-inventory-linking.service';

/**
 * POST /api/ebay/inventory-linking/process-historical
 * Process all historical fulfilled orders that haven't been linked to inventory
 * Returns a streaming response with progress updates
 *
 * Body params:
 * - includeSold: boolean - Include already-sold inventory items in matching (for legacy data)
 * - includePaid: boolean - Also process PAID orders (not yet fulfilled) for pre-linking
 */
export async function POST(request: NextRequest) {
  try {
    const { user, supabase, unauthorized } = await requireUser();
    if (unauthorized) return unauthorized;

    // Parse request body for options
    let includeSold = false;
    let includePaid = false;
    try {
      const body = await request.json();
      includeSold = body.includeSold === true;
      includePaid = body.includePaid === true;
    } catch {
      // No body or invalid JSON - use defaults
    }

    // Create a streaming response
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        const linkingService = new EbayInventoryLinkingService(supabase, user.id);

        // Progress callback
        const onProgress = (current: number, total: number, autoLinked: number, queued: number) => {
          const progress = { type: 'progress', current, total, autoLinked, queued };
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(progress)}\n\n`));
        };

        try {
          const result = await linkingService.processHistoricalOrders({
            includeSold,
            includePaid,
            onProgress,
          });

          // Send final result
          const finalResult = { type: 'complete', data: result };
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(finalResult)}\n\n`));
        } catch (_error) {
          const errorResult = {
            type: 'error',
            error: 'Internal server error',
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
    console.error('[POST /api/ebay/inventory-linking/process-historical] Error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
