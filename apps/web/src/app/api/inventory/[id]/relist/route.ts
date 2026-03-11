/**
 * Amazon Re-list API Route
 *
 * POST /api/inventory/[id]/relist
 *
 * Returns a sold Amazon item to stock:
 * 1. Resets status to BACKLOG
 * 2. Clears amazon_order_item_id, listing_date, and all sale fields
 * 3. Updates storage_location
 * 4. Appends audit note
 * 5. Preserves listing_platform, listing_value, amazon_asin
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { z } from 'zod';

const relistSchema = z.object({
  storageLocation: z.string().min(1, 'Storage location is required'),
});

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
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

    // Validate request body
    const body = await request.json();
    const parsed = relistSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0].message },
        { status: 400 }
      );
    }

    const { storageLocation } = parsed.data;

    // Fetch current item to validate and get existing notes
    const { data: item, error: fetchError } = await supabase
      .from('inventory_items')
      .select('id, status, amazon_asin, notes')
      .eq('id', id)
      .eq('user_id', user.id)
      .single();

    if (fetchError || !item) {
      return NextResponse.json({ error: 'Inventory item not found' }, { status: 404 });
    }

    if (item.status !== 'SOLD') {
      return NextResponse.json(
        { error: 'Only SOLD items can be returned to stock' },
        { status: 400 }
      );
    }

    if (!item.amazon_asin) {
      return NextResponse.json(
        { error: 'Item has no Amazon ASIN' },
        { status: 400 }
      );
    }

    // Build audit note
    const today = new Date().toISOString().split('T')[0];
    const auditNote = `Returned to stock and re-listed on ${today}`;
    const updatedNotes = item.notes
      ? `${item.notes}\n${auditNote}`
      : auditNote;

    // Update item: reset to BACKLOG, clear sale fields, update storage location
    const { data: updatedItem, error: updateError } = await supabase
      .from('inventory_items')
      .update({
        status: 'BACKLOG',
        amazon_order_item_id: null,
        listing_date: null,
        storage_location: storageLocation,
        notes: updatedNotes,
        sold_date: null,
        sold_price: null,
        sold_platform: null,
        sold_fees_amount: null,
        sold_net_amount: null,
        sold_order_id: null,
        sold_gross_amount: null,
        sold_postage_received: null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', id)
      .eq('user_id', user.id)
      .select()
      .single();

    if (updateError) {
      console.error('[relist] Failed to update inventory item:', updateError);
      return NextResponse.json({ error: 'Failed to reset inventory item' }, { status: 500 });
    }

    console.log('[relist] Item returned to stock:', id);

    return NextResponse.json({
      success: true,
      item: updatedItem,
    });
  } catch (error) {
    console.error('[relist] Error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
