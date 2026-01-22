-- Vinted Automation v2: Add version tracking, heartbeat, and connection status fields
-- This migration adds server-side scheduling support with version synchronization

-- ============================================================================
-- ALTER vinted_scanner_config: Add v2 fields
-- ============================================================================

-- Config version: increments on any config change (thresholds, operating hours, etc.)
ALTER TABLE vinted_scanner_config
ADD COLUMN IF NOT EXISTS config_version INTEGER NOT NULL DEFAULT 1;

-- Schedule version: increments on watchlist change
ALTER TABLE vinted_scanner_config
ADD COLUMN IF NOT EXISTS schedule_version INTEGER NOT NULL DEFAULT 1;

-- API key for Windows tray app authentication
ALTER TABLE vinted_scanner_config
ADD COLUMN IF NOT EXISTS api_key TEXT;

-- Heartbeat tracking for local service connection (DB11)
ALTER TABLE vinted_scanner_config
ADD COLUMN IF NOT EXISTS last_heartbeat_at TIMESTAMPTZ;

ALTER TABLE vinted_scanner_config
ADD COLUMN IF NOT EXISTS heartbeat_machine_id TEXT;

ALTER TABLE vinted_scanner_config
ADD COLUMN IF NOT EXISTS heartbeat_status TEXT CHECK (heartbeat_status IN ('running', 'paused', 'error', 'outside_hours', 'disconnected'));

ALTER TABLE vinted_scanner_config
ADD COLUMN IF NOT EXISTS heartbeat_scans_today INTEGER NOT NULL DEFAULT 0;

ALTER TABLE vinted_scanner_config
ADD COLUMN IF NOT EXISTS heartbeat_opportunities_today INTEGER NOT NULL DEFAULT 0;

-- Additional fields for dashboard display
ALTER TABLE vinted_scanner_config
ADD COLUMN IF NOT EXISTS machine_name TEXT;

ALTER TABLE vinted_scanner_config
ADD COLUMN IF NOT EXISTS last_scan_at TIMESTAMPTZ;

-- ============================================================================
-- FUNCTION: Increment config_version on config change
-- ============================================================================
CREATE OR REPLACE FUNCTION increment_vinted_config_version()
RETURNS TRIGGER AS $$
BEGIN
  -- Only increment if relevant fields changed
  IF (NEW.enabled IS DISTINCT FROM OLD.enabled OR
      NEW.paused IS DISTINCT FROM OLD.paused OR
      NEW.broad_sweep_cog_threshold IS DISTINCT FROM OLD.broad_sweep_cog_threshold OR
      NEW.watchlist_cog_threshold IS DISTINCT FROM OLD.watchlist_cog_threshold OR
      NEW.near_miss_threshold IS DISTINCT FROM OLD.near_miss_threshold OR
      NEW.operating_hours_start IS DISTINCT FROM OLD.operating_hours_start OR
      NEW.operating_hours_end IS DISTINCT FROM OLD.operating_hours_end) THEN
    NEW.config_version := OLD.config_version + 1;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger for config version increment
DROP TRIGGER IF EXISTS vinted_config_version_trigger ON vinted_scanner_config;
CREATE TRIGGER vinted_config_version_trigger
BEFORE UPDATE ON vinted_scanner_config
FOR EACH ROW
EXECUTE FUNCTION increment_vinted_config_version();

-- ============================================================================
-- FUNCTION: Increment schedule_version on watchlist change
-- ============================================================================
CREATE OR REPLACE FUNCTION increment_vinted_schedule_version()
RETURNS TRIGGER AS $$
DECLARE
  config_user_id UUID;
BEGIN
  -- Get the user_id from the watchlist row
  IF TG_OP = 'DELETE' THEN
    config_user_id := OLD.user_id;
  ELSE
    config_user_id := NEW.user_id;
  END IF;

  -- Increment schedule_version in config
  UPDATE vinted_scanner_config
  SET schedule_version = schedule_version + 1,
      updated_at = now()
  WHERE user_id = config_user_id;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  ELSE
    RETURN NEW;
  END IF;
END;
$$ LANGUAGE plpgsql;

-- Create trigger for schedule version increment on watchlist changes
DROP TRIGGER IF EXISTS vinted_watchlist_schedule_version_trigger ON vinted_watchlist;
CREATE TRIGGER vinted_watchlist_schedule_version_trigger
AFTER INSERT OR UPDATE OR DELETE ON vinted_watchlist
FOR EACH ROW
EXECUTE FUNCTION increment_vinted_schedule_version();

-- ============================================================================
-- COMMENTS
-- ============================================================================
COMMENT ON COLUMN vinted_scanner_config.api_key IS 'API key for Windows tray app authentication. X-Api-Key header.';
COMMENT ON COLUMN vinted_scanner_config.config_version IS 'Increments on config changes. Local service polls to detect updates.';
COMMENT ON COLUMN vinted_scanner_config.schedule_version IS 'Increments on watchlist changes. Local service refetches schedule when changed.';
COMMENT ON COLUMN vinted_scanner_config.last_heartbeat_at IS 'Last time local service sent heartbeat. Used for connection status.';
COMMENT ON COLUMN vinted_scanner_config.heartbeat_machine_id IS 'Unique identifier of the local Windows machine running the scanner.';
COMMENT ON COLUMN vinted_scanner_config.heartbeat_status IS 'Current status of local service: running, paused, error, outside_hours, disconnected.';
COMMENT ON COLUMN vinted_scanner_config.heartbeat_scans_today IS 'Count of scans executed today by local service.';
COMMENT ON COLUMN vinted_scanner_config.heartbeat_opportunities_today IS 'Count of opportunities found today by local service.';
COMMENT ON COLUMN vinted_scanner_config.machine_name IS 'Friendly hostname of the local machine for dashboard display.';
COMMENT ON COLUMN vinted_scanner_config.last_scan_at IS 'Timestamp of last completed scan.';
