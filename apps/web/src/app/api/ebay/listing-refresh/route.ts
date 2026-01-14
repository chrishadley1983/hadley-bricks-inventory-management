/**
 * /api/ebay/listing-refresh
 *
 * POST - Create a new refresh job
 * GET - Get refresh history
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { EbayListingRefreshService } from '@/lib/ebay/ebay-listing-refresh.service';
import type { EligibleListing } from '@/lib/ebay/listing-refresh.types';

// Validation schema for create request
// Note: itemId and categoryId can come as numbers from the eBay API, so we coerce them to strings
const CreateRefreshJobSchema = z.object({
  listings: z.array(
    z.object({
      itemId: z.union([z.string(), z.number()]).transform(String),
      title: z.string(),
      price: z.number(),
      currency: z.string(),
      quantity: z.number(),
      quantityAvailable: z.number(),
      quantitySold: z.number(),
      condition: z.string().nullable(),
      conditionId: z.number().nullable(),
      watchers: z.number(),
      views: z.number().nullable(),
      listingStartDate: z.string(),
      listingAge: z.number(),
      galleryUrl: z.string().nullable(),
      viewItemUrl: z.string().nullable(),
      sku: z.string().nullable(),
      categoryId: z.union([z.string(), z.number()]).transform(String).nullable(),
      categoryName: z.string().nullable(),
      listingType: z.string(),
      bestOfferEnabled: z.boolean(),
    })
  ).min(1, 'At least one listing is required'),
  reviewMode: z.boolean().default(true),
});

/**
 * POST /api/ebay/listing-refresh
 * Create a new refresh job with selected listings
 */
export async function POST(request: NextRequest) {
  try {
    // Auth check
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Validate input
    const body = await request.json();
    const parsed = CreateRefreshJobSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        {
          error: 'Validation failed',
          details: parsed.error.flatten(),
        },
        { status: 400 }
      );
    }

    // Convert to EligibleListing array
    const eligibleListings: EligibleListing[] = parsed.data.listings.map((l) => ({
      ...l,
      listingStartDate: new Date(l.listingStartDate),
    }));

    // Create refresh job
    const service = new EbayListingRefreshService(supabase, user.id);
    const job = await service.createRefreshJob(eligibleListings, parsed.data.reviewMode);

    return NextResponse.json({ data: job }, { status: 201 });
  } catch (error) {
    console.error('[POST /api/ebay/listing-refresh] Error:', error);
    const message = error instanceof Error ? error.message : 'Internal server error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/**
 * GET /api/ebay/listing-refresh
 * Get refresh history
 */
export async function GET(request: NextRequest) {
  try {
    // Auth check
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Parse limit from query
    const searchParams = request.nextUrl.searchParams;
    const limitParam = searchParams.get('limit');
    const limit = limitParam ? parseInt(limitParam, 10) : 20;

    // Fetch history
    const service = new EbayListingRefreshService(supabase, user.id);
    const history = await service.getRefreshHistory(limit);

    return NextResponse.json({
      data: history,
      count: history.length,
    });
  } catch (error) {
    console.error('[GET /api/ebay/listing-refresh] Error:', error);
    const message = error instanceof Error ? error.message : 'Internal server error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
