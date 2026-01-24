-- ============================================================================
-- Arbitrage Watchlist for Scheduled Pricing Sync
-- Migration: 20260124000001_arbitrage_watchlist.sql
--
-- Creates a persistent watchlist of set numbers to sync for each user,
-- enabling cursor-based daily scheduling across eBay and BrickLink APIs.
-- ============================================================================

-- ============================================================================
-- ARBITRAGE WATCHLIST TABLE
-- Stores the list of set numbers to sync for each user
-- ============================================================================
CREATE TABLE arbitrage_watchlist (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,

  -- Set identifiers
  asin VARCHAR(10),
  bricklink_set_number VARCHAR(20) NOT NULL,

  -- Source tracking (for audit/filtering)
  source VARCHAR(30) NOT NULL CHECK (source IN (
    'sold_inventory',       -- ASINs from orders sold on Amazon
    'retired_with_pricing'  -- Retired seeded ASINs with pricing data
  )),

  -- Per-record staleness tracking (when was this item last synced on each platform)
  ebay_last_synced_at TIMESTAMPTZ,
  bricklink_last_synced_at TIMESTAMPTZ,

  -- Active flag for soft-delete / filtering
  is_active BOOLEAN DEFAULT true NOT NULL,

  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,

  -- Unique constraint: one entry per user per set number
  UNIQUE(user_id, bricklink_set_number)
);

COMMENT ON TABLE arbitrage_watchlist IS 'Persistent watchlist of set numbers for scheduled eBay/BrickLink pricing sync';
COMMENT ON COLUMN arbitrage_watchlist.source IS 'How item was added: sold_inventory (Amazon order history) or retired_with_pricing (retired seeded with buy_box or was_price)';
COMMENT ON COLUMN arbitrage_watchlist.ebay_last_synced_at IS 'When eBay pricing was last synced for this specific item';
COMMENT ON COLUMN arbitrage_watchlist.bricklink_last_synced_at IS 'When BrickLink pricing was last synced for this specific item';

-- ============================================================================
-- INDEXES
-- ============================================================================

-- Primary lookup index
CREATE INDEX idx_arbitrage_watchlist_user ON arbitrage_watchlist(user_id);

-- For batch processing - get oldest synced items first
CREATE INDEX idx_arbitrage_watchlist_ebay_sync ON arbitrage_watchlist(user_id, ebay_last_synced_at NULLS FIRST)
  WHERE is_active = true;

CREATE INDEX idx_arbitrage_watchlist_bricklink_sync ON arbitrage_watchlist(user_id, bricklink_last_synced_at NULLS FIRST)
  WHERE is_active = true;

-- Filter by source
CREATE INDEX idx_arbitrage_watchlist_source ON arbitrage_watchlist(user_id, source);

-- ASIN lookup (for matching sold orders)
CREATE INDEX idx_arbitrage_watchlist_asin ON arbitrage_watchlist(user_id, asin)
  WHERE asin IS NOT NULL;

-- ============================================================================
-- TRIGGERS
-- ============================================================================
CREATE TRIGGER update_arbitrage_watchlist_updated_at
  BEFORE UPDATE ON arbitrage_watchlist
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- ============================================================================
-- ROW LEVEL SECURITY
-- ============================================================================
ALTER TABLE arbitrage_watchlist ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own arbitrage watchlist"
  ON arbitrage_watchlist FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own arbitrage watchlist"
  ON arbitrage_watchlist FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own arbitrage watchlist"
  ON arbitrage_watchlist FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own arbitrage watchlist"
  ON arbitrage_watchlist FOR DELETE
  USING (auth.uid() = user_id);

-- Service role needs full access for cron jobs
CREATE POLICY "Service role can manage all watchlists"
  ON arbitrage_watchlist FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- ============================================================================
-- UPDATE ARBITRAGE SYNC STATUS JOB TYPES
-- Add new scheduled job types for eBay and BrickLink
-- ============================================================================

-- Drop the existing constraint
ALTER TABLE arbitrage_sync_status
  DROP CONSTRAINT IF EXISTS arbitrage_sync_status_job_type_check;

-- Add the updated constraint with scheduled pricing job types
ALTER TABLE arbitrage_sync_status
  ADD CONSTRAINT arbitrage_sync_status_job_type_check
  CHECK (job_type IN (
    'inventory_asins',
    'amazon_pricing',
    'bricklink_pricing',
    'asin_mapping',
    'ebay_pricing',
    'seeded_discovery',
    'pricing_sync',
    'ebay_scheduled_pricing',
    'bricklink_scheduled_pricing'
  ));

-- ============================================================================
-- ADD CURSOR COLUMNS TO ARBITRAGE_SYNC_STATUS (if not exists)
-- These may already exist from amazon-pricing migration
-- ============================================================================

-- Add sync_date for tracking which day's sync this is
ALTER TABLE arbitrage_sync_status
  ADD COLUMN IF NOT EXISTS sync_date DATE;

COMMENT ON COLUMN arbitrage_sync_status.sync_date IS 'Date of current sync run (for cursor reset on new day)';

-- Add cursor_position for resumable syncs
ALTER TABLE arbitrage_sync_status
  ADD COLUMN IF NOT EXISTS cursor_position INTEGER DEFAULT 0;

COMMENT ON COLUMN arbitrage_sync_status.cursor_position IS 'Current offset position for resumable sync batches';

-- ============================================================================
-- HELPER VIEW: Watchlist Statistics
-- ============================================================================
CREATE OR REPLACE VIEW arbitrage_watchlist_stats AS
SELECT
  user_id,
  COUNT(*) FILTER (WHERE is_active = true) as total_active,
  COUNT(*) FILTER (WHERE source = 'sold_inventory') as sold_inventory_count,
  COUNT(*) FILTER (WHERE source = 'retired_with_pricing') as retired_with_pricing_count,
  COUNT(*) FILTER (WHERE ebay_last_synced_at IS NULL AND is_active = true) as ebay_never_synced,
  COUNT(*) FILTER (WHERE bricklink_last_synced_at IS NULL AND is_active = true) as bricklink_never_synced,
  COUNT(*) FILTER (WHERE ebay_last_synced_at < NOW() - INTERVAL '3 days' AND is_active = true) as ebay_stale,
  COUNT(*) FILTER (WHERE bricklink_last_synced_at < NOW() - INTERVAL '3 days' AND is_active = true) as bricklink_stale,
  MIN(ebay_last_synced_at) as oldest_ebay_sync,
  MIN(bricklink_last_synced_at) as oldest_bricklink_sync,
  MAX(ebay_last_synced_at) as newest_ebay_sync,
  MAX(bricklink_last_synced_at) as newest_bricklink_sync
FROM arbitrage_watchlist
GROUP BY user_id;

COMMENT ON VIEW arbitrage_watchlist_stats IS 'Summary statistics for arbitrage watchlist per user';
