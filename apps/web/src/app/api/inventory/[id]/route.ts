import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { InventoryService } from '@/lib/services';

const UpdateInventorySchema = z.object({
  set_number: z.string().min(1).optional(),
  item_name: z.string().optional(),
  condition: z.enum(['New', 'Used']).optional(),
  status: z.string().optional(),
  source: z.string().optional(),
  purchase_date: z.string().optional(),
  cost: z.number().optional(),
  listing_date: z.string().optional(),
  listing_value: z.number().optional(),
  storage_location: z.string().optional(),
  sku: z.string().optional(),
  linked_lot: z.string().optional(),
  amazon_asin: z.string().optional(),
  listing_platform: z.string().optional(),
  notes: z.string().optional(),
});

/**
 * GET /api/inventory/[id]
 * Get a single inventory item
 */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const service = new InventoryService(supabase, user.id);
    const item = await service.getById(id);

    if (!item) {
      return NextResponse.json({ error: 'Item not found' }, { status: 404 });
    }

    return NextResponse.json({ data: item });
  } catch (error) {
    console.error('[GET /api/inventory/[id]] Error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

/**
 * PUT /api/inventory/[id]
 * Update an inventory item
 */
export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const parsed = UpdateInventorySchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Validation failed', details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const service = new InventoryService(supabase, user.id);

    // Check if item exists first
    const existing = await service.getById(id);
    if (!existing) {
      return NextResponse.json({ error: 'Item not found' }, { status: 404 });
    }

    const result = await service.update(id, parsed.data);
    return NextResponse.json({ data: result });
  } catch (error) {
    console.error('[PUT /api/inventory/[id]] Error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

/**
 * DELETE /api/inventory/[id]
 * Delete an inventory item
 */
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const service = new InventoryService(supabase, user.id);

    // Check if item exists first
    const existing = await service.getById(id);
    if (!existing) {
      return NextResponse.json({ error: 'Item not found' }, { status: 404 });
    }

    await service.delete(id);
    return NextResponse.json({ message: 'Item deleted successfully' });
  } catch (error) {
    console.error('[DELETE /api/inventory/[id]] Error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
