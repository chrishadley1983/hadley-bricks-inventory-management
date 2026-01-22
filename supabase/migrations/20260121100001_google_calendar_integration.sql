-- Migration: google_calendar_integration
-- Purpose: Add Google Calendar OAuth credentials table and calendar sync support for pickups

-- ============================================================================
-- GOOGLE CALENDAR CREDENTIALS TABLE
-- Stores OAuth 2.0 tokens for Google Calendar API access
-- ============================================================================
CREATE TABLE google_calendar_credentials (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  google_user_id TEXT,
  email TEXT,
  access_token TEXT NOT NULL,
  refresh_token TEXT NOT NULL,
  access_token_expires_at TIMESTAMPTZ NOT NULL,
  scopes TEXT[] DEFAULT ARRAY['https://www.googleapis.com/auth/calendar.events'],
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  UNIQUE(user_id)
);

-- Index for user lookup
CREATE INDEX idx_google_calendar_credentials_user ON google_calendar_credentials(user_id);

-- Enable RLS
ALTER TABLE google_calendar_credentials ENABLE ROW LEVEL SECURITY;

-- RLS Policies: Users can only access their own credentials
CREATE POLICY "Users can view own Google Calendar credentials"
  ON google_calendar_credentials FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own Google Calendar credentials"
  ON google_calendar_credentials FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own Google Calendar credentials"
  ON google_calendar_credentials FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own Google Calendar credentials"
  ON google_calendar_credentials FOR DELETE
  USING (auth.uid() = user_id);

-- Updated_at trigger
CREATE TRIGGER update_google_calendar_credentials_updated_at
  BEFORE UPDATE ON google_calendar_credentials
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- ============================================================================
-- ADD CALENDAR EVENT ID TO STOCK PICKUPS
-- Stores the Google Calendar event ID for synced pickups
-- ============================================================================
ALTER TABLE stock_pickups
ADD COLUMN google_calendar_event_id TEXT;

-- Index for finding pickups by calendar event (for potential webhook handling)
CREATE INDEX idx_stock_pickups_calendar_event ON stock_pickups(google_calendar_event_id)
  WHERE google_calendar_event_id IS NOT NULL;
