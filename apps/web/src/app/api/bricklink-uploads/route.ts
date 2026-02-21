import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { BrickLinkUploadService } from '@/lib/services/bricklink-upload.service';

const CreateUploadSchema = z.object({
  upload_date: z.string().min(1, 'Upload date is required'),
  total_quantity: z.number().int().nonnegative('Quantity must be non-negative'),
  selling_price: z.number().nonnegative('Selling price must be non-negative'),
  cost: z.number().nonnegative().optional().nullable(),
  source: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
  purchase_id: z.string().uuid().optional().nullable(),
  linked_lot: z.string().optional().nullable(),
  lots: z.number().int().nonnegative().optional().nullable(),
  condition: z.enum(['N', 'U']).optional().nullable(),
  reference: z.string().optional().nullable(),
});

const QuerySchema = z.object({
  page: z.coerce.number().positive().optional(),
  pageSize: z.coerce.number().positive().max(100).optional(),
  dateFrom: z.string().optional(),
  dateTo: z.string().optional(),
  source: z.string().optional(),
  search: z.string().optional(),
  syncedFromBricqer: z
    .string()
    .transform((val) => val === 'true')
    .optional(),
  purchaseId: z.string().uuid().optional(),
  unlinked: z
    .string()
    .transform((val) => val === 'true')
    .optional(),
});

/**
 * GET /api/bricklink-uploads
 * List uploads with optional filtering and pagination
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
      page,
      pageSize,
      dateFrom,
      dateTo,
      source,
      search,
      syncedFromBricqer,
      purchaseId,
      unlinked,
    } = parsed.data;

    const service = new BrickLinkUploadService(supabase, user.id);
    const result = await service.getAll(
      {
        dateFrom,
        dateTo,
        source,
        searchTerm: search,
        syncedFromBricqer,
        purchaseId,
        unlinked,
      },
      { page, pageSize }
    );

    return NextResponse.json({ data: result });
  } catch (error) {
    console.error('[GET /api/bricklink-uploads] Error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

/**
 * POST /api/bricklink-uploads
 * Create a new upload
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
    const parsed = CreateUploadSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Validation failed', details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const service = new BrickLinkUploadService(supabase, user.id);
    const result = await service.create(parsed.data);

    return NextResponse.json({ data: result }, { status: 201 });
  } catch (error) {
    console.error('[POST /api/bricklink-uploads] Error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
