-- Migration: Pomodoro Sessions Table (Phase 3)
-- Creates pomodoro_sessions table for pomodoro timer functionality

-- ============================================================================
-- pomodoro_sessions: Individual pomodoro session records
-- ============================================================================
CREATE TABLE IF NOT EXISTS pomodoro_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,

  -- Session info
  session_date DATE NOT NULL,
  session_number INTEGER NOT NULL, -- 1, 2, 3... for the day

  -- Mode configuration
  mode VARCHAR(20) NOT NULL CHECK (mode IN ('classic', 'long', 'custom')),
  work_minutes INTEGER NOT NULL,
  break_minutes INTEGER NOT NULL,

  -- Timing
  started_at TIMESTAMPTZ NOT NULL,
  work_completed_at TIMESTAMPTZ,
  break_completed_at TIMESTAMPTZ,

  -- Status
  status VARCHAR(20) DEFAULT 'work' CHECK (status IN ('work', 'break', 'completed', 'cancelled')),

  -- Optional link to time entry (for automatic time tracking)
  time_entry_id UUID REFERENCES time_entries(id) ON DELETE SET NULL,

  -- Category for the session (for time tracking integration)
  category VARCHAR(50) CHECK (category IN ('Development', 'Listing', 'Shipping', 'Sourcing', 'Admin', 'Other')),

  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for fetching sessions by user and date
CREATE INDEX idx_pomodoro_sessions_user_date ON pomodoro_sessions(user_id, session_date);

-- Index for finding active session (only one should exist per user)
CREATE INDEX idx_pomodoro_sessions_active ON pomodoro_sessions(user_id)
  WHERE status IN ('work', 'break');

-- RLS Policies
ALTER TABLE pomodoro_sessions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own pomodoro sessions"
  ON pomodoro_sessions FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own pomodoro sessions"
  ON pomodoro_sessions FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own pomodoro sessions"
  ON pomodoro_sessions FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own pomodoro sessions"
  ON pomodoro_sessions FOR DELETE
  USING (auth.uid() = user_id);

-- ============================================================================
-- Function to calculate pomodoro streak
-- ============================================================================
CREATE OR REPLACE FUNCTION get_pomodoro_streak(p_user_id UUID)
RETURNS INTEGER AS $$
DECLARE
  streak INTEGER := 0;
  current_date DATE := CURRENT_DATE;
  check_date DATE;
  has_session BOOLEAN;
BEGIN
  -- Start checking from yesterday (today might not have sessions yet)
  check_date := current_date - INTERVAL '1 day';

  LOOP
    -- Check if there's at least one completed session on this date
    SELECT EXISTS (
      SELECT 1 FROM pomodoro_sessions
      WHERE user_id = p_user_id
        AND session_date = check_date
        AND status = 'completed'
    ) INTO has_session;

    IF has_session THEN
      streak := streak + 1;
      check_date := check_date - INTERVAL '1 day';
    ELSE
      EXIT;
    END IF;
  END LOOP;

  -- Also check if today has sessions
  SELECT EXISTS (
    SELECT 1 FROM pomodoro_sessions
    WHERE user_id = p_user_id
      AND session_date = current_date
      AND status = 'completed'
  ) INTO has_session;

  IF has_session THEN
    streak := streak + 1;
  END IF;

  RETURN streak;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
