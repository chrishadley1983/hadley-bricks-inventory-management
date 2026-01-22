/**
 * Google Calendar Integration Types
 */

/** Stored credentials from database */
export interface GoogleCalendarCredentials {
  id: string;
  user_id: string;
  google_user_id: string | null;
  email: string | null;
  access_token: string;
  refresh_token: string;
  access_token_expires_at: string;
  scopes: string[];
  created_at: string;
  updated_at: string;
}

/** Connection status response */
export interface GoogleCalendarConnectionStatus {
  isConnected: boolean;
  email?: string;
  expiresAt?: Date;
}

/** Google Calendar event structure */
export interface GoogleCalendarEvent {
  id?: string;
  summary: string;
  description?: string;
  location?: string;
  start: GoogleCalendarEventTime;
  end: GoogleCalendarEventTime;
  reminders?: {
    useDefault: boolean;
    overrides?: Array<{
      method: 'email' | 'popup';
      minutes: number;
    }>;
  };
}

/** Event time - either dateTime (with time) or date (all-day) */
export interface GoogleCalendarEventTime {
  /** ISO datetime for timed events (e.g., "2026-01-21T10:00:00") */
  dateTime?: string;
  /** Date only for all-day events (e.g., "2026-01-21") */
  date?: string;
  /** Timezone (e.g., "Europe/London") */
  timeZone?: string;
}

/** OAuth state encoded in the authorization URL */
export interface GoogleCalendarOAuthState {
  userId: string;
  returnUrl?: string;
  timestamp: number;
}

/** Token response from Google OAuth */
export interface GoogleTokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  token_type: string;
  scope: string;
}

/** User info response from Google */
export interface GoogleUserInfo {
  id: string;
  email: string;
  verified_email: boolean;
  name?: string;
  picture?: string;
}
