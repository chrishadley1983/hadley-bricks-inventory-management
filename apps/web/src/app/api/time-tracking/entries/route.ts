import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { z } from 'zod';

const createEntrySchema = z.object({
  category: z.enum(['Development', 'Listing', 'Shipping', 'Sourcing', 'Admin', 'Other']),
  startedAt: z.string().datetime(),
  endedAt: z.string().datetime(),
  notes: z.string().max(1000).optional(),
});

/**
 * GET /api/time-tracking/entries
 * Get paginated time entries with optional filters
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
    const { searchParams } = new URL(request.url);
    const dateFrom = searchParams.get('dateFrom');
    const dateTo = searchParams.get('dateTo');
    const category = searchParams.get('category');
    const page = parseInt(searchParams.get('page') || '1', 10);
    const limit = parseInt(searchParams.get('limit') || '20', 10);

    // Build query
    let query = supabase
      .from('time_entries')
      .select('*', { count: 'exact' })
      .eq('user_id', user.id)
      .not('ended_at', 'is', null) // Only completed entries
      .order('started_at', { ascending: false });

    // Apply filters
    if (dateFrom) {
      query = query.gte('started_at', `${dateFrom}T00:00:00Z`);
    }
    if (dateTo) {
      query = query.lte('started_at', `${dateTo}T23:59:59Z`);
    }
    if (category) {
      query = query.eq('category', category);
    }

    // Apply pagination
    const offset = (page - 1) * limit;
    query = query.range(offset, offset + limit - 1);

    const { data: entries, error, count } = await query;

    if (error) {
      console.error('[GET /api/time-tracking/entries] Error:', error);
      return NextResponse.json({ error: 'Failed to fetch entries' }, { status: 500 });
    }

    // Transform entries to camelCase
    const transformedEntries = (entries || []).map((entry) => ({
      id: entry.id,
      userId: entry.user_id,
      category: entry.category,
      startedAt: entry.started_at,
      endedAt: entry.ended_at,
      durationSeconds: entry.duration_seconds,
      isPaused: entry.is_paused,
      pausedDurationSeconds: entry.paused_duration_seconds,
      taskInstanceId: entry.task_instance_id,
      notes: entry.notes,
      isManualEntry: entry.is_manual_entry,
      createdAt: entry.created_at,
      updatedAt: entry.updated_at,
    }));

    return NextResponse.json({
      entries: transformedEntries,
      total: count || 0,
      page,
      limit,
    });
  } catch (error) {
    console.error('[GET /api/time-tracking/entries] Error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

/**
 * POST /api/time-tracking/entries
 * Create a manual time entry
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
    const parsed = createEntrySchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Validation failed', details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const { category, startedAt, endedAt, notes } = parsed.data;

    // Calculate duration
    const start = new Date(startedAt);
    const end = new Date(endedAt);
    const durationSeconds = Math.floor((end.getTime() - start.getTime()) / 1000);

    if (durationSeconds <= 0) {
      return NextResponse.json({ error: 'End time must be after start time' }, { status: 400 });
    }

    // Create manual entry
    const { data: entry, error } = await supabase
      .from('time_entries')
      .insert({
        user_id: user.id,
        category,
        started_at: startedAt,
        ended_at: endedAt,
        duration_seconds: durationSeconds,
        is_paused: false,
        paused_duration_seconds: 0,
        is_manual_entry: true,
        notes: notes || null,
      })
      .select()
      .single();

    if (error) {
      console.error('[POST /api/time-tracking/entries] Error:', error);
      return NextResponse.json({ error: 'Failed to create entry' }, { status: 500 });
    }

    return NextResponse.json({ entry }, { status: 201 });
  } catch (error) {
    console.error('[POST /api/time-tracking/entries] Error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
