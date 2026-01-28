/**
 * eBay Listing Confirmation API Route
 *
 * POST /api/ebay/listing/confirm - Continue listing creation after preview confirmation
 *
 * This endpoint is called after the user reviews and confirms the listing preview.
 * It resumes the listing creation process from step 7 (images) through step 10 (audit).
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { ListingCreationService } from '@/lib/ebay/listing-creation.service';
import type {
  ListingCreationProgress,
  ListingCreationResult,
  ListingCreationError,
  AIGeneratedListing,
} from '@/lib/ebay/listing-creation.types';

/**
 * Schema for edited listing from preview
 * Uses passthrough() and transform() to allow proper typing as AIGeneratedListing
 */
const EditedListingSchema = z.object({
  title: z.string().max(80),
  subtitle: z.string().nullable(),
  description: z.string(),
  conditionId: z.number(),
  conditionDescription: z.string().nullable(),
  itemSpecifics: z.record(z.string(), z.string().optional()).transform((val) => val as Record<string, string | undefined>),
  categoryId: z.string(),
  sku: z.string(),
  price: z.number(),
  confidence: z.number(),
  recommendations: z.array(z.string()),
});

/**
 * Validation schema for confirmation request
 */
const ConfirmationSchema = z.object({
  sessionId: z.string().uuid(),
  editedListing: EditedListingSchema.optional(),
  confirmed: z.boolean(),
});

/**
 * POST /api/ebay/listing/confirm
 *
 * Continue listing creation after preview confirmation.
 *
 * Request body:
 * - sessionId: UUID of the preview session
 * - editedListing: The listing with any user edits (optional if cancelled)
 * - confirmed: true to proceed, false to cancel
 *
 * Response: SSE stream with progress, complete, or error events
 */
export async function POST(request: NextRequest) {
  try {
    // 1. Auth check
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // 2. Parse and validate request body
    const body = await request.json();
    const parsed = ConfirmationSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        {
          error: 'Validation failed',
          details: parsed.error.flatten(),
        },
        { status: 400 }
      );
    }

    const { sessionId, editedListing, confirmed } = parsed.data;

    // 3. Handle cancellation
    if (!confirmed) {
      const service = new ListingCreationService(supabase, user.id);
      await service.markSessionCancelled(sessionId);
      return NextResponse.json({ success: true, cancelled: true });
    }

    // 4. Confirmed - need edited listing
    if (!editedListing) {
      return NextResponse.json(
        { error: 'editedListing is required when confirmed is true' },
        { status: 400 }
      );
    }

    // 5. Continue listing creation with SSE stream
    const service = new ListingCreationService(supabase, user.id);
    const encoder = new TextEncoder();

    const stream = new ReadableStream({
      async start(controller) {
        const sendEvent = (
          type: 'progress' | 'complete' | 'error',
          data: ListingCreationProgress | ListingCreationResult | ListingCreationError | string
        ) => {
          const event = JSON.stringify({ type, data });
          controller.enqueue(encoder.encode(`data: ${event}\n\n`));
        };

        const onProgress = (progress: ListingCreationProgress) => {
          sendEvent('progress', progress);
        };

        try {
          // Convert the Zod-parsed editedListing to AIGeneratedListing
          // The itemSpecifics will have the required fields from the preview data
          const aiListing: AIGeneratedListing = {
            ...editedListing,
            itemSpecifics: editedListing.itemSpecifics as AIGeneratedListing['itemSpecifics'],
          };

          const result = await service.continueFromPreview(
            sessionId,
            aiListing,
            onProgress
          );

          if (result.success) {
            sendEvent('complete', result);
          } else {
            sendEvent('error', result);
          }
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Unknown error';
          sendEvent('error', message);
        }

        controller.close();
      },
    });

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
      },
    });
  } catch (error) {
    console.error('[POST /api/ebay/listing/confirm] Error:', error);
    const message = error instanceof Error ? error.message : 'Internal server error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
