-- Migration: Add pause support to pomodoro_sessions
-- Adds paused_at, paused_duration_seconds, updated_at columns

-- Add missing columns for pause functionality
ALTER TABLE pomodoro_sessions
  ADD COLUMN IF NOT EXISTS paused_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS paused_duration_seconds INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

-- Add 'paused' as valid status option
ALTER TABLE pomodoro_sessions
  DROP CONSTRAINT IF EXISTS pomodoro_sessions_status_check;

ALTER TABLE pomodoro_sessions
  ADD CONSTRAINT pomodoro_sessions_status_check
  CHECK (status IN ('work', 'break', 'completed', 'cancelled', 'paused'));

-- Update index to include paused status
DROP INDEX IF EXISTS idx_pomodoro_sessions_active;

CREATE INDEX idx_pomodoro_sessions_active ON pomodoro_sessions(user_id)
  WHERE status IN ('work', 'break', 'paused');
