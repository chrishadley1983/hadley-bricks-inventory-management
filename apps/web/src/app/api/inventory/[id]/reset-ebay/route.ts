/**
 * Reset eBay Listing API Route
 *
 * POST /api/inventory/[id]/reset-ebay
 *
 * Completely resets an inventory item's eBay listing data:
 * 1. Clears ebay_listing_id and ebay_listing_url from inventory_items
 * 2. Deletes the listing_creation_audit record (quality review data)
 * 3. Sets status back to BACKLOG
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const supabase = await createClient();

    // Auth check
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    console.log('[POST /api/inventory/[id]/reset-ebay] Resetting eBay listing for:', id);

    // Step 1: Delete the listing_creation_audit record for this inventory item
    const { error: auditDeleteError } = await supabase
      .from('listing_creation_audit')
      .delete()
      .eq('inventory_item_id', id)
      .eq('user_id', user.id);

    if (auditDeleteError) {
      console.error('[reset-ebay] Failed to delete audit record:', auditDeleteError);
      // Continue anyway - audit record might not exist
    } else {
      console.log('[reset-ebay] Deleted audit record');
    }

    // Step 2: Update the inventory item
    const { data: updatedItem, error: updateError } = await supabase
      .from('inventory_items')
      .update({
        ebay_listing_id: null,
        ebay_listing_url: null,
        status: 'BACKLOG',
        updated_at: new Date().toISOString(),
      })
      .eq('id', id)
      .eq('user_id', user.id)
      .select()
      .single();

    if (updateError) {
      console.error('[reset-ebay] Failed to update inventory item:', updateError);
      return NextResponse.json(
        { error: 'Failed to reset inventory item' },
        { status: 500 }
      );
    }

    console.log('[reset-ebay] Reset complete for item:', id);

    return NextResponse.json({
      success: true,
      item: updatedItem,
    });
  } catch (error) {
    console.error('[reset-ebay] Error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
