/**
 * POST /api/ebay/listing-refresh/eligible/enrich
 *
 * Enrich eligible listings with views data via GetItem API calls.
 * Uses Server-Sent Events (SSE) for progress updates.
 */

import { NextRequest } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { EbayListingRefreshService } from '@/lib/ebay/ebay-listing-refresh.service';
import type { EligibleListing, ViewsEnrichmentSSEEvent } from '@/lib/ebay/listing-refresh.types';

const eligibleListingSchema = z.object({
  itemId: z.string(),
  title: z.string(),
  price: z.number(),
  currency: z.string(),
  quantity: z.number().int(),
  quantityAvailable: z.number().int(),
  quantitySold: z.number().int(),
  condition: z.string().nullable(),
  conditionId: z.number().nullable(),
  watchers: z.number().int(),
  views: z.number().nullable(),
  listingStartDate: z.string().or(z.date()),
  listingEndDate: z.string().nullable().or(z.date().nullable()),
  listingAge: z.number(),
  galleryUrl: z.string().nullable(),
  viewItemUrl: z.string().nullable(),
  sku: z.string().nullable(),
  categoryId: z.string().nullable(),
  categoryName: z.string().nullable(),
  listingType: z.string(),
  bestOfferEnabled: z.boolean(),
  pendingOfferCount: z.number().int(),
  endsWithin12Hours: z.boolean(),
});

const enrichRequestSchema = z.object({
  listings: z.array(eligibleListingSchema).min(1, 'At least one listing is required'),
});

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  try {
    // Auth check
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

    // Parse and validate request body
    const body = await request.json();
    const parsed = enrichRequestSchema.safeParse(body);
    if (!parsed.success) {
      return new Response(
        JSON.stringify({ error: 'Invalid request', details: parsed.error.flatten().fieldErrors }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Convert date strings back to Date objects
    const parsedListings = parsed.data.listings.map((listing) => ({
      ...listing,
      listingStartDate: new Date(listing.listingStartDate),
    })) as EligibleListing[];

    // Create SSE stream
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        const sendEvent = (event: ViewsEnrichmentSSEEvent) => {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
        };

        try {
          const service = new EbayListingRefreshService(supabase, user.id);

          const enrichedListings = await service.enrichListingsWithViews(
            parsedListings,
            (progress) => {
              sendEvent({
                type: 'progress',
                data: progress,
              });
            }
          );

          // Ensure dates are serialized as ISO strings for JSON transport
          const serializedListings = enrichedListings.map((listing) => ({
            ...listing,
            listingStartDate:
              listing.listingStartDate instanceof Date
                ? listing.listingStartDate.toISOString()
                : listing.listingStartDate,
          })) as unknown as EligibleListing[];

          sendEvent({
            type: 'complete',
            data: { listings: serializedListings },
          });
        } catch (error) {
          console.error('[POST /api/ebay/listing-refresh/eligible/enrich] Error:', error);
          sendEvent({
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
    console.error('[POST /api/ebay/listing-refresh/eligible/enrich] Error:', error);
    const message = error instanceof Error ? error.message : 'Internal server error';
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
