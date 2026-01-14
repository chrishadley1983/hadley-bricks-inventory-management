/**
 * PATCH /api/ebay/listing-refresh/[id]/items/[itemId]
 *
 * Update an item before refresh (title, price, quantity)
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { EbayListingRefreshService } from '@/lib/ebay/ebay-listing-refresh.service';

const UpdateItemSchema = z.object({
  title: z.string().min(1).max(80).optional(),
  price: z.number().positive().optional(),
  quantity: z.number().int().positive().optional(),
});

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; itemId: string }> }
) {
  try {
    const { id, itemId } = await params;

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
    const parsed = UpdateItemSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        {
          error: 'Validation failed',
          details: parsed.error.flatten(),
        },
        { status: 400 }
      );
    }

    // Verify the item belongs to this refresh job
    const { data: item, error: itemError } = await supabase
      .from('ebay_listing_refresh_items')
      .select('id')
      .eq('id', itemId)
      .eq('refresh_id', id)
      .eq('user_id', user.id)
      .single();

    if (itemError || !item) {
      return NextResponse.json({ error: 'Item not found' }, { status: 404 });
    }

    // Update item
    const service = new EbayListingRefreshService(supabase, user.id);
    await service.updateItemBeforeRefresh(itemId, parsed.data);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[PATCH /api/ebay/listing-refresh/[id]/items/[itemId]] Error:', error);
    const message = error instanceof Error ? error.message : 'Internal server error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
