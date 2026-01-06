import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { MileageService } from '@/lib/services';

const ExpenseTypeSchema = z.enum(['mileage', 'parking', 'toll', 'other']);

const CreateMileageSchema = z.object({
  purchaseId: z.string().uuid().optional(),
  trackingDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be YYYY-MM-DD format'),
  destinationPostcode: z.string().min(1, 'Destination postcode is required'),
  milesTravelled: z.number().min(0, 'Miles must be a positive number'),
  amountClaimed: z.number().min(0).optional(),
  reason: z.string().min(1, 'Reason is required'),
  expenseType: ExpenseTypeSchema,
  notes: z.string().optional(),
});

const ListMileageQuerySchema = z.object({
  purchaseId: z.string().uuid().optional(),
  expenseType: ExpenseTypeSchema.optional(),
  dateFrom: z.string().optional(),
  dateTo: z.string().optional(),
  page: z.coerce.number().positive().optional(),
  pageSize: z.coerce.number().positive().max(100).optional(),
});

/**
 * GET /api/mileage
 * List mileage entries for the current user with optional filters
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

    // Parse query parameters
    const searchParams = Object.fromEntries(request.nextUrl.searchParams);
    const parsed = ListMileageQuerySchema.safeParse(searchParams);

    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid query parameters', details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const { purchaseId, expenseType, dateFrom, dateTo, page, pageSize } = parsed.data;

    const mileageService = new MileageService(supabase);

    // If purchaseId is provided, get mileage for that purchase
    if (purchaseId) {
      const summary = await mileageService.getMileageForPurchase(purchaseId);
      return NextResponse.json({ data: summary });
    }

    // Otherwise, get filtered list
    const result = await mileageService.getMileageForPeriod(
      user.id,
      dateFrom ?? '1970-01-01',
      dateTo ?? '2099-12-31',
      page,
      pageSize
    );

    // If expense type filter is provided, filter in memory (or we could add to repo)
    if (expenseType) {
      result.data = result.data.filter((m) => m.expense_type === expenseType);
    }

    return NextResponse.json({ data: result });
  } catch (error) {
    console.error('[GET /api/mileage] Error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

/**
 * POST /api/mileage
 * Create a new mileage entry
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
    const parsed = CreateMileageSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Validation failed', details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const mileageService = new MileageService(supabase);

    // Get user's configured mileage rate
    const mileageRate = await mileageService.getUserMileageRate(user.id);

    const entry = await mileageService.createMileageEntry(user.id, parsed.data, mileageRate);

    return NextResponse.json({ data: entry }, { status: 201 });
  } catch (error) {
    console.error('[POST /api/mileage] Error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
