/**
 * eBay Listing Draft by ID API Routes
 *
 * GET /api/ebay/listing/draft/[id] - Get a specific draft
 * DELETE /api/ebay/listing/draft/[id] - Delete a draft
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

/**
 * GET /api/ebay/listing/draft/[id]
 *
 * Get a specific draft by ID
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;

    // Auth check
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Fetch draft with inventory item info
    const { data: draft, error } = await supabase
      .from('listing_local_drafts')
      .select(
        `
        id,
        inventory_item_id,
        draft_data,
        error_context,
        created_at,
        updated_at,
        inventory_items (
          id,
          set_number,
          item_name,
          condition,
          notes
        )
      `
      )
      .eq('id', id)
      .eq('user_id', user.id)
      .single();

    if (error) {
      if (error.code === 'PGRST116') {
        return NextResponse.json({ error: 'Draft not found' }, { status: 404 });
      }
      console.error('[GET /api/ebay/listing/draft/[id]] Error:', error);
      return NextResponse.json({ error: 'Failed to fetch draft' }, { status: 500 });
    }

    return NextResponse.json({ data: draft }, { status: 200 });
  } catch (error) {
    console.error('[GET /api/ebay/listing/draft/[id]] Error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

/**
 * DELETE /api/ebay/listing/draft/[id]
 *
 * Delete a draft by ID
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    // Auth check
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Delete draft
    const { error } = await supabase
      .from('listing_local_drafts')
      .delete()
      .eq('id', id)
      .eq('user_id', user.id);

    if (error) {
      console.error('[DELETE /api/ebay/listing/draft/[id]] Error:', error);
      return NextResponse.json({ error: 'Failed to delete draft' }, { status: 500 });
    }

    return NextResponse.json({ message: 'Draft deleted' }, { status: 200 });
  } catch (error) {
    console.error('[DELETE /api/ebay/listing/draft/[id]] Error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
