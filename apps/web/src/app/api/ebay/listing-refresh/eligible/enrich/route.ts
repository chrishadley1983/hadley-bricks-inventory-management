/**
 * POST /api/ebay/listing-refresh/eligible/enrich
 *
 * Enrich eligible listings with views data via GetItem API calls.
 * Uses Server-Sent Events (SSE) for progress updates.
 */

import { NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { EbayListingRefreshService } from '@/lib/ebay/ebay-listing-refresh.service';
import type { EligibleListing, ViewsEnrichmentSSEEvent } from '@/lib/ebay/listing-refresh.types';

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

    // Parse request body for the listings to enrich
    const body = await request.json();
    const listings = body.listings as EligibleListing[];

    if (!listings || !Array.isArray(listings) || listings.length === 0) {
      return new Response(JSON.stringify({ error: 'No listings provided' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Convert date strings back to Date objects
    const parsedListings = listings.map((listing) => ({
      ...listing,
      listingStartDate: new Date(listing.listingStartDate),
    }));

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
            listingStartDate: listing.listingStartDate instanceof Date
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
