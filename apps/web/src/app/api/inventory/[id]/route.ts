import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { InventoryService } from '@/lib/services';
import { createPerfLogger } from '@/lib/perf';

// Transform empty strings to null for optional fields
const emptyToNull = z.string().transform((val) => (val === '' ? null : val));
const emptyToNullOptional = emptyToNull.nullable().optional();

const UpdateInventorySchema = z.object({
  set_number: z.string().min(1).optional(),
  item_name: z.string().optional(),
  condition: z.enum(['New', 'Used']).optional(),
  status: z.string().optional(),
  source: emptyToNullOptional,
  purchase_date: emptyToNullOptional,
  cost: z.number().nullable().optional(),
  purchase_id: emptyToNullOptional,
  listing_date: emptyToNullOptional,
  listing_value: z.number().nullable().optional(),
  storage_location: emptyToNullOptional,
  sku: emptyToNullOptional,
  linked_lot: emptyToNullOptional,
  amazon_asin: emptyToNullOptional,
  listing_platform: emptyToNullOptional,
  notes: emptyToNullOptional,
});

/**
 * GET /api/inventory/[id]
 * Get a single inventory item
 */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const perf = createPerfLogger('GET /api/inventory/[id]');

  try {
    const { id } = await params;

    const endAuth = perf.start('auth');
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();
    endAuth();

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const service = new InventoryService(supabase, user.id);
    const endQuery = perf.start('query');
    const item = await service.getById(id);
    endQuery();

    if (!item) {
      return NextResponse.json({ error: 'Item not found' }, { status: 404 });
    }

    perf.end();
    return NextResponse.json({ data: item });
  } catch (error) {
    console.error('[GET /api/inventory/[id]] Error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

/**
 * PUT /api/inventory/[id]
 * Update an inventory item (full update)
 */
export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return handleUpdate(request, params);
}

/**
 * PATCH /api/inventory/[id]
 * Update an inventory item (partial update)
 */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return handleUpdate(request, params);
}

async function handleUpdate(request: NextRequest, params: Promise<{ id: string }>) {
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
    console.error('[PUT/PATCH /api/inventory/[id]] Error:', error);
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
