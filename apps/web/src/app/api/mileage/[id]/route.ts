import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { MileageService } from '@/lib/services';

const ExpenseTypeSchema = z.enum(['mileage', 'parking', 'toll', 'other']);

const UpdateMileageSchema = z.object({
  trackingDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  destinationPostcode: z.string().min(1).optional(),
  milesTravelled: z.number().min(0).optional(),
  amountClaimed: z.number().min(0).optional(),
  reason: z.string().min(1).optional(),
  expenseType: ExpenseTypeSchema.optional(),
  notes: z.string().nullable().optional(),
});

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * GET /api/mileage/[id]
 * Get a single mileage entry by ID
 */
export async function GET(request: NextRequest, { params }: RouteParams) {
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

    const mileageService = new MileageService(supabase);
    const entry = await mileageService.getMileageEntry(id);

    if (!entry) {
      return NextResponse.json({ error: 'Mileage entry not found' }, { status: 404 });
    }

    // Verify ownership
    if (entry.user_id !== user.id) {
      return NextResponse.json({ error: 'Not authorized to view this entry' }, { status: 403 });
    }

    return NextResponse.json({ data: entry });
  } catch (error) {
    console.error('[GET /api/mileage/[id]] Error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

/**
 * PUT /api/mileage/[id]
 * Update a mileage entry
 */
export async function PUT(request: NextRequest, { params }: RouteParams) {
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
    const parsed = UpdateMileageSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Validation failed', details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const mileageService = new MileageService(supabase);

    // Get user's configured mileage rate
    const mileageRate = await mileageService.getUserMileageRate(user.id);

    const entry = await mileageService.updateMileageEntry(id, user.id, parsed.data, mileageRate);

    return NextResponse.json({ data: entry });
  } catch (error) {
    console.error('[PUT /api/mileage/[id]] Error:', error);

    // Handle not found or not authorized errors
    if (error instanceof Error && error.message.includes('No rows')) {
      return NextResponse.json({ error: 'Mileage entry not found or not authorized' }, { status: 404 });
    }

    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

/**
 * DELETE /api/mileage/[id]
 * Delete a mileage entry
 */
export async function DELETE(request: NextRequest, { params }: RouteParams) {
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

    const mileageService = new MileageService(supabase);
    await mileageService.deleteMileageEntry(id, user.id);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[DELETE /api/mileage/[id]] Error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
