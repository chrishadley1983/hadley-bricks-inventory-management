-- Add zero_progress_count to arbitrage_sync_status for stuck sync detection
ALTER TABLE arbitrage_sync_status
ADD COLUMN IF NOT EXISTS zero_progress_count integer DEFAULT 0;

-- Reset the stuck pricing_sync status
UPDATE arbitrage_sync_status
SET status = 'idle',
    cursor_position = 0,
    zero_progress_count = 0,
    error_message = NULL
WHERE job_type = 'pricing_sync'
  AND status = 'running';
