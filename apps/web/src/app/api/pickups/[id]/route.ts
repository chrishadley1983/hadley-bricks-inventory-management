import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { z } from 'zod';
import {
  googleCalendarApiService,
  googleCalendarAuthService,
  CalendarEventNotFoundError,
} from '@/lib/google-calendar';

const UpdatePickupSchema = z.object({
  title: z.string().min(1).optional(),
  description: z.string().nullable().optional(),
  scheduled_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  scheduled_time: z.string().nullable().optional(),
  scheduled_end_time: z.string().nullable().optional(),
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
      .select('id, google_calendar_event_id')
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

    // Auto-sync to Google Calendar if pickup is synced
    if (existing.google_calendar_event_id && pickup) {
      try {
        const isConnected = await googleCalendarAuthService.isConnected(user.id);
        if (isConnected) {
          await googleCalendarApiService.updateEvent(
            user.id,
            existing.google_calendar_event_id,
            pickup
          );
          console.log('[PATCH /api/pickups/[id]] Calendar event updated');
        }
      } catch (calendarError) {
        // Handle case where event was deleted externally
        if (calendarError instanceof CalendarEventNotFoundError) {
          // Clear the calendar event ID since it no longer exists
          await supabase
            .from('stock_pickups')
            .update({ google_calendar_event_id: null })
            .eq('id', id);
          console.log('[PATCH /api/pickups/[id]] Calendar event not found, cleared ID');
        } else {
          // Log error but don't fail the pickup update
          console.error('[PATCH /api/pickups/[id]] Failed to sync calendar:', calendarError);
        }
      }
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
      .select('id, google_calendar_event_id')
      .eq('id', id)
      .eq('user_id', user.id)
      .single();

    if (!existing) {
      return NextResponse.json({ error: 'Pickup not found' }, { status: 404 });
    }

    // Delete calendar event if synced (do this before deleting pickup)
    if (existing.google_calendar_event_id) {
      try {
        const isConnected = await googleCalendarAuthService.isConnected(user.id);
        if (isConnected) {
          await googleCalendarApiService.deleteEvent(user.id, existing.google_calendar_event_id);
          console.log('[DELETE /api/pickups/[id]] Calendar event deleted');
        }
      } catch (calendarError) {
        // Log error but don't fail the pickup delete
        console.error('[DELETE /api/pickups/[id]] Failed to delete calendar event:', calendarError);
      }
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
