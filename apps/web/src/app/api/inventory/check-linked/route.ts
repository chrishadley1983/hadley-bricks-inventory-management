import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';

/**
 * POST /api/inventory/check-linked
 * Check which inventory items from a list are already linked to orders
 * Returns a map of inventory ID to linked order ID (or null if not linked)
 */

const RequestSchema = z.object({
  inventoryIds: z.array(z.string().uuid()).min(1).max(100),
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
    const parsed = RequestSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Validation failed', details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const { inventoryIds } = parsed.data;

    // Check order_items table (BrickLink/Amazon orders)
    const { data: orderItemLinks } = await supabase
      .from('order_items')
      .select('inventory_item_id, platform_orders!inner(platform_order_id)')
      .in('inventory_item_id', inventoryIds)
      .not('inventory_item_id', 'is', null);

    // Check ebay_order_line_items table
    const { data: ebayLinks } = await supabase
      .from('ebay_order_line_items')
      .select('inventory_item_id, ebay_orders!inner(ebay_order_id)')
      .in('inventory_item_id', inventoryIds)
      .not('inventory_item_id', 'is', null);

    // Build result map
    const linkedMap: Record<string, string | null> = {};

    // Initialize all as not linked
    for (const id of inventoryIds) {
      linkedMap[id] = null;
    }

    // Mark order_items links
    if (orderItemLinks) {
      for (const link of orderItemLinks) {
        if (link.inventory_item_id) {
          const platformOrder = link.platform_orders as { platform_order_id: string };
          linkedMap[link.inventory_item_id] = platformOrder.platform_order_id;
        }
      }
    }

    // Mark eBay links (may override, but that's fine - just need to know it's linked)
    if (ebayLinks) {
      for (const link of ebayLinks) {
        if (link.inventory_item_id) {
          const ebayOrder = link.ebay_orders as { ebay_order_id: string };
          linkedMap[link.inventory_item_id] = ebayOrder.ebay_order_id;
        }
      }
    }

    return NextResponse.json({ data: linkedMap });
  } catch (error) {
    console.error('[POST /api/inventory/check-linked] Error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    );
  }
}
