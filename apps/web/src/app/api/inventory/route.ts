import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { InventoryService } from '@/lib/services';

// Transform empty strings to null for optional fields
const emptyToNull = z.string().transform((val) => (val === '' ? null : val));
const emptyToNullOptional = emptyToNull.nullable().optional();

const CreateInventorySchema = z.object({
  set_number: z.string().min(1, 'Set number is required'),
  item_name: emptyToNullOptional,
  condition: z.enum(['New', 'Used']).nullish(),
  status: z.string().optional(), // status doesn't accept null in the database
  source: emptyToNullOptional,
  purchase_date: emptyToNullOptional,
  cost: z.number().nullish(),
  purchase_id: emptyToNullOptional,
  listing_date: emptyToNullOptional,
  listing_value: z.number().nullish(),
  storage_location: emptyToNullOptional,
  sku: emptyToNullOptional,
  linked_lot: emptyToNullOptional,
  amazon_asin: emptyToNullOptional,
  listing_platform: emptyToNullOptional,
  notes: emptyToNullOptional,
});

const EmptyFilterSchema = z.enum(['empty', 'not_empty']);

const QuerySchema = z.object({
  page: z.coerce.number().positive().optional(),
  pageSize: z.coerce.number().positive().max(100).optional(),
  status: z.string().optional(), // Can be comma-separated for multiple statuses
  condition: z.enum(['New', 'Used']).optional(),
  platform: z.string().optional(), // listing_platform
  salePlatform: z.string().optional(), // sold_platform
  source: z.string().optional(), // purchase source
  linkedLot: z.string().optional(),
  purchaseId: z.string().uuid().optional(),
  search: z.string().optional(),
  excludeLinked: z.coerce.boolean().optional(), // Exclude items already linked to orders
  // Numeric range filters
  costMin: z.coerce.number().optional(),
  costMax: z.coerce.number().optional(),
  listingValueMin: z.coerce.number().optional(),
  listingValueMax: z.coerce.number().optional(),
  soldGrossMin: z.coerce.number().optional(),
  soldGrossMax: z.coerce.number().optional(),
  soldNetMin: z.coerce.number().optional(),
  soldNetMax: z.coerce.number().optional(),
  profitMin: z.coerce.number().optional(),
  profitMax: z.coerce.number().optional(),
  soldFeesMin: z.coerce.number().optional(),
  soldFeesMax: z.coerce.number().optional(),
  soldPostageMin: z.coerce.number().optional(),
  soldPostageMax: z.coerce.number().optional(),
  // Date range filters
  purchaseDateFrom: z.string().optional(),
  purchaseDateTo: z.string().optional(),
  listingDateFrom: z.string().optional(),
  listingDateTo: z.string().optional(),
  soldDateFrom: z.string().optional(),
  soldDateTo: z.string().optional(),
  // Empty/non-empty filters
  storageLocationFilter: EmptyFilterSchema.optional(),
  amazonAsinFilter: EmptyFilterSchema.optional(),
  linkedLotFilter: EmptyFilterSchema.optional(),
  linkedOrderFilter: EmptyFilterSchema.optional(), // sold_order_id
  notesFilter: EmptyFilterSchema.optional(),
  skuFilter: EmptyFilterSchema.optional(),
  ebayListingFilter: EmptyFilterSchema.optional(), // ebay_listing_id
  archiveLocationFilter: EmptyFilterSchema.optional(),
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

    const {
      page, pageSize, status, condition, platform, salePlatform, source, linkedLot, purchaseId, search, excludeLinked,
      // Numeric ranges
      costMin, costMax, listingValueMin, listingValueMax,
      soldGrossMin, soldGrossMax, soldNetMin, soldNetMax, profitMin, profitMax,
      soldFeesMin, soldFeesMax, soldPostageMin, soldPostageMax,
      // Date ranges
      purchaseDateFrom, purchaseDateTo, listingDateFrom, listingDateTo, soldDateFrom, soldDateTo,
      // Empty filters
      storageLocationFilter, amazonAsinFilter, linkedLotFilter: linkedLotEmptyFilter, linkedOrderFilter,
      notesFilter, skuFilter, ebayListingFilter, archiveLocationFilter,
    } = parsed.data;

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
        salePlatform,
        source,
        linkedLot,
        purchaseId,
        searchTerm: search,
        excludeLinkedToOrders: excludeLinked,
        // Advanced filters
        costRange: (costMin !== undefined || costMax !== undefined) ? { min: costMin, max: costMax } : undefined,
        listingValueRange: (listingValueMin !== undefined || listingValueMax !== undefined) ? { min: listingValueMin, max: listingValueMax } : undefined,
        soldGrossRange: (soldGrossMin !== undefined || soldGrossMax !== undefined) ? { min: soldGrossMin, max: soldGrossMax } : undefined,
        soldNetRange: (soldNetMin !== undefined || soldNetMax !== undefined) ? { min: soldNetMin, max: soldNetMax } : undefined,
        profitRange: (profitMin !== undefined || profitMax !== undefined) ? { min: profitMin, max: profitMax } : undefined,
        soldFeesRange: (soldFeesMin !== undefined || soldFeesMax !== undefined) ? { min: soldFeesMin, max: soldFeesMax } : undefined,
        soldPostageRange: (soldPostageMin !== undefined || soldPostageMax !== undefined) ? { min: soldPostageMin, max: soldPostageMax } : undefined,
        purchaseDateRange: (purchaseDateFrom || purchaseDateTo) ? { from: purchaseDateFrom, to: purchaseDateTo } : undefined,
        listingDateRange: (listingDateFrom || listingDateTo) ? { from: listingDateFrom, to: listingDateTo } : undefined,
        soldDateRange: (soldDateFrom || soldDateTo) ? { from: soldDateFrom, to: soldDateTo } : undefined,
        storageLocationFilter,
        amazonAsinFilter,
        linkedLotEmptyFilter,
        linkedOrderFilter,
        notesFilter,
        skuFilter,
        ebayListingFilter,
        archiveLocationFilter,
      },
      { page, pageSize }
    );

    return NextResponse.json(
      { data: result },
      {
        headers: {
          'Cache-Control': 'private, max-age=30',
        },
      }
    );
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
