/**
 * Purchase Evaluator Lookup API Route
 *
 * POST - Trigger pricing lookups with streaming progress
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { PurchaseEvaluatorService } from '@/lib/purchase-evaluator/evaluator.service';

const LookupSchema = z.object({
  evaluationId: z.string().uuid(),
});

/**
 * POST /api/purchase-evaluator/lookup
 * Trigger pricing lookups with Server-Sent Events for progress
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

    const body = await request.json();
    const parsed = LookupSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Validation failed', details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const { evaluationId } = parsed.data;

    // Create a streaming response using Server-Sent Events
    const encoder = new TextEncoder();

    const stream = new ReadableStream({
      async start(controller) {
        const sendProgress = (data: unknown) => {
          const message = `data: ${JSON.stringify(data)}\n\n`;
          controller.enqueue(encoder.encode(message));
        };

        try {
          const service = new PurchaseEvaluatorService(supabase);

          await service.runLookups(user.id, evaluationId, (progress) => {
            sendProgress(progress);
          });

          // Signal completion
          sendProgress({ type: 'done' });
        } catch (error) {
          console.error('[POST /api/purchase-evaluator/lookup] Error:', error);
          sendProgress({
            type: 'error',
            error: error instanceof Error ? error.message : 'Unknown error',
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
    console.error('[POST /api/purchase-evaluator/lookup] Error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
