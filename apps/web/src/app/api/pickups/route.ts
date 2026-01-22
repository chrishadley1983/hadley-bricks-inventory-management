import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { z } from 'zod';

const CreatePickupSchema = z.object({
  title: z.string().min(1, 'Title is required'),
  description: z.string().nullable().optional(),
  scheduled_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Invalid date format'),
  scheduled_time: z.string().nullable().optional(),
  scheduled_end_time: z.string().nullable().optional(),
  address_line1: z.string().min(1, 'Address is required'),
  address_line2: z.string().nullable().optional(),
  city: z.string().min(1, 'City is required'),
  postcode: z.string().min(1, 'Postcode is required'),
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
 * GET /api/pickups
 * Get pickups for a specific month
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

    const searchParams = request.nextUrl.searchParams;
    const year = parseInt(searchParams.get('year') || new Date().getFullYear().toString(), 10);
    const month = parseInt(searchParams.get('month') || (new Date().getMonth() + 1).toString(), 10);

    // Get first and last day of month
    const startDate = `${year}-${month.toString().padStart(2, '0')}-01`;
    const lastDay = new Date(year, month, 0).getDate();
    const endDate = `${year}-${month.toString().padStart(2, '0')}-${lastDay}`;

    const { data: pickups, error } = await supabase
      .from('stock_pickups')
      .select('*')
      .eq('user_id', user.id)
      .gte('scheduled_date', startDate)
      .lte('scheduled_date', endDate)
      .order('scheduled_date', { ascending: true })
      .order('scheduled_time', { ascending: true });

    if (error) {
      console.error('[GET /api/pickups] Error:', error);
      return NextResponse.json({ error: 'Failed to fetch pickups' }, { status: 500 });
    }

    return NextResponse.json({ pickups: pickups || [] });
  } catch (error) {
    console.error('[GET /api/pickups] Error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

/**
 * POST /api/pickups
 * Create a new pickup
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
    const parsed = CreatePickupSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Validation failed', details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const { data: pickup, error } = await supabase
      .from('stock_pickups')
      .insert({
        ...parsed.data,
        user_id: user.id,
        status: 'scheduled',
      })
      .select()
      .single();

    if (error) {
      console.error('[POST /api/pickups] Error:', error);
      return NextResponse.json({ error: 'Failed to create pickup' }, { status: 500 });
    }

    return NextResponse.json({ pickup }, { status: 201 });
  } catch (error) {
    console.error('[POST /api/pickups] Error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
