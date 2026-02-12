/**
 * eBay Listing Exclusions API Routes
 *
 * GET /api/arbitrage/ebay-exclusions - Get excluded eBay listings
 * POST /api/arbitrage/ebay-exclusions - Exclude an eBay listing
 * DELETE /api/arbitrage/ebay-exclusions - Restore an excluded listing
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';

// ============================================================================
// SCHEMAS
// ============================================================================

const ExcludeListingSchema = z.object({
  ebayItemId: z.string().min(1),
  setNumber: z.string().min(1),
  title: z.string().optional(),
  reason: z.string().optional(),
});

const RestoreListingSchema = z.object({
  ebayItemId: z.string().min(1),
  setNumber: z.string().min(1),
});

// ============================================================================
// GET - Get excluded eBay listings
// ============================================================================

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

    // Optional filter by set number
    const { searchParams } = new URL(request.url);
    const setNumber = searchParams.get('setNumber');

    let query = supabase
      .from('excluded_ebay_listings')
      .select('*')
      .eq('user_id', user.id)
      .order('excluded_at', { ascending: false });

    if (setNumber) {
      query = query.eq('set_number', setNumber);
    }

    const { data, error } = await query;

    if (error) {
      console.error('[GET /api/arbitrage/ebay-exclusions] Error:', error);
      return NextResponse.json({ error: 'Failed to fetch exclusions' }, { status: 500 });
    }

    return NextResponse.json({ data });
  } catch (error) {
    console.error('[GET /api/arbitrage/ebay-exclusions] Error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// ============================================================================
// POST - Exclude an eBay listing
// ============================================================================

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
    const parsed = ExcludeListingSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid request body', details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const { ebayItemId, setNumber, title, reason } = parsed.data;

    const { data, error } = await supabase
      .from('excluded_ebay_listings')
      .upsert(
        {
          user_id: user.id,
          ebay_item_id: ebayItemId,
          set_number: setNumber,
          title,
          reason,
        },
        {
          onConflict: 'user_id,ebay_item_id,set_number',
        }
      )
      .select()
      .single();

    if (error) {
      console.error('[POST /api/arbitrage/ebay-exclusions] Error:', error);
      return NextResponse.json({ error: 'Failed to exclude listing' }, { status: 500 });
    }

    return NextResponse.json({ data }, { status: 201 });
  } catch (error) {
    console.error('[POST /api/arbitrage/ebay-exclusions] Error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// ============================================================================
// DELETE - Restore an excluded listing
// ============================================================================

export async function DELETE(request: NextRequest) {
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
    const parsed = RestoreListingSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid request body', details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const { ebayItemId, setNumber } = parsed.data;

    const { error } = await supabase
      .from('excluded_ebay_listings')
      .delete()
      .eq('user_id', user.id)
      .eq('ebay_item_id', ebayItemId)
      .eq('set_number', setNumber);

    if (error) {
      console.error('[DELETE /api/arbitrage/ebay-exclusions] Error:', error);
      return NextResponse.json({ error: 'Failed to restore listing' }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[DELETE /api/arbitrage/ebay-exclusions] Error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
