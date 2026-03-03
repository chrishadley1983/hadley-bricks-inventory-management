-- Migration: 20260303000001_bricklink_store_deals
-- Description: Add tables for BrickLink store deal finder
-- Feature: bricklink-store-deal-finder

-- ============================================================================
-- Table 1: excluded_bricklink_stores
-- Stores excluded from deal finder by user (store-level, not per-set)
-- ============================================================================

CREATE TABLE excluded_bricklink_stores (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  store_name VARCHAR(200) NOT NULL,
  reason VARCHAR(50),
  excluded_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,

  UNIQUE(user_id, store_name)
);

CREATE INDEX idx_excluded_bl_stores_user ON excluded_bricklink_stores(user_id);

ALTER TABLE excluded_bricklink_stores ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own excluded BL stores"
  ON excluded_bricklink_stores FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own excluded BL stores"
  ON excluded_bricklink_stores FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own excluded BL stores"
  ON excluded_bricklink_stores FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);

-- Service role full access for background jobs
CREATE POLICY "Service role full access to excluded BL stores"
  ON excluded_bricklink_stores FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

COMMENT ON TABLE excluded_bricklink_stores IS 'BrickLink stores excluded from deal finder by user';
COMMENT ON COLUMN excluded_bricklink_stores.store_name IS 'BrickLink store display name';
COMMENT ON COLUMN excluded_bricklink_stores.reason IS 'e.g. high minimum, expensive shipping, wont ship UK, bad packaging, unreliable';

-- ============================================================================
-- Table 2: bricklink_store_listings
-- Scraped per-store listing data from BrickLink catalog pages
-- ============================================================================

CREATE TABLE bricklink_store_listings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  bricklink_set_number VARCHAR(20) NOT NULL,

  -- Store info
  store_name VARCHAR(200) NOT NULL,
  store_country VARCHAR(50),
  store_feedback DECIMAL(5,2),

  -- Listing details
  unit_price DECIMAL(10,2) NOT NULL,
  quantity INTEGER NOT NULL DEFAULT 1,
  min_buy DECIMAL(10,2),
  ships_to_uk BOOLEAN,
  condition VARCHAR(5) DEFAULT 'N',
  currency_code VARCHAR(5) DEFAULT 'GBP',

  -- Shipping estimate (heuristic)
  estimated_shipping DECIMAL(10,2),
  estimated_total DECIMAL(10,2),
  shipping_tier VARCHAR(10) CHECK (shipping_tier IN ('uk', 'eu', 'row')),

  -- Scrape metadata
  scraped_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,

  UNIQUE(user_id, bricklink_set_number, store_name)
);

CREATE INDEX idx_bl_store_listings_user_set
  ON bricklink_store_listings(user_id, bricklink_set_number);

CREATE INDEX idx_bl_store_listings_scraped
  ON bricklink_store_listings(user_id, scraped_at);

ALTER TABLE bricklink_store_listings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own BL store listings"
  ON bricklink_store_listings FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own BL store listings"
  ON bricklink_store_listings FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own BL store listings"
  ON bricklink_store_listings FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own BL store listings"
  ON bricklink_store_listings FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);

-- Service role full access for background jobs
CREATE POLICY "Service role full access to BL store listings"
  ON bricklink_store_listings FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

COMMENT ON TABLE bricklink_store_listings IS 'Scraped BrickLink store listing data for deal finder';
COMMENT ON COLUMN bricklink_store_listings.store_feedback IS 'Store feedback percentage (e.g. 99.80)';
COMMENT ON COLUMN bricklink_store_listings.min_buy IS 'Store minimum order amount in their currency';
COMMENT ON COLUMN bricklink_store_listings.ships_to_uk IS 'Whether the store ships to UK (green/red indicator)';
COMMENT ON COLUMN bricklink_store_listings.estimated_shipping IS 'Heuristic shipping estimate based on store country';
COMMENT ON COLUMN bricklink_store_listings.estimated_total IS 'unit_price + estimated_shipping';
COMMENT ON COLUMN bricklink_store_listings.shipping_tier IS 'uk, eu, or row - used for heuristic';

-- ============================================================================
-- Update arbitrage_sync_status job_type constraint
-- ============================================================================

ALTER TABLE arbitrage_sync_status
  DROP CONSTRAINT IF EXISTS arbitrage_sync_status_job_type_check;

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
    'bricklink_scheduled_pricing',
    'ebay_fp_cleanup',
    'bricklink_store_scrape'
  ));
