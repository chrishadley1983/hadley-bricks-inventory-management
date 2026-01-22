/**
 * Google Calendar Integration
 *
 * Provides OAuth authentication and Calendar API access for syncing stock pickups.
 */

// Services
export { googleCalendarAuthService, GoogleCalendarAuthService } from './google-calendar-auth.service';
export {
  googleCalendarApiService,
  GoogleCalendarApiService,
  CalendarEventNotFoundError,
} from './google-calendar-api.service';
export type { PickupForCalendar } from './google-calendar-api.service';

// Types
export type {
  GoogleCalendarCredentials,
  GoogleCalendarConnectionStatus,
  GoogleCalendarEvent,
  GoogleCalendarEventTime,
  GoogleCalendarOAuthState,
  GoogleTokenResponse,
  GoogleUserInfo,
} from './types';
