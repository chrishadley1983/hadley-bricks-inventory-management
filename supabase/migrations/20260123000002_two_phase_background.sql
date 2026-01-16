-- Two-Phase Sync Background Processing Support
-- Adds columns to track the state of async two-phase sync processing

-- Add columns to amazon_sync_feeds for background processing state
ALTER TABLE amazon_sync_feeds
ADD COLUMN IF NOT EXISTS two_phase_step TEXT CHECK (two_phase_step IN (
  'price_submitted',
  'price_polling',
  'price_verifying',
  'quantity_submitted',
  'quantity_polling',
  'complete',
  'failed'
)),
ADD COLUMN IF NOT EXISTS two_phase_started_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS two_phase_last_poll_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS two_phase_poll_count INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS two_phase_user_email TEXT,
ADD COLUMN IF NOT EXISTS quantity_feed_id UUID REFERENCES amazon_sync_feeds(id);

-- Index for finding feeds that need background processing
CREATE INDEX IF NOT EXISTS idx_amazon_sync_feeds_two_phase_pending
ON amazon_sync_feeds (user_id, two_phase_step)
WHERE two_phase_step IS NOT NULL
  AND two_phase_step NOT IN ('complete', 'failed');

-- Comment explaining the columns
COMMENT ON COLUMN amazon_sync_feeds.two_phase_step IS 'Current step in two-phase sync: price_submitted, price_polling, price_verifying, quantity_submitted, quantity_polling, complete, failed';
COMMENT ON COLUMN amazon_sync_feeds.two_phase_started_at IS 'When two-phase sync started';
COMMENT ON COLUMN amazon_sync_feeds.two_phase_last_poll_at IS 'Last time the two-phase sync was polled for progress';
COMMENT ON COLUMN amazon_sync_feeds.two_phase_poll_count IS 'Number of times two-phase sync has been polled';
COMMENT ON COLUMN amazon_sync_feeds.two_phase_user_email IS 'User email for notifications when two-phase sync completes';
COMMENT ON COLUMN amazon_sync_feeds.quantity_feed_id IS 'Reference to the quantity feed created in phase 2';
