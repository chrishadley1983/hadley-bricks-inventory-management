-- Migration: Add listing_preview_sessions table
-- Purpose: Store state between listing creation phases for pre-publish quality review
--
-- Flow:
-- 1. Initial request creates session after quality review (steps 1-5)
-- 2. Client shows preview, user edits, clicks confirm
-- 3. Confirm endpoint retrieves session and completes steps 6-10
-- 4. Session expires after 30 minutes if not confirmed

CREATE TABLE IF NOT EXISTS listing_preview_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  inventory_item_id UUID NOT NULL REFERENCES inventory_items(id) ON DELETE CASCADE,

  -- Request data (needed to resume)
  request_data JSONB NOT NULL,

  -- Generated content
  generated_listing JSONB NOT NULL,
  quality_review JSONB,
  quality_review_failed BOOLEAN NOT NULL DEFAULT false,
  quality_review_error TEXT,
  quality_loop_iterations INTEGER NOT NULL DEFAULT 1,

  -- Research and policy data (cached from steps 2-3)
  research_data JSONB,
  policies_data JSONB NOT NULL,

  -- Photo URLs (already uploaded in step 7 - but we do images after confirm now)
  photo_urls TEXT[] NOT NULL DEFAULT '{}',

  -- Session state
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'confirmed', 'cancelled', 'expired')),

  -- Timing
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '30 minutes'),
  confirmed_at TIMESTAMPTZ,

  -- Index for quick lookups
  CONSTRAINT listing_preview_sessions_user_item UNIQUE (user_id, inventory_item_id, status)
);

-- RLS policies
ALTER TABLE listing_preview_sessions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own sessions"
  ON listing_preview_sessions FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own sessions"
  ON listing_preview_sessions FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own sessions"
  ON listing_preview_sessions FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own sessions"
  ON listing_preview_sessions FOR DELETE
  USING (auth.uid() = user_id);

-- Index for expiry cleanup
CREATE INDEX listing_preview_sessions_expires_at ON listing_preview_sessions(expires_at) WHERE status = 'pending';

-- Index for user lookups
CREATE INDEX listing_preview_sessions_user_id ON listing_preview_sessions(user_id);

COMMENT ON TABLE listing_preview_sessions IS 'Stores state between listing creation phases for pre-publish quality review';
