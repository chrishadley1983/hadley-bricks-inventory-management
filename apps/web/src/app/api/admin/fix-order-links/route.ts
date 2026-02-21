/**
 * Admin endpoint to fix order item inventory links
 * POST /api/admin/fix-order-links
 *
 * This is a one-time fix for order items that were matched by the picking list
 * but not persisted to the database (before the persist code was added).
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';

const FixLinksSchema = z.object({
  links: z.array(
    z.object({
      orderItemId: z.string().uuid(),
      inventoryItemId: z.string().uuid(),
    })
  ),
});

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
    const parsed = FixLinksSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Validation failed', details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const results = [];

    for (const link of parsed.data.links) {
      // Verify order item belongs to user
      const { data: orderItem, error: orderItemError } = await supabase
        .from('order_items')
        .select('id, order_id, platform_orders!inner(user_id)')
        .eq('id', link.orderItemId)
        .single();

      if (orderItemError || !orderItem) {
        results.push({
          orderItemId: link.orderItemId,
          success: false,
          error: 'Order item not found',
        });
        continue;
      }

      // Verify inventory item belongs to user
      const { data: inventoryItem, error: inventoryError } = await supabase
        .from('inventory_items')
        .select('id, user_id')
        .eq('id', link.inventoryItemId)
        .eq('user_id', user.id)
        .single();

      if (inventoryError || !inventoryItem) {
        results.push({
          orderItemId: link.orderItemId,
          success: false,
          error: 'Inventory item not found',
        });
        continue;
      }

      // Update the link
      const { error: updateError } = await supabase
        .from('order_items')
        .update({ inventory_item_id: link.inventoryItemId })
        .eq('id', link.orderItemId);

      if (updateError) {
        results.push({ orderItemId: link.orderItemId, success: false, error: updateError.message });
      } else {
        results.push({ orderItemId: link.orderItemId, success: true });
      }
    }

    return NextResponse.json({
      success: results.every((r) => r.success),
      results,
    });
  } catch (error) {
    console.error('[POST /api/admin/fix-order-links] Error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    );
  }
}
