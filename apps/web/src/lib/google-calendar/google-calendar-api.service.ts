/**
 * Google Calendar API Service
 *
 * Handles CRUD operations for Google Calendar events.
 * Creates, updates, and deletes calendar events for stock pickups.
 */

import { googleCalendarAuthService } from './google-calendar-auth.service';
import type { GoogleCalendarEvent } from './types';

// ============================================================================
// Constants
// ============================================================================

const GOOGLE_CALENDAR_API_URL = 'https://www.googleapis.com/calendar/v3';
const PRIMARY_CALENDAR = 'primary'; // User's primary calendar

// ============================================================================
// Types
// ============================================================================

/** Pickup data needed to create a calendar event */
export interface PickupForCalendar {
  id: string;
  title: string;
  description?: string | null;
  scheduled_date: string;
  scheduled_time?: string | null;
  address_line1: string;
  address_line2?: string | null;
  city: string;
  postcode: string;
  estimated_value?: number | null;
  agreed_price?: number | null;
  source_platform?: string | null;
  notes?: string | null;
  estimated_duration_minutes?: number | null;
  scheduled_end_time?: string | null;
}

/** Google Calendar API error response */
interface GoogleCalendarApiError {
  error: {
    code: number;
    message: string;
    errors?: Array<{
      domain: string;
      reason: string;
      message: string;
    }>;
  };
}

// ============================================================================
// GoogleCalendarApiService Class
// ============================================================================

export class GoogleCalendarApiService {
  // ============================================================================
  // Event CRUD Operations
  // ============================================================================

  /**
   * Create a new calendar event for a pickup
   * @param userId The user ID
   * @param pickup The pickup data
   * @returns The created event ID
   */
  async createEvent(userId: string, pickup: PickupForCalendar): Promise<string> {
    const accessToken = await googleCalendarAuthService.getAccessToken(userId);
    if (!accessToken) {
      throw new Error('Not connected to Google Calendar');
    }

    const event = this.pickupToCalendarEvent(pickup);

    const response = await fetch(
      `${GOOGLE_CALENDAR_API_URL}/calendars/${PRIMARY_CALENDAR}/events`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(event),
      }
    );

    if (!response.ok) {
      const errorData = (await response.json()) as GoogleCalendarApiError;
      console.error('[GoogleCalendarApiService] Failed to create event:', errorData);
      throw new Error(errorData.error?.message || `Failed to create event: ${response.status}`);
    }

