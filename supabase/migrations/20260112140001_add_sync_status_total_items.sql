-- Add total_items column to arbitrage_sync_status for progress tracking
ALTER TABLE arbitrage_sync_status
ADD COLUMN IF NOT EXISTS total_items INTEGER;

COMMENT ON COLUMN arbitrage_sync_status.total_items IS 'Total items to process in the current job run (for progress tracking)';
