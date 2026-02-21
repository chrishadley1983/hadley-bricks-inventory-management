import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import {
  googleCalendarApiService,
  googleCalendarAuthService,
  CalendarEventNotFoundError,
} from '@/lib/google-calendar';

/**
 * POST /api/pickups/[id]/calendar
 * Sync a pickup to Google Calendar (create or update event)
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
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

    // Check if user is connected to Google Calendar
    const isConnected = await googleCalendarAuthService.isConnected(user.id);
    if (!isConnected) {
      return NextResponse.json(
        { error: 'Not connected to Google Calendar. Please connect first.' },
        { status: 400 }
      );
    }

    // Fetch the pickup
    const { data: pickup, error: pickupError } = await supabase
      .from('stock_pickups')
      .select('*')
      .eq('id', id)
      .eq('user_id', user.id)
      .single();

    if (pickupError || !pickup) {
      return NextResponse.json({ error: 'Pickup not found' }, { status: 404 });
    }

    let eventId = pickup.google_calendar_event_id;

    try {
      if (eventId) {
        // Update existing event
        await googleCalendarApiService.updateEvent(user.id, eventId, pickup);
      } else {
        // Create new event
        eventId = await googleCalendarApiService.createEvent(user.id, pickup);

        // Store the event ID in the pickup
        const { error: updateError } = await supabase
          .from('stock_pickups')
          .update({ google_calendar_event_id: eventId })
          .eq('id', id);

        if (updateError) {
          console.error('[POST /api/pickups/[id]/calendar] Failed to store event ID:', updateError);
          // Event was created but we failed to store the ID
          // Try to delete the orphaned event
          try {
            await googleCalendarApiService.deleteEvent(user.id, eventId);
          } catch {
            // Ignore deletion error
          }
          return NextResponse.json(
            { error: 'Failed to link calendar event to pickup' },
            { status: 500 }
          );
        }
      }
    } catch (error) {
      // Handle case where event was deleted externally
      if (error instanceof CalendarEventNotFoundError) {
        // Create a new event since the old one doesn't exist
        eventId = await googleCalendarApiService.createEvent(user.id, pickup);

        // Update the pickup with the new event ID
        await supabase
          .from('stock_pickups')
          .update({ google_calendar_event_id: eventId })
          .eq('id', id);
      } else {
        throw error;
      }
    }

    return NextResponse.json({
      success: true,
      eventId,
      message: pickup.google_calendar_event_id
        ? 'Calendar event updated'
        : 'Calendar event created',
    });
  } catch (error) {
    console.error('[POST /api/pickups/[id]/calendar] Error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to sync to calendar' },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/pickups/[id]/calendar
 * Remove a pickup from Google Calendar
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

    // Fetch the pickup
    const { data: pickup, error: pickupError } = await supabase
      .from('stock_pickups')
      .select('google_calendar_event_id')
      .eq('id', id)
      .eq('user_id', user.id)
      .single();

    if (pickupError || !pickup) {
      return NextResponse.json({ error: 'Pickup not found' }, { status: 404 });
    }

    if (!pickup.google_calendar_event_id) {
      return NextResponse.json({ error: 'Pickup is not synced to calendar' }, { status: 400 });
    }

    // Delete the calendar event
    await googleCalendarApiService.deleteEvent(user.id, pickup.google_calendar_event_id);

    // Clear the event ID from the pickup
    const { error: updateError } = await supabase
      .from('stock_pickups')
      .update({ google_calendar_event_id: null })
      .eq('id', id);

    if (updateError) {
      console.error('[DELETE /api/pickups/[id]/calendar] Failed to clear event ID:', updateError);
    }

    return NextResponse.json({ success: true, message: 'Calendar event removed' });
  } catch (error) {
    console.error('[DELETE /api/pickups/[id]/calendar] Error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to remove from calendar' },
      { status: 500 }
    );
  }
}
