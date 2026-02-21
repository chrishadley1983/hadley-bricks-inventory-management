import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';

const CreateMappingSchema = z.object({
  ebaySku: z.string().min(1),
  inventoryItemId: z.string().uuid(),
});

/**
 * POST /api/ebay/sku-mappings
 * Create a manual SKU mapping from eBay SKU to inventory item
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
    const parsed = CreateMappingSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Validation failed', details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const { ebaySku, inventoryItemId } = parsed.data;

    // Verify the inventory item exists and belongs to the user
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: inventoryItem, error: invError } = await (supabase as any)
      .from('inventory_items')
      .select('id, set_number, item_name')
      .eq('id', inventoryItemId)
      .eq('user_id', user.id)
      .single();

    if (invError || !inventoryItem) {
      return NextResponse.json({ error: 'Inventory item not found' }, { status: 404 });
    }

    // Create or update the mapping (upsert)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: mapping, error: mappingError } = await (supabase as any)
      .from('ebay_sku_mappings')
      .upsert(
        {
          user_id: user.id,
          ebay_sku: ebaySku,
          inventory_item_id: inventoryItemId,
          updated_at: new Date().toISOString(),
        },
        {
          onConflict: 'user_id,ebay_sku',
        }
      )
      .select()
      .single();

    if (mappingError) {
      console.error('[POST /api/ebay/sku-mappings] Error:', mappingError);
      return NextResponse.json({ error: 'Failed to create mapping' }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      data: {
        mapping,
        inventoryItem: {
          id: inventoryItem.id,
          setNumber: inventoryItem.set_number,
          itemName: inventoryItem.item_name,
        },
      },
    });
  } catch (error) {
    console.error('[POST /api/ebay/sku-mappings] Error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    );
  }
}

/**
 * GET /api/ebay/sku-mappings
 * Get all SKU mappings for the user
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

    const sku = request.nextUrl.searchParams.get('sku');

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let query = (supabase as any)
      .from('ebay_sku_mappings')
      .select(
        `
        *,
        inventory_item:inventory_items(
          id,
          set_number,
          item_name,
          condition,
          status,
          storage_location
        )
      `
      )
      .eq('user_id', user.id);

    if (sku) {
      query = query.eq('ebay_sku', sku);
    }

    const { data: mappings, error } = await query;

    if (error) {
      console.error('[GET /api/ebay/sku-mappings] Error:', error);
      return NextResponse.json({ error: 'Failed to fetch mappings' }, { status: 500 });
    }

    return NextResponse.json({ data: mappings });
  } catch (error) {
    console.error('[GET /api/ebay/sku-mappings] Error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    );
  }
}
