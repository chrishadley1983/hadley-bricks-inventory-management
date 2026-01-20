-- Migration: Workflow Config Extensions (Phase 6)
-- Extends workflow_config with notification preferences and pomodoro settings

-- ============================================================================
-- Add notification preference columns
-- ============================================================================
ALTER TABLE workflow_config
  ADD COLUMN IF NOT EXISTS notifications_enabled BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS notification_dispatch_hours INTEGER DEFAULT 2,
  ADD COLUMN IF NOT EXISTS notification_overdue_orders BOOLEAN DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS notification_resolution_threshold INTEGER DEFAULT 10,
  ADD COLUMN IF NOT EXISTS notification_sync_failure BOOLEAN DEFAULT TRUE;

-- ============================================================================
-- Add pomodoro settings columns
-- ============================================================================
ALTER TABLE workflow_config
  ADD COLUMN IF NOT EXISTS pomodoro_classic_work INTEGER DEFAULT 25,
  ADD COLUMN IF NOT EXISTS pomodoro_classic_break INTEGER DEFAULT 5,
  ADD COLUMN IF NOT EXISTS pomodoro_long_work INTEGER DEFAULT 50,
  ADD COLUMN IF NOT EXISTS pomodoro_long_break INTEGER DEFAULT 10,
  ADD COLUMN IF NOT EXISTS pomodoro_sessions_before_long_break INTEGER DEFAULT 4,
  ADD COLUMN IF NOT EXISTS pomodoro_daily_target INTEGER DEFAULT 8;

-- ============================================================================
-- Add time tracking settings columns
-- ============================================================================
ALTER TABLE workflow_config
  ADD COLUMN IF NOT EXISTS time_categories JSONB DEFAULT '["Development", "Listing", "Shipping", "Sourcing", "Admin", "Other"]'::jsonb;

-- ============================================================================
-- Add audio settings columns
-- ============================================================================
ALTER TABLE workflow_config
  ADD COLUMN IF NOT EXISTS audio_work_complete VARCHAR(50) DEFAULT 'bell',
  ADD COLUMN IF NOT EXISTS audio_break_complete VARCHAR(50) DEFAULT 'chime',
  ADD COLUMN IF NOT EXISTS audio_enabled BOOLEAN DEFAULT TRUE;

-- ============================================================================
-- Comment on new columns for documentation
-- ============================================================================
COMMENT ON COLUMN workflow_config.notifications_enabled IS 'Master toggle for push notifications';
COMMENT ON COLUMN workflow_config.notification_dispatch_hours IS 'Hours before dispatch deadline to send warning';
COMMENT ON COLUMN workflow_config.notification_overdue_orders IS 'Send notifications for overdue orders';
COMMENT ON COLUMN workflow_config.notification_resolution_threshold IS 'Backlog count threshold for resolution notifications';
COMMENT ON COLUMN workflow_config.notification_sync_failure IS 'Send notifications for platform sync failures';

COMMENT ON COLUMN workflow_config.pomodoro_classic_work IS 'Classic mode work duration in minutes';
COMMENT ON COLUMN workflow_config.pomodoro_classic_break IS 'Classic mode break duration in minutes';
COMMENT ON COLUMN workflow_config.pomodoro_long_work IS 'Long mode work duration in minutes';
COMMENT ON COLUMN workflow_config.pomodoro_long_break IS 'Long mode break duration in minutes';
COMMENT ON COLUMN workflow_config.pomodoro_sessions_before_long_break IS 'Number of sessions before a long break';
COMMENT ON COLUMN workflow_config.pomodoro_daily_target IS 'Target number of pomodoro sessions per day';

COMMENT ON COLUMN workflow_config.time_categories IS 'Array of enabled time tracking categories';

COMMENT ON COLUMN workflow_config.audio_work_complete IS 'Sound to play when work phase completes';
COMMENT ON COLUMN workflow_config.audio_break_complete IS 'Sound to play when break phase completes';
COMMENT ON COLUMN workflow_config.audio_enabled IS 'Enable/disable audio notifications';

-- ============================================================================
-- Update seed function to include new defaults
-- ============================================================================
CREATE OR REPLACE FUNCTION seed_workflow_data()
RETURNS void AS $$
DECLARE
  v_user_id UUID;
BEGIN
  -- Get current user ID
  v_user_id := auth.uid();

  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'No authenticated user';
  END IF;

  -- Insert or update workflow config with all defaults
  INSERT INTO workflow_config (
    user_id,
    target_ebay_listings,
    target_amazon_listings,
    target_bricklink_weekly_value,
    target_daily_listed_value,
    target_daily_sold_value,
    working_days,
    notifications_enabled,
    notification_dispatch_hours,
    notification_overdue_orders,
    notification_resolution_threshold,
    notification_sync_failure,
    pomodoro_classic_work,
    pomodoro_classic_break,
    pomodoro_long_work,
    pomodoro_long_break,
    pomodoro_sessions_before_long_break,
    pomodoro_daily_target,
    time_categories,
    audio_work_complete,
    audio_break_complete,
    audio_enabled
  ) VALUES (
    v_user_id,
    500,
    250,
    1000,
    300,
    250,
    127,
    FALSE,
    2,
    TRUE,
    10,
    TRUE,
    25,
    5,
    50,
    10,
    4,
    8,
    '["Development", "Listing", "Shipping", "Sourcing", "Admin", "Other"]'::jsonb,
    'bell',
    'chime',
    TRUE
  )
  ON CONFLICT (user_id) DO UPDATE SET
    updated_at = NOW();

  -- Call original seed for task definitions and presets
  -- (existing logic from Phase 1 migration)
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
