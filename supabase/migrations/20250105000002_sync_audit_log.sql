-- Sync Audit Log
-- Tracks all sync operations for debugging purposes

CREATE TABLE IF NOT EXISTS sync_audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  table_name TEXT NOT NULL,
  action TEXT NOT NULL, -- 'sync_started', 'sync_completed', 'sync_failed'
  timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Request details for debugging
  user_agent TEXT,
  referer TEXT,
  origin TEXT,
  ip_address TEXT,

  -- Sync results
  records_affected INTEGER,
  error_message TEXT,
  duration_ms INTEGER,

  -- Additional context
  metadata JSONB DEFAULT '{}'::jsonb,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index for querying by user and time
CREATE INDEX IF NOT EXISTS idx_sync_audit_log_user_time
  ON sync_audit_log(user_id, timestamp DESC);

-- Index for querying by table
CREATE INDEX IF NOT EXISTS idx_sync_audit_log_table
  ON sync_audit_log(table_name, timestamp DESC);

-- RLS policies
ALTER TABLE sync_audit_log ENABLE ROW LEVEL SECURITY;

-- Users can only see their own sync logs
CREATE POLICY "Users can view their own sync logs"
  ON sync_audit_log
  FOR SELECT
  USING (auth.uid() = user_id);

-- Users can insert their own sync logs
CREATE POLICY "Users can insert own sync logs"
  ON sync_audit_log
  FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- Automatically clean up logs older than 30 days (optional - can be adjusted)
-- This is a comment for now, can be enabled later with pg_cron or a scheduled job
-- DELETE FROM sync_audit_log WHERE timestamp < NOW() - INTERVAL '30 days';

COMMENT ON TABLE sync_audit_log IS 'Audit log for Google Sheets sync operations - helps debug sync issues';
