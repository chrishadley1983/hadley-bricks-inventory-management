-- Two-Phase Amazon Sync
-- Adds support for submitting price and quantity separately to prevent
-- race condition where quantity updates before price propagates

-- Add two-phase sync tracking columns to amazon_sync_feeds
ALTER TABLE amazon_sync_feeds
ADD COLUMN IF NOT EXISTS sync_mode TEXT DEFAULT 'single' CHECK (sync_mode IN ('single', 'two_phase')),
ADD COLUMN IF NOT EXISTS phase TEXT CHECK (phase IN ('price', 'quantity', NULL)),
ADD COLUMN IF NOT EXISTS parent_feed_id UUID REFERENCES amazon_sync_feeds(id),
ADD COLUMN IF NOT EXISTS price_verified_at TIMESTAMPTZ;

-- Add index for parent-child feed relationships
CREATE INDEX IF NOT EXISTS idx_amazon_sync_feeds_parent
ON amazon_sync_feeds(parent_feed_id)
WHERE parent_feed_id IS NOT NULL;

-- Add two-phase tracking to feed items
ALTER TABLE amazon_sync_feed_items
ADD COLUMN IF NOT EXISTS phase TEXT CHECK (phase IN ('price', 'quantity', NULL)),
ADD COLUMN IF NOT EXISTS price_feed_id UUID REFERENCES amazon_sync_feeds(id),
ADD COLUMN IF NOT EXISTS quantity_feed_id UUID REFERENCES amazon_sync_feeds(id);

-- Add comments for documentation
COMMENT ON COLUMN amazon_sync_feeds.sync_mode IS 'single = current behavior, two_phase = price then quantity';
COMMENT ON COLUMN amazon_sync_feeds.phase IS 'For two_phase mode: which phase this feed represents';
COMMENT ON COLUMN amazon_sync_feeds.parent_feed_id IS 'Links quantity feed to its parent price feed';
COMMENT ON COLUMN amazon_sync_feeds.price_verified_at IS 'Timestamp when price was verified live on Amazon';

-- Add new status values for two-phase sync
-- The existing status column already allows text, so we just need to document the new values:
-- 'price_verifying' - Waiting for price to propagate on Amazon
-- 'verification_failed' - Price verification timed out
-- 'verified' - Price confirmed live, ready for quantity phase
