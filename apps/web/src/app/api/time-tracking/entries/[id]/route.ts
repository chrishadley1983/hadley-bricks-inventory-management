import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { z } from 'zod';

const updateEntrySchema = z.object({
  category: z.enum(['Development', 'Listing', 'Shipping', 'Sourcing', 'Admin', 'Other']).optional(),
  startedAt: z.string().datetime().optional(),
  endedAt: z.string().datetime().optional(),
  notes: z.string().max(1000).optional().nullable(),
});

/**
 * PATCH /api/time-tracking/entries/[id]
 * Update an existing time entry
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

    // Parse and validate request body
    const body = await request.json();
    const parsed = updateEntrySchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Validation failed', details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    // Check if entry exists and belongs to user
    const { data: existingEntry, error: findError } = await supabase
      .from('time_entries')
      .select('*')
      .eq('id', id)
      .eq('user_id', user.id)
      .single();

    if (findError || !existingEntry) {
      return NextResponse.json({ error: 'Entry not found' }, { status: 404 });
    }

    // Build update object
    const updates: Record<string, unknown> = {
      updated_at: new Date().toISOString(),
    };

    if (parsed.data.category !== undefined) {
      updates.category = parsed.data.category;
    }
    if (parsed.data.startedAt !== undefined) {
      updates.started_at = parsed.data.startedAt;
    }
    if (parsed.data.endedAt !== undefined) {
      updates.ended_at = parsed.data.endedAt;
    }
    if (parsed.data.notes !== undefined) {
      updates.notes = parsed.data.notes;
    }

    // Recalculate duration if times changed
    const startedAt = parsed.data.startedAt || existingEntry.started_at;
    const endedAt = parsed.data.endedAt || existingEntry.ended_at;

    if (startedAt && endedAt) {
      const start = new Date(startedAt);
      const end = new Date(endedAt);
      const durationSeconds = Math.floor((end.getTime() - start.getTime()) / 1000);

      if (durationSeconds < 0) {
        return NextResponse.json(
          { error: 'End time must be after start time' },
          { status: 400 }
        );
      }

      updates.duration_seconds = durationSeconds;
    }

    // Update entry
    const { data: entry, error } = await supabase
      .from('time_entries')
      .update(updates)
      .eq('id', id)
      .select()
      .single();

    if (error) {
      console.error('[PATCH /api/time-tracking/entries/[id]] Error:', error);
      return NextResponse.json({ error: 'Failed to update entry' }, { status: 500 });
    }

    return NextResponse.json({ entry });
  } catch (error) {
    console.error('[PATCH /api/time-tracking/entries/[id]] Error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

/**
 * DELETE /api/time-tracking/entries/[id]
 * Delete a time entry
 */
export async function DELETE(
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

    // Check if entry exists and belongs to user
    const { data: existingEntry, error: findError } = await supabase
      .from('time_entries')
      .select('id')
      .eq('id', id)
      .eq('user_id', user.id)
      .single();

    if (findError || !existingEntry) {
      return NextResponse.json({ error: 'Entry not found' }, { status: 404 });
    }

    // Delete entry
    const { error } = await supabase
      .from('time_entries')
      .delete()
      .eq('id', id);

    if (error) {
      console.error('[DELETE /api/time-tracking/entries/[id]] Error:', error);
      return NextResponse.json({ error: 'Failed to delete entry' }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[DELETE /api/time-tracking/entries/[id]] Error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
