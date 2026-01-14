/**
 * Listings API Routes
 *
 * GET  /api/listing-assistant/listings - Get all listings
 * POST /api/listing-assistant/listings - Save a new listing
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { getListings, createListing, getListingCounts } from '@/lib/listing-assistant/listings.service';

const CreateListingSchema = z.object({
  inventory_item_id: z.string().uuid().nullable().optional(),
  item_name: z.string().min(1, 'Item name is required'),
  condition: z.enum(['New', 'Used']),
  title: z.string().min(1, 'Title is required').max(255),
  price_range: z.string().nullable().optional(),
  description: z.string().min(1, 'Description is required'),
  template_id: z.string().uuid().nullable().optional(),
  source_urls: z.array(z.string()).nullable().optional(),
  ebay_sold_data: z.array(z.any()).nullable().optional(),
  status: z.enum(['draft', 'ready', 'listed', 'sold']).optional(),
});

/**
 * GET /api/listing-assistant/listings
 */
export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Parse query parameters
    const { searchParams } = new URL(request.url);
    const status = searchParams.get('status') as 'draft' | 'ready' | 'listed' | 'sold' | null;
    const inventoryItemId = searchParams.get('inventoryItemId');
    const limit = searchParams.get('limit') ? parseInt(searchParams.get('limit')!, 10) : undefined;
    const offset = searchParams.get('offset') ? parseInt(searchParams.get('offset')!, 10) : undefined;
    const includeCounts = searchParams.get('includeCounts') === 'true';

    const { listings, total } = await getListings(user.id, {
      status: status || undefined,
      inventoryItemId: inventoryItemId || undefined,
      limit,
      offset,
    });

    const response: {
      data: typeof listings;
      total: number;
      counts?: Record<string, number>;
    } = {
      data: listings,
      total,
    };

    if (includeCounts) {
      response.counts = await getListingCounts(user.id);
    }

    return NextResponse.json(response);
  } catch (error) {
    console.error('[GET /api/listing-assistant/listings] Error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

/**
 * POST /api/listing-assistant/listings
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
    const parsed = CreateListingSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Validation failed', details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const listing = await createListing(user.id, parsed.data);

    return NextResponse.json({ data: listing }, { status: 201 });
  } catch (error) {
    console.error('[POST /api/listing-assistant/listings] Error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
