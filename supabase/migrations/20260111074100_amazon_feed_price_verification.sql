-- Amazon Feed Price Verification Status
-- Migration: 20260111074100_amazon_feed_price_verification
--
-- Amazon processes listings in stages with delays:
-- 1. Listing created (immediate)
-- 2. Quantity updated (~few minutes)
-- 3. Price applied (~up to 30 minutes)
--
-- This migration adds statuses to track price verification.

-- ============================================================================
-- UPDATE FEED STATUS ENUM
-- ============================================================================

-- Drop the existing constraint
ALTER TABLE amazon_sync_feeds
  DROP CONSTRAINT IF EXISTS amazon_sync_feeds_status_check;

-- Add new constraint with additional statuses
ALTER TABLE amazon_sync_feeds
  ADD CONSTRAINT amazon_sync_feeds_status_check
  CHECK (status IN (
    'pending',              -- Not yet submitted
    'submitted',            -- Submitted to Amazon, awaiting processing
    'processing',           -- Amazon is processing
    'done',                 -- Amazon completed processing (legacy - messages accepted)
    'done_verifying',       -- Feed done, verifying price on Amazon (up to 30 min)
    'verified',             -- Price verified on Amazon - fully complete
    'verification_failed',  -- Price not set correctly after verification period
    'cancelled',            -- Cancelled by Amazon
    'fatal',                -- Amazon returned fatal error
    'error',                -- Client-side error
    'processing_timeout'    -- Polling timed out after 15 minutes
  ));

-- ============================================================================
-- ADD VERIFICATION TRACKING COLUMNS
-- ============================================================================

-- Add columns for price verification
ALTER TABLE amazon_sync_feeds
  ADD COLUMN IF NOT EXISTS verification_started_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS verification_completed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS verification_attempts INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_verification_at TIMESTAMPTZ;

-- ============================================================================
-- UPDATE FEED ITEMS STATUS ENUM
-- ============================================================================

-- Drop the existing constraint
ALTER TABLE amazon_sync_feed_items
  DROP CONSTRAINT IF EXISTS amazon_sync_feed_items_status_check;

-- Add new constraint with additional statuses
ALTER TABLE amazon_sync_feed_items
  ADD CONSTRAINT amazon_sync_feed_items_status_check
  CHECK (status IN (
    'pending',              -- Awaiting result
    'accepted',             -- Amazon accepted the message
    'verifying',            -- Verifying price/quantity on Amazon
    'success',              -- Successfully updated and verified
    'warning',              -- Updated with warnings
    'error',                -- Failed to update
    'verification_failed'   -- Price/quantity not applied after timeout
  ));

-- ============================================================================
-- ADD VERIFICATION COLUMNS TO FEED ITEMS
-- ============================================================================

-- Add is_new_sku flag to track which items need price verification
ALTER TABLE amazon_sync_feed_items
  ADD COLUMN IF NOT EXISTS is_new_sku BOOLEAN DEFAULT false;

-- Add columns for per-item verification
ALTER TABLE amazon_sync_feed_items
  ADD COLUMN IF NOT EXISTS verified_price DECIMAL(10,2),
  ADD COLUMN IF NOT EXISTS verified_quantity INTEGER,
  ADD COLUMN IF NOT EXISTS price_verified BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS quantity_verified BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS verification_error TEXT;

COMMENT ON COLUMN amazon_sync_feed_items.is_new_sku IS 'True if this was a new SKU creation (needs price verification)';

-- ============================================================================
-- INDEX FOR VERIFICATION QUERIES
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_amazon_sync_feeds_verifying
  ON amazon_sync_feeds(user_id, status, verification_started_at)
  WHERE status IN ('done_verifying');

-- ============================================================================
-- COMMENTS
-- ============================================================================

COMMENT ON COLUMN amazon_sync_feeds.verification_started_at IS 'When price verification started (after feed marked done)';
COMMENT ON COLUMN amazon_sync_feeds.verification_completed_at IS 'When price verification completed (success or failure)';
COMMENT ON COLUMN amazon_sync_feeds.verification_attempts IS 'Number of verification attempts made';
COMMENT ON COLUMN amazon_sync_feeds.last_verification_at IS 'Timestamp of last verification attempt';

COMMENT ON COLUMN amazon_sync_feed_items.verified_price IS 'Actual price on Amazon after verification';
COMMENT ON COLUMN amazon_sync_feed_items.verified_quantity IS 'Actual quantity on Amazon after verification';
COMMENT ON COLUMN amazon_sync_feed_items.price_verified IS 'Whether price matches submitted value';
COMMENT ON COLUMN amazon_sync_feed_items.quantity_verified IS 'Whether quantity matches submitted value';
COMMENT ON COLUMN amazon_sync_feed_items.verification_error IS 'Error message if verification failed';
