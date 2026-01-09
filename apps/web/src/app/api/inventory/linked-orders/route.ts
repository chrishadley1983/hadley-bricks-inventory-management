import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';

const RequestSchema = z.object({
  inventoryIds: z.array(z.string().uuid()),
});

/**
 * POST /api/inventory/linked-orders
 * Get linked order IDs for a list of inventory item IDs
 * Returns a map of inventory_id -> platform_order_id
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
    const parsed = RequestSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Validation failed', details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const { inventoryIds } = parsed.data;

    if (inventoryIds.length === 0) {
      return NextResponse.json({ data: {} });
    }

    // Query order_items to find which inventory items are linked to orders
    const { data: linkedItems, error } = await supabase
      .from('order_items')
      .select('inventory_item_id, platform_orders!inner(platform_order_id)')
      .in('inventory_item_id', inventoryIds)
      .not('inventory_item_id', 'is', null);

    if (error) {
      console.error('[POST /api/inventory/linked-orders] Error:', error);
      return NextResponse.json({ error: 'Failed to fetch linked orders' }, { status: 500 });
    }

    // Build a map of inventory_id -> platform_order_id
    const linkedMap: Record<string, string> = {};
    for (const item of linkedItems || []) {
      if (item.inventory_item_id) {
        const platformOrder = item.platform_orders as { platform_order_id: string };
        linkedMap[item.inventory_item_id] = platformOrder.platform_order_id;
      }
    }

    return NextResponse.json({ data: linkedMap });
  } catch (error) {
    console.error('[POST /api/inventory/linked-orders] Error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
