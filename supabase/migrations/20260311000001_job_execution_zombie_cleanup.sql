-- Job Execution Zombie Cleanup
--
-- Problem: Cron jobs that get hard-killed by Vercel (60s timeout on Hobby plan)
-- or GCP Cloud Scheduler (300s attemptDeadline) leave "running" entries forever.
-- As of 2026-03-11: 183 amazon-pricing + 2 spapi-buybox-overlay + 1 investment-retrain
-- zombies exist.
--
-- Fix: pg_cron job runs every 5 minutes to auto-timeout stale entries.

-- 1. One-off cleanup: mark all existing zombies as 'timeout'
UPDATE job_execution_history
SET
  status = 'timeout',
  completed_at = started_at + INTERVAL '5 minutes',
  duration_ms = 300000,
  error_message = 'Auto-marked as timeout (stale running entry)'
WHERE status = 'running'
  AND started_at < NOW() - INTERVAL '10 minutes';

-- 2. Create a function to clean up stale running entries
CREATE OR REPLACE FUNCTION cleanup_stale_job_executions()
RETURNS INTEGER
LANGUAGE plpgsql
AS $$
DECLARE
  rows_updated INTEGER;
BEGIN
  UPDATE job_execution_history
  SET
    status = 'timeout',
    completed_at = NOW(),
    duration_ms = EXTRACT(EPOCH FROM (NOW() - started_at))::INTEGER * 1000,
    error_message = 'Auto-marked as timeout by cleanup job'
  WHERE status = 'running'
    AND started_at < NOW() - INTERVAL '10 minutes';

  GET DIAGNOSTICS rows_updated = ROW_COUNT;
  RETURN rows_updated;
END;
$$;

-- 3. Schedule cleanup every 5 minutes via pg_cron
SELECT cron.schedule(
  'cleanup-stale-job-executions',
  '*/5 * * * *',
  $$SELECT cleanup_stale_job_executions()$$
);