    const createdEvent = await response.json();
    return createdEvent.id;
  }

  /**
   * Update an existing calendar event
   * @param userId The user ID
   * @param eventId The Google Calendar event ID
   * @param pickup The updated pickup data
   */
  async updateEvent(userId: string, eventId: string, pickup: PickupForCalendar): Promise<void> {
    const accessToken = await googleCalendarAuthService.getAccessToken(userId);
    if (!accessToken) {
      throw new Error('Not connected to Google Calendar');
    }

    const event = this.pickupToCalendarEvent(pickup);

    const response = await fetch(
      `${GOOGLE_CALENDAR_API_URL}/calendars/${PRIMARY_CALENDAR}/events/${encodeURIComponent(eventId)}`,
      {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(event),
      }
    );

    if (!response.ok) {
      const errorData = (await response.json()) as GoogleCalendarApiError;

      // If event not found (404), it was deleted externally
      if (response.status === 404) {
        throw new CalendarEventNotFoundError('Calendar event not found - it may have been deleted');
      }

      console.error('[GoogleCalendarApiService] Failed to update event:', errorData);
      throw new Error(errorData.error?.message || `Failed to update event: ${response.status}`);
    }
  }

  /**
   * Delete a calendar event
   * @param userId The user ID
   * @param eventId The Google Calendar event ID
   */
  async deleteEvent(userId: string, eventId: string): Promise<void> {
    const accessToken = await googleCalendarAuthService.getAccessToken(userId);
    if (!accessToken) {
      throw new Error('Not connected to Google Calendar');
    }

    const response = await fetch(
      `${GOOGLE_CALENDAR_API_URL}/calendars/${PRIMARY_CALENDAR}/events/${encodeURIComponent(eventId)}`,
      {
        method: 'DELETE',
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      }
    );

    // 204 No Content = success, 404 = already deleted (also ok)
    if (!response.ok && response.status !== 404) {
      const errorText = await response.text();
      console.error('[GoogleCalendarApiService] Failed to delete event:', errorText);
      throw new Error(`Failed to delete event: ${response.status}`);
    }
  }

  /**
   * Check if an event exists
   * @param userId The user ID
   * @param eventId The Google Calendar event ID
   * @returns True if the event exists
   */
  async eventExists(userId: string, eventId: string): Promise<boolean> {
    const accessToken = await googleCalendarAuthService.getAccessToken(userId);
    if (!accessToken) {
      return false;
    }

    const response = await fetch(
      `${GOOGLE_CALENDAR_API_URL}/calendars/${PRIMARY_CALENDAR}/events/${encodeURIComponent(eventId)}`,
      {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      }
    );

    return response.ok;
  }

  // ============================================================================
  // Helper Methods
  // ============================================================================

  /**
   * Convert a pickup to a Google Calendar event
   */
  private pickupToCalendarEvent(pickup: PickupForCalendar): GoogleCalendarEvent {
    // Build description
    const descriptionParts: string[] = [];

    if (pickup.description) {
      descriptionParts.push(pickup.description);
      descriptionParts.push('');
    }

    const sourcePlatformLabel = this.formatSourcePlatform(pickup.source_platform);
    if (sourcePlatformLabel) {
      descriptionParts.push(`Source: ${sourcePlatformLabel}`);
    }

    if (pickup.agreed_price != null) {
      descriptionParts.push(`Agreed Price: £${pickup.agreed_price.toFixed(2)}`);
    }

    if (pickup.estimated_value != null) {
      descriptionParts.push(`Estimated Value: £${pickup.estimated_value.toFixed(2)}`);
    }

    if (pickup.notes) {
      descriptionParts.push('');
      descriptionParts.push(`Notes: ${pickup.notes}`);
    }

    // Build location
    const locationParts = [
      pickup.address_line1,
      pickup.address_line2,
      pickup.city,
      pickup.postcode,
    ].filter(Boolean);

    // Build start/end times
    const hasStartTime = pickup.scheduled_time != null;
    const hasEndTime = pickup.scheduled_end_time != null;

    let start: GoogleCalendarEvent['start'];
    let end: GoogleCalendarEvent['end'];

    if (hasStartTime) {
      // Timed event - format time with seconds
      const formatTimeWithSeconds = (time: string) =>
        time.length === 5 ? `${time}:00` : time;

      const startDateTime = `${pickup.scheduled_date}T${formatTimeWithSeconds(pickup.scheduled_time!)}`;

      // Use end time if provided, otherwise fall back to duration or default 1 hour
      let endDateTime: string;
      if (hasEndTime) {
        endDateTime = `${pickup.scheduled_date}T${formatTimeWithSeconds(pickup.scheduled_end_time!)}`;
      } else {
        const durationMinutes = pickup.estimated_duration_minutes || 60;
        endDateTime = this.addMinutes(startDateTime, durationMinutes);
      }

      start = {
        dateTime: startDateTime,
        timeZone: 'Europe/London',
      };
      end = {
        dateTime: endDateTime,
        timeZone: 'Europe/London',
      };
    } else {
      // All-day event
      start = { date: pickup.scheduled_date };
      end = { date: pickup.scheduled_date };
    }

    return {
      summary: `Pickup: ${pickup.title}`,
      description: descriptionParts.join('\n') || undefined,
      location: locationParts.join(', ') || undefined,
      start,
      end,
      reminders: {
        useDefault: false,
        overrides: [
          { method: 'popup', minutes: 60 }, // 1 hour before
          { method: 'popup', minutes: 1440 }, // 1 day before
        ],
      },
    };
  }

  /**
   * Format source platform for display
   */
  private formatSourcePlatform(platform: string | null | undefined): string | null {
    if (!platform) return null;

    const platformLabels: Record<string, string> = {
      facebook: 'Facebook Marketplace',
      gumtree: 'Gumtree',
      ebay: 'eBay Collection',
      bricklink: 'BrickLink',
      referral: 'Referral',
      other: 'Other',
    };

    return platformLabels[platform] || platform;
  }

  /**
   * Add minutes to a datetime string and return in ISO format
   * Handles various input formats like "2026-01-21T10:00" or "2026-01-21T10:00:00"
   */
  private addMinutes(dateTime: string, minutes: number): string {
    // Parse the date parts manually to avoid timezone issues
    const match = dateTime.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/);
    if (!match) {
      console.error('[GoogleCalendarApiService] Invalid dateTime format:', dateTime);
      // Fallback: return the same time plus duration assumption
      return dateTime;
    }

    const [, year, month, day, hour, minute, second = '00'] = match;
    const date = new Date(
      parseInt(year),
      parseInt(month) - 1, // JS months are 0-indexed
      parseInt(day),
      parseInt(hour),
      parseInt(minute) + minutes,
      parseInt(second)
    );

    // Format as ISO without timezone suffix
    const pad = (n: number) => n.toString().padStart(2, '0');
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
  }
}

// ============================================================================
// Custom Errors
// ============================================================================

export class CalendarEventNotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CalendarEventNotFoundError';
  }
}

// Export a default instance
export const googleCalendarApiService = new GoogleCalendarApiService();
