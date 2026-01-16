import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { PurchaseService } from '@/lib/services';

const CreatePurchaseSchema = z.object({
  purchase_date: z.string().min(1, 'Purchase date is required'),
  short_description: z.string().min(1, 'Description is required'),
  cost: z.number().positive('Cost must be positive'),
  source: z.string().nullish(),
  payment_method: z.string().nullish(),
  description: z.string().nullish(),
  reference: z.string().nullish(),
  image_url: z.string().url().nullish().or(z.literal('')),
});

const QuerySchema = z.object({
  page: z.coerce.number().positive().optional(),
  pageSize: z.coerce.number().positive().max(100).optional(),
  source: z.string().optional(),
  paymentMethod: z.string().optional(),
  dateFrom: z.string().optional(),
  dateTo: z.string().optional(),
  search: z.string().optional(),
});

/**
 * GET /api/purchases
 * List purchases with optional filtering and pagination
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

    const { page, pageSize, source, paymentMethod, dateFrom, dateTo, search } = parsed.data;

    const service = new PurchaseService(supabase, user.id);
    const result = await service.getAll(
      {
        source,
        paymentMethod,
        dateFrom,
        dateTo,
        searchTerm: search,
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
    console.error('[GET /api/purchases] Error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

/**
 * POST /api/purchases
 * Create a new purchase
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
    const parsed = CreatePurchaseSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Validation failed', details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const service = new PurchaseService(supabase, user.id);
    const result = await service.create({
      ...parsed.data,
      image_url: parsed.data.image_url || undefined,
    });

    return NextResponse.json({ data: result }, { status: 201 });
  } catch (error) {
    console.error('[POST /api/purchases] Error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
