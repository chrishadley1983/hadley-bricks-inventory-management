import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { z } from 'zod';

const UpdatePickupSchema = z.object({
  title: z.string().min(1).optional(),
  description: z.string().nullable().optional(),
  scheduled_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  scheduled_time: z.string().nullable().optional(),
  address_line1: z.string().min(1).optional(),
  address_line2: z.string().nullable().optional(),
  city: z.string().min(1).optional(),
  postcode: z.string().min(1).optional(),
  estimated_value: z.number().nullable().optional(),
  agreed_price: z.number().nullable().optional(),
  estimated_duration_minutes: z.number().nullable().optional(),
  source_platform: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
  is_recurring: z.boolean().nullable().optional(),
  recurrence_pattern: z.string().nullable().optional(),
  reminder_day_before: z.boolean().nullable().optional(),
});

/**
 * GET /api/pickups/[id]
 * Get a single pickup by ID
 */
export async function GET(
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

    const { data: pickup, error } = await supabase
      .from('stock_pickups')
      .select('*')
      .eq('id', id)
      .eq('user_id', user.id)
      .single();

    if (error) {
      console.error('[GET /api/pickups/[id]] Error:', error);
      return NextResponse.json({ error: 'Pickup not found' }, { status: 404 });
    }

    return NextResponse.json({ pickup });
  } catch (error) {
    console.error('[GET /api/pickups/[id]] Error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

/**
 * PATCH /api/pickups/[id]
 * Update a pickup
 */
export async function PATCH(
  request: NextRequest,
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

    const body = await request.json();
    const parsed = UpdatePickupSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Validation failed', details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    // Verify pickup exists and belongs to user
    const { data: existing } = await supabase
      .from('stock_pickups')
      .select('id')
      .eq('id', id)
      .eq('user_id', user.id)
      .single();

    if (!existing) {
      return NextResponse.json({ error: 'Pickup not found' }, { status: 404 });
    }

    const { data: pickup, error } = await supabase
      .from('stock_pickups')
      .update({
        ...parsed.data,
        updated_at: new Date().toISOString(),
      })
      .eq('id', id)
      .select()
      .single();

    if (error) {
      console.error('[PATCH /api/pickups/[id]] Error:', error);
      return NextResponse.json({ error: 'Failed to update pickup' }, { status: 500 });
    }

    return NextResponse.json({ pickup });
  } catch (error) {
    console.error('[PATCH /api/pickups/[id]] Error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

/**
 * DELETE /api/pickups/[id]
 * Delete a pickup
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

    // Verify pickup exists and belongs to user
    const { data: existing } = await supabase
      .from('stock_pickups')
      .select('id')
      .eq('id', id)
      .eq('user_id', user.id)
      .single();

    if (!existing) {
      return NextResponse.json({ error: 'Pickup not found' }, { status: 404 });
    }

    const { error } = await supabase.from('stock_pickups').delete().eq('id', id);

    if (error) {
      console.error('[DELETE /api/pickups/[id]] Error:', error);
      return NextResponse.json({ error: 'Failed to delete pickup' }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[DELETE /api/pickups/[id]] Error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
