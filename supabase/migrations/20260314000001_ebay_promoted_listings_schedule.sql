-- Migration: eBay Promoted Listings Schedule
-- Configurable promotion stages that automatically apply based on listing age.
-- Example: No promotion → 4.1% after 7 days → 6.0% after 45 days

-- ============================================================================
-- 1. Schedules table (one per campaign per user)
-- ============================================================================

CREATE TABLE IF NOT EXISTS ebay_promoted_listings_schedules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  campaign_id TEXT NOT NULL,
  campaign_name TEXT,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE(user_id, campaign_id)
);

-- ============================================================================
-- 2. Stages table (each stage = day threshold + bid percentage)
-- ============================================================================
-- days_threshold = 0 means promote immediately on listing.
-- No 0-day stage means no promotion initially (e.g. Chris's "no promotion when listed").

CREATE TABLE IF NOT EXISTS ebay_promoted_listings_stages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  schedule_id UUID NOT NULL REFERENCES ebay_promoted_listings_schedules(id) ON DELETE CASCADE,
  days_threshold INTEGER NOT NULL CHECK (days_threshold >= 0),
  bid_percentage NUMERIC(4,1) NOT NULL CHECK (bid_percentage >= 2.0 AND bid_percentage <= 100.0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE(schedule_id, days_threshold)
);

-- ============================================================================
-- 3. Indexes
-- ============================================================================

CREATE INDEX idx_promoted_schedules_user ON ebay_promoted_listings_schedules(user_id);
CREATE INDEX idx_promoted_schedules_user_enabled ON ebay_promoted_listings_schedules(user_id) WHERE enabled = TRUE;
CREATE INDEX idx_promoted_stages_schedule ON ebay_promoted_listings_stages(schedule_id);

-- ============================================================================
-- 4. RLS
-- ============================================================================

ALTER TABLE ebay_promoted_listings_schedules ENABLE ROW LEVEL SECURITY;
ALTER TABLE ebay_promoted_listings_stages ENABLE ROW LEVEL SECURITY;

-- Schedules
CREATE POLICY "Users can view own promoted listing schedules"
  ON ebay_promoted_listings_schedules FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own promoted listing schedules"
  ON ebay_promoted_listings_schedules FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own promoted listing schedules"
  ON ebay_promoted_listings_schedules FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete own promoted listing schedules"
  ON ebay_promoted_listings_schedules FOR DELETE USING (auth.uid() = user_id);

-- Stages (access via parent schedule's user_id)
CREATE POLICY "Users can view own promoted listing stages"
  ON ebay_promoted_listings_stages FOR SELECT
  USING (EXISTS (SELECT 1 FROM ebay_promoted_listings_schedules s WHERE s.id = schedule_id AND s.user_id = auth.uid()));
CREATE POLICY "Users can insert own promoted listing stages"
  ON ebay_promoted_listings_stages FOR INSERT
  WITH CHECK (EXISTS (SELECT 1 FROM ebay_promoted_listings_schedules s WHERE s.id = schedule_id AND s.user_id = auth.uid()));
CREATE POLICY "Users can update own promoted listing stages"
  ON ebay_promoted_listings_stages FOR UPDATE
  USING (EXISTS (SELECT 1 FROM ebay_promoted_listings_schedules s WHERE s.id = schedule_id AND s.user_id = auth.uid()));
CREATE POLICY "Users can delete own promoted listing stages"
  ON ebay_promoted_listings_stages FOR DELETE
  USING (EXISTS (SELECT 1 FROM ebay_promoted_listings_schedules s WHERE s.id = schedule_id AND s.user_id = auth.uid()));

-- ============================================================================
-- 5. Updated_at trigger
-- ============================================================================

CREATE OR REPLACE FUNCTION update_promoted_schedule_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_promoted_schedule_updated_at
  BEFORE UPDATE ON ebay_promoted_listings_schedules
  FOR EACH ROW
  EXECUTE FUNCTION update_promoted_schedule_updated_at();
