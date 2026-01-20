import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { z } from 'zod';

const startSchema = z.object({
  category: z.enum(['Development', 'Listing', 'Shipping', 'Sourcing', 'Admin', 'Other']),
});

/**
 * POST /api/time-tracking/start
 * Start tracking time with a category
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

    // Parse and validate request body
    const body = await request.json();
    const parsed = startSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Validation failed', details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const { category } = parsed.data;

    // Check if there's already an active entry
    const { data: existingEntry } = await supabase
      .from('time_entries')
      .select('id')
      .eq('user_id', user.id)
      .is('ended_at', null)
      .single();

    if (existingEntry) {
      return NextResponse.json(
        { error: 'Already tracking time. Stop the current entry first.' },
        { status: 400 }
      );
    }

    // Create new time entry
    const { data: entry, error } = await supabase
      .from('time_entries')
      .insert({
        user_id: user.id,
        category,
        started_at: new Date().toISOString(),
        is_paused: false,
        paused_duration_seconds: 0,
        is_manual_entry: false,
      })
      .select()
      .single();

    if (error) {
      console.error('[POST /api/time-tracking/start] Error:', error);
      return NextResponse.json({ error: 'Failed to start time tracking' }, { status: 500 });
    }

    return NextResponse.json({ entry }, { status: 201 });
  } catch (error) {
    console.error('[POST /api/time-tracking/start] Error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
