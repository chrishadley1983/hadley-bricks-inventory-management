import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';

const CreateMappingSchema = z.object({
  ebaySku: z.string().min(1),
  inventoryItemId: z.string().uuid(),
});

/**
 * GET /api/ebay/sku-mapping
 * List all SKU mappings for the user
 */
export async function GET(_request: NextRequest) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: mappings, error } = await (supabase as any)
      .from('ebay_sku_mappings')
      .select(
        `
        id,
        ebay_sku,
        inventory_item_id,
        created_at,
        updated_at,
        inventory_item:inventory_items(
          id,
          sku,
          set_number,
          item_name,
          storage_location,
          status
        )
      `
      )
      .eq('user_id', user.id)
      .order('created_at', { ascending: false });

    if (error) {
      console.error('[GET /api/ebay/sku-mapping] Error:', error);
      return NextResponse.json(
        { error: 'Failed to fetch SKU mappings' },
        { status: 500 }
      );
    }

    return NextResponse.json({ data: mappings || [] });
  } catch (error) {
    console.error('[GET /api/ebay/sku-mapping] Error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    );
  }
}

/**
 * POST /api/ebay/sku-mapping
 * Create a new SKU mapping
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
        { error: 'Invalid parameters', details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const { ebaySku, inventoryItemId } = parsed.data;

    // Verify inventory item exists and belongs to user
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: inventoryItem, error: invError } = await (supabase as any)
      .from('inventory_items')
      .select('id')
      .eq('id', inventoryItemId)
      .eq('user_id', user.id)
      .single();

    if (invError || !inventoryItem) {
      return NextResponse.json(
        { error: 'Inventory item not found' },
        { status: 404 }
      );
    }

    // Create mapping (upsert to handle duplicates)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: mapping, error } = await (supabase as any)
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

    if (error) {
      console.error('[POST /api/ebay/sku-mapping] Error:', error);
      return NextResponse.json(
        { error: 'Failed to create SKU mapping' },
        { status: 500 }
      );
    }

    return NextResponse.json({ data: mapping }, { status: 201 });
  } catch (error) {
    console.error('[POST /api/ebay/sku-mapping] Error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    );
  }
}
