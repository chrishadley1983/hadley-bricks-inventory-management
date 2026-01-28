/**
 * eBay Listing Creation API Route
 *
 * POST /api/ebay/listing - Create an eBay listing with SSE streaming for progress
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { ListingCreationService } from '@/lib/ebay/listing-creation.service';
import type {
  ListingCreationProgress,
  ListingCreationResult,
  ListingCreationError,
  ListingPreviewData,
} from '@/lib/ebay/listing-creation.types';

/**
 * Schema for base64-encoded images (legacy)
 */
const Base64ImageSchema = z.object({
  id: z.string(),
  filename: z.string(),
  base64: z.string(),
  mimeType: z.enum(['image/jpeg', 'image/png', 'image/webp']),
  enhanced: z.boolean(),
});

/**
 * Schema for URL-based images (preferred - pre-uploaded to storage)
 */
const UrlImageSchema = z.object({
  id: z.string(),
  filename: z.string(),
  url: z.string().url(),
  mimeType: z.enum(['image/jpeg', 'image/png', 'image/webp']),
  enhanced: z.boolean(),
});

/**
 * Combined image schema - accepts either base64 or URL
 */
const ImageSchema = z.union([Base64ImageSchema, UrlImageSchema]);

/**
 * Validation schema for listing creation request
 */
const ListingCreationSchema = z.object({
  inventoryItemId: z.string().uuid(),
  price: z.number().positive(),
  bestOffer: z.object({
    enabled: z.boolean(),
    autoAcceptPercent: z.number().min(0).max(100),
    autoDeclinePercent: z.number().min(0).max(100),
  }),
  photos: z.array(ImageSchema).min(1, 'At least one photo is required'),
  enhancePhotos: z.boolean(),
  descriptionStyle: z.enum(['Minimalist', 'Standard', 'Professional', 'Friendly', 'Enthusiastic']),
  templateId: z.string().uuid().optional(),
  listingType: z.enum(['live', 'scheduled']),
  scheduledDate: z.string().optional(), // Validated manually below for scheduled listings
  policyOverrides: z.object({
    fulfillmentPolicyId: z.string().optional(),
    paymentPolicyId: z.string().optional(),
    returnPolicyId: z.string().optional(),
  }).optional(),
  conditionDescriptionOverride: z.string().optional(),
  storageLocation: z.string().optional(), // Storage location to update on inventory item
});

/**
 * POST /api/ebay/listing
 *
 * Create an eBay listing with SSE streaming for progress updates.
 *
 * Two-phase flow with pre-publish quality review:
 *
 * Phase 1 (this endpoint):
 * 1. Validate inventory data
 * 2. Research product details (Brickset API)
 * 3. Retrieve eBay policies
 * 4. Generate listing content (Claude AI)
 * 5. Quality review with auto-improvement loop (Gemini AI)
 * 6. Preview - sends preview event and pauses
 *
 * Phase 2 (via /api/ebay/listing/confirm after user confirms):
 * 7. Process and upload images
 * 8. Create eBay listing
 * 9. Update inventory
 * 10. Record audit trail
 *
 * SSE events:
 * - `progress` - Step updates with percentage
 * - `preview` - Preview data for user confirmation (pauses flow)
 * - `complete` - Success with listing details and quality review
 * - `error` - Failure with error context
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
    console.log('[POST /api/ebay/listing] Request body:', JSON.stringify({
      ...body,
      photos: body.photos?.map((p: { id: string; filename: string; mimeType: string; base64?: string }) => ({
        id: p.id,
        filename: p.filename,
        mimeType: p.mimeType,
        base64Length: p.base64?.length
      }))
    }, null, 2));

    const parsed = ListingCreationSchema.safeParse(body);

    if (!parsed.success) {
      console.error('[POST /api/ebay/listing] Validation errors:', JSON.stringify(parsed.error.flatten(), null, 2));
      return NextResponse.json(
        {
          error: 'Validation failed',
          details: parsed.error.flatten(),
        },
        { status: 400 }
      );
    }

    // 3. Validate scheduled date if scheduling
    if (parsed.data.listingType === 'scheduled') {
      if (!parsed.data.scheduledDate) {
        return NextResponse.json(
          { error: 'scheduledDate is required when listingType is "scheduled"' },
          { status: 400 }
        );
      }

      const scheduledTime = new Date(parsed.data.scheduledDate).getTime();
      const now = Date.now();
      const minScheduleTime = now + 60 * 60 * 1000; // At least 1 hour from now

      if (scheduledTime < minScheduleTime) {
        return NextResponse.json(
          { error: 'Scheduled date must be at least 1 hour in the future' },
          { status: 400 }
        );
      }
    }

    // 4. Create service and stream response
    const service = new ListingCreationService(supabase, user.id);
    const encoder = new TextEncoder();

    const stream = new ReadableStream({
      async start(controller) {
        const sendEvent = (
          type: 'progress' | 'complete' | 'error' | 'preview',
          data: ListingCreationProgress | ListingCreationResult | ListingCreationError | ListingPreviewData | string
        ) => {
          const event = JSON.stringify({ type, data });
          controller.enqueue(encoder.encode(`data: ${event}\n\n`));
        };

        const onProgress = (progress: ListingCreationProgress) => {
          sendEvent('progress', progress);
        };

        const onPreview = (preview: ListingPreviewData) => {
          sendEvent('preview', preview);
        };

        try {
          // Pass onPreview callback to enable two-phase flow
          const result = await service.createListing(parsed.data, onProgress, onPreview);

          // If result is null, we're waiting for preview confirmation
          // The stream will be closed and client will call /api/ebay/listing/confirm
          if (result === null) {
            // Preview sent, session saved - client will continue via confirm endpoint
            console.log('[POST /api/ebay/listing] Preview sent, waiting for confirmation');
          } else if (result.success) {
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
    console.error('[POST /api/ebay/listing] Error:', error);
    const message = error instanceof Error ? error.message : 'Internal server error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
