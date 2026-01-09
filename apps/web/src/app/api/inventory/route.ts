import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { InventoryService } from '@/lib/services';

const CreateInventorySchema = z.object({
  set_number: z.string().min(1, 'Set number is required'),
  item_name: z.string().nullish(),
  condition: z.enum(['New', 'Used']).nullish(),
  status: z.string().optional(), // status doesn't accept null in the database
  source: z.string().nullish(),
  purchase_date: z.string().nullish(),
  cost: z.number().nullish(),
  listing_date: z.string().nullish(),
  listing_value: z.number().nullish(),
  storage_location: z.string().nullish(),
  sku: z.string().nullish(),
  linked_lot: z.string().nullish(),
  amazon_asin: z.string().nullish(),
  listing_platform: z.string().nullish(),
  notes: z.string().nullish(),
});

const QuerySchema = z.object({
  page: z.coerce.number().positive().optional(),
  pageSize: z.coerce.number().positive().max(100).optional(),
  status: z.string().optional(), // Can be comma-separated for multiple statuses
  condition: z.enum(['New', 'Used']).optional(),
  platform: z.string().optional(),
  linkedLot: z.string().optional(),
  purchaseId: z.string().uuid().optional(),
  search: z.string().optional(),
  excludeLinked: z.coerce.boolean().optional(), // Exclude items already linked to orders
});

/**
 * GET /api/inventory
 * List inventory items with optional filtering and pagination
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

    const { searchParams } = new URL(request.url);
    const queryParams = Object.fromEntries(searchParams.entries());
    const parsed = QuerySchema.safeParse(queryParams);

    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid query parameters', details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const { page, pageSize, status, condition, platform, linkedLot, purchaseId, search, excludeLinked } = parsed.data;

    // Parse status - can be comma-separated for multiple values
    type InventoryStatus = 'NOT YET RECEIVED' | 'BACKLOG' | 'LISTED' | 'SOLD';
    let statusFilter: InventoryStatus | InventoryStatus[] | undefined;
    if (status) {
      const statuses = status.split(',').map(s => s.trim()) as InventoryStatus[];
      statusFilter = statuses.length === 1 ? statuses[0] : statuses;
    }

    const service = new InventoryService(supabase, user.id);
    const result = await service.getAll(
      {
        status: statusFilter,
        condition,
        platform,
        linkedLot,
        purchaseId,
        searchTerm: search,
        excludeLinkedToOrders: excludeLinked,
      },
      { page, pageSize }
    );

    return NextResponse.json({ data: result });
  } catch (error) {
    console.error('[GET /api/inventory] Error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

/**
 * POST /api/inventory
 * Create a new inventory item
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

    // Handle both single item and array of items
    const isBulk = Array.isArray(body);
    const items = isBulk ? body : [body];

    // Validate all items
    const validatedItems = [];
    for (const item of items) {
      const parsed = CreateInventorySchema.safeParse(item);
      if (!parsed.success) {
        return NextResponse.json(
          { error: 'Validation failed', details: parsed.error.flatten() },
          { status: 400 }
        );
      }
      validatedItems.push(parsed.data);
    }

    const service = new InventoryService(supabase, user.id);

    if (isBulk) {
      const result = await service.createMany(validatedItems);
      return NextResponse.json({ data: result }, { status: 201 });
    } else {
      const result = await service.create(validatedItems[0]);
      return NextResponse.json({ data: result }, { status: 201 });
    }
  } catch (error) {
    console.error('[POST /api/inventory] Error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
