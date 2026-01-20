-- Migration: Time Tracking Tables (Phase 2)
-- Creates time_entries and time_daily_summaries tables for time tracking functionality

-- ============================================================================
-- time_entries: Individual time tracking records
-- ============================================================================
CREATE TABLE IF NOT EXISTS time_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,

  -- Category of work
  category VARCHAR(50) NOT NULL CHECK (category IN ('Development', 'Listing', 'Shipping', 'Sourcing', 'Admin', 'Other')),

  -- Time tracking
  started_at TIMESTAMPTZ NOT NULL,
  ended_at TIMESTAMPTZ,
  duration_seconds INTEGER, -- Calculated on stop

  -- Pause tracking
  is_paused BOOLEAN DEFAULT FALSE,
  paused_duration_seconds INTEGER DEFAULT 0, -- Accumulated pause time

  -- Optional link to task
  task_instance_id UUID REFERENCES workflow_task_instances(id) ON DELETE SET NULL,

  -- Additional info
  notes TEXT,
  is_manual_entry BOOLEAN DEFAULT FALSE,

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for fetching entries by user and date
-- Using timezone-aware cast for proper date extraction
CREATE INDEX idx_time_entries_user_started ON time_entries(user_id, started_at);

-- Index for finding active timer (only one should exist per user)
CREATE INDEX idx_time_entries_active ON time_entries(user_id)
  WHERE ended_at IS NULL;

-- RLS Policies
ALTER TABLE time_entries ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own time entries"
  ON time_entries FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own time entries"
  ON time_entries FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own time entries"
  ON time_entries FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own time entries"
  ON time_entries FOR DELETE
  USING (auth.uid() = user_id);

-- ============================================================================
-- time_daily_summaries: Aggregated daily totals by category
-- ============================================================================
CREATE TABLE IF NOT EXISTS time_daily_summaries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  summary_date DATE NOT NULL,

  -- Total time for the day
  total_seconds INTEGER DEFAULT 0,

  -- Time per category
  development_seconds INTEGER DEFAULT 0,
  listing_seconds INTEGER DEFAULT 0,
  shipping_seconds INTEGER DEFAULT 0,
  sourcing_seconds INTEGER DEFAULT 0,
  admin_seconds INTEGER DEFAULT 0,
  other_seconds INTEGER DEFAULT 0,

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  -- One summary per user per day
  UNIQUE(user_id, summary_date)
);

-- Index for fetching summaries by user and date range
CREATE INDEX idx_time_daily_summaries_user_date ON time_daily_summaries(user_id, summary_date);

-- RLS Policies
ALTER TABLE time_daily_summaries ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own daily summaries"
  ON time_daily_summaries FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own daily summaries"
  ON time_daily_summaries FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own daily summaries"
  ON time_daily_summaries FOR UPDATE
  USING (auth.uid() = user_id);

-- ============================================================================
-- Function to update daily summary when time entry is stopped
-- ============================================================================
CREATE OR REPLACE FUNCTION update_time_daily_summary()
RETURNS TRIGGER AS $$
DECLARE
  entry_date DATE;
  category_column TEXT;
BEGIN
  -- Only run when entry is completed (ended_at is set)
  IF NEW.ended_at IS NOT NULL AND NEW.duration_seconds IS NOT NULL THEN
    entry_date := (NEW.started_at AT TIME ZONE 'UTC')::date;

    -- Map category to column name
    category_column := LOWER(NEW.category) || '_seconds';

    -- Upsert daily summary
    INSERT INTO time_daily_summaries (user_id, summary_date, total_seconds)
    VALUES (NEW.user_id, entry_date, NEW.duration_seconds)
    ON CONFLICT (user_id, summary_date) DO UPDATE SET
      total_seconds = time_daily_summaries.total_seconds + NEW.duration_seconds,
      updated_at = NOW();

    -- Update category-specific column
    EXECUTE format(
      'UPDATE time_daily_summaries SET %I = %I + $1, updated_at = NOW() WHERE user_id = $2 AND summary_date = $3',
      category_column, category_column
    ) USING NEW.duration_seconds, NEW.user_id, entry_date;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Trigger to automatically update daily summary
CREATE TRIGGER trigger_update_time_daily_summary
  AFTER INSERT OR UPDATE OF ended_at, duration_seconds ON time_entries
  FOR EACH ROW
  EXECUTE FUNCTION update_time_daily_summary();
