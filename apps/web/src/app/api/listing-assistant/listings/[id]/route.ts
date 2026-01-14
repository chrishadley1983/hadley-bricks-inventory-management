/**
 * Single Listing API Routes
 *
 * GET    /api/listing-assistant/listings/[id] - Get a listing
 * PATCH  /api/listing-assistant/listings/[id] - Update a listing
 * DELETE /api/listing-assistant/listings/[id] - Delete a listing
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import {
  getListingById,
  updateListing,
  deleteListing,
} from '@/lib/listing-assistant/listings.service';

const UpdateListingSchema = z.object({
  title: z.string().min(1).max(255).optional(),
  price_range: z.string().nullable().optional(),
  description: z.string().min(1).optional(),
  status: z.enum(['draft', 'ready', 'listed', 'sold']).optional(),
});

type RouteParams = {
  params: Promise<{ id: string }>;
};

/**
 * GET /api/listing-assistant/listings/[id]
 */
export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;

    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const listing = await getListingById(user.id, id);

    if (!listing) {
      return NextResponse.json({ error: 'Listing not found' }, { status: 404 });
    }

    return NextResponse.json({ data: listing });
  } catch (error) {
    console.error('[GET /api/listing-assistant/listings/[id]] Error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

/**
 * PATCH /api/listing-assistant/listings/[id]
 */
export async function PATCH(request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;

    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const parsed = UpdateListingSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Validation failed', details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const listing = await updateListing(user.id, id, parsed.data);

    return NextResponse.json({ data: listing });
  } catch (error) {
    console.error('[PATCH /api/listing-assistant/listings/[id]] Error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

/**
 * DELETE /api/listing-assistant/listings/[id]
 */
export async function DELETE(request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;

    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    await deleteListing(user.id, id);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[DELETE /api/listing-assistant/listings/[id]] Error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
