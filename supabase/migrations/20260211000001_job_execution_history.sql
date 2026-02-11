-- Job Execution History
-- Append-only audit log for all cron job executions.
-- Replaces the need to dig through Vercel logs to answer
-- "did this job run last night?" or "how many failures this week?"

CREATE TABLE IF NOT EXISTS job_execution_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Job identification
  job_name TEXT NOT NULL,                          -- e.g. 'full-sync', 'amazon-pricing'
  trigger TEXT NOT NULL DEFAULT 'cron',             -- 'cron' | 'manual' | 'service' | 'chained'

  -- Lifecycle
  status TEXT NOT NULL DEFAULT 'running',           -- 'running' | 'completed' | 'failed' | 'timeout'
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  duration_ms INTEGER,

  -- Metrics
  items_processed INTEGER DEFAULT 0,
  items_failed INTEGER DEFAULT 0,
  result_summary JSONB,                            -- Job-specific structured data

  -- Error tracking
  error_message TEXT,
  error_stack TEXT,

  -- HTTP context
  http_status INTEGER
);

-- Primary query: "show me recent runs for job X"
CREATE INDEX idx_job_exec_history_job_started
  ON job_execution_history (job_name, started_at DESC);

-- Query: "show me all failures recently"
CREATE INDEX idx_job_exec_history_status_started
  ON job_execution_history (status, started_at DESC);

-- Query: "show me everything that ran recently"
CREATE INDEX idx_job_exec_history_started
  ON job_execution_history (started_at DESC);

-- RLS: service role only (no user policies)
ALTER TABLE job_execution_history ENABLE ROW LEVEL SECURITY;
