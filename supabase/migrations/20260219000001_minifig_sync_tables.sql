-- Minifig Sync Tables
-- Migration: 20260219000001_minifig_sync_tables
-- Feature: ebay-minifig-sync
-- Tables: minifig_sync_items, minifig_price_cache, minifig_removal_queue, minifig_sync_jobs, minifig_sync_config

-- ============================================================================
-- 1. MINIFIG SYNC ITEMS (main tracking table)
-- ============================================================================
CREATE TABLE IF NOT EXISTS minifig_sync_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id),

  -- Bricqer source
  bricqer_item_id VARCHAR(100) NOT NULL UNIQUE,
  bricklink_id VARCHAR(50),
  name TEXT NOT NULL,
  condition_notes TEXT,
  bricqer_price DECIMAL(10,2),
  bricqer_image_url TEXT,

  -- eBay market research
  ebay_avg_sold_price DECIMAL(10,2),
  ebay_min_sold_price DECIMAL(10,2),
  ebay_max_sold_price DECIMAL(10,2),
  ebay_sold_count INTEGER,
  ebay_active_count INTEGER,
  ebay_sell_through_rate DECIMAL(5,2),
  ebay_avg_shipping DECIMAL(10,2),
  ebay_research_date TIMESTAMPTZ,

  -- Listing decision
  meets_threshold BOOLEAN DEFAULT FALSE,
  recommended_price DECIMAL(10,2),

  -- eBay listing (once created)
  ebay_sku VARCHAR(50),
  ebay_inventory_item_id VARCHAR(100),
  ebay_offer_id VARCHAR(100),
  ebay_listing_id VARCHAR(50),
  ebay_listing_url TEXT,
  listing_status VARCHAR(30) DEFAULT 'NOT_LISTED',

  -- Images
  images JSONB DEFAULT '[]'::jsonb,

  -- Metadata
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  last_synced_at TIMESTAMPTZ
);

-- Indexes
CREATE INDEX idx_minifig_sync_bricqer ON minifig_sync_items(bricqer_item_id);
CREATE INDEX idx_minifig_sync_ebay ON minifig_sync_items(ebay_listing_id);
CREATE INDEX idx_minifig_sync_status ON minifig_sync_items(listing_status);
CREATE INDEX idx_minifig_sync_sku ON minifig_sync_items(ebay_sku);
CREATE INDEX idx_minifig_sync_bricklink ON minifig_sync_items(bricklink_id);

-- ============================================================================
-- 2. MINIFIG PRICE CACHE (6-month TTL pricing cache)
-- ============================================================================
CREATE TABLE IF NOT EXISTS minifig_price_cache (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bricklink_id VARCHAR(50) NOT NULL UNIQUE,

  -- Terapeak data
  terapeak_avg_sold_price DECIMAL(10,2),
  terapeak_min_sold_price DECIMAL(10,2),
  terapeak_max_sold_price DECIMAL(10,2),
  terapeak_sold_count INTEGER,
  terapeak_active_count INTEGER,
  terapeak_sell_through_rate DECIMAL(5,2),
  terapeak_avg_shipping DECIMAL(10,2),
  terapeak_raw_data JSONB,

  -- BrickLink data (supplementary)
  bricklink_avg_sold_price DECIMAL(10,2),
  bricklink_sold_count INTEGER,

  -- Cache control
  researched_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '6 months'),
  source VARCHAR(20) NOT NULL DEFAULT 'terapeak',

  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes
CREATE INDEX idx_price_cache_bricklink ON minifig_price_cache(bricklink_id);
CREATE INDEX idx_price_cache_expires ON minifig_price_cache(expires_at);

-- ============================================================================
-- 3. MINIFIG REMOVAL QUEUE (sale removal approval queue)
-- ============================================================================
CREATE TABLE IF NOT EXISTS minifig_removal_queue (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id),
  minifig_sync_id UUID NOT NULL REFERENCES minifig_sync_items(id),

  -- Sale details
  sold_on VARCHAR(20) NOT NULL,
  sale_price DECIMAL(10,2),
  sale_date TIMESTAMPTZ,
  order_id VARCHAR(100),
  order_url TEXT,

  -- Removal target
  remove_from VARCHAR(20) NOT NULL,
  removal_details JSONB,

  -- Review state
  status VARCHAR(20) DEFAULT 'PENDING',
  reviewed_at TIMESTAMPTZ,
  executed_at TIMESTAMPTZ,
  error_message TEXT,
  notes TEXT,

  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes
CREATE INDEX idx_removal_queue_status ON minifig_removal_queue(status);
CREATE INDEX idx_removal_queue_sync ON minifig_removal_queue(minifig_sync_id);

-- ============================================================================
-- 4. MINIFIG SYNC JOBS (job execution tracking)
-- ============================================================================
CREATE TABLE IF NOT EXISTS minifig_sync_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id),
  job_type VARCHAR(30) NOT NULL,
  status VARCHAR(20) DEFAULT 'PENDING',
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  items_processed INTEGER DEFAULT 0,
  items_created INTEGER DEFAULT 0,
  items_updated INTEGER DEFAULT 0,
  items_errored INTEGER DEFAULT 0,
  error_log JSONB DEFAULT '[]'::jsonb,
  last_poll_cursor TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes
CREATE INDEX idx_sync_jobs_type ON minifig_sync_jobs(job_type);
CREATE INDEX idx_sync_jobs_status ON minifig_sync_jobs(status);

-- ============================================================================
-- 5. MINIFIG SYNC CONFIG (configurable thresholds)
-- ============================================================================
CREATE TABLE IF NOT EXISTS minifig_sync_config (
  key VARCHAR(50) PRIMARY KEY,
  value JSONB NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Seed default values
INSERT INTO minifig_sync_config (key, value) VALUES
  ('min_bricqer_listing_price', '3.00'),
  ('min_sold_count', '3'),
  ('min_sell_through_rate', '30'),
  ('min_avg_sold_price', '3.00'),
  ('min_estimated_profit', '1.50'),
  ('packaging_cost', '0.50'),
  ('ebay_fvf_rate', '0.128'),
  ('price_cache_months', '6'),
  ('reprice_after_days', '85'),
  ('poll_interval_minutes', '15');

-- ============================================================================
-- RLS POLICIES
-- ============================================================================

-- Enable RLS on all tables
ALTER TABLE minifig_sync_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE minifig_price_cache ENABLE ROW LEVEL SECURITY;
ALTER TABLE minifig_removal_queue ENABLE ROW LEVEL SECURITY;
ALTER TABLE minifig_sync_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE minifig_sync_config ENABLE ROW LEVEL SECURITY;

-- minifig_sync_items: user-scoped
CREATE POLICY "Users can view own minifig sync items"
  ON minifig_sync_items FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own minifig sync items"
  ON minifig_sync_items FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own minifig sync items"
  ON minifig_sync_items FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own minifig sync items"
  ON minifig_sync_items FOR DELETE
  USING (auth.uid() = user_id);

-- minifig_price_cache: all authenticated users can read/write (shared cache)
CREATE POLICY "Authenticated users can view price cache"
  ON minifig_price_cache FOR SELECT
  USING (auth.role() = 'authenticated');

CREATE POLICY "Authenticated users can insert price cache"
  ON minifig_price_cache FOR INSERT
  WITH CHECK (auth.role() = 'authenticated');

CREATE POLICY "Authenticated users can update price cache"
  ON minifig_price_cache FOR UPDATE
  USING (auth.role() = 'authenticated');

-- minifig_removal_queue: user-scoped
CREATE POLICY "Users can view own removal queue"
  ON minifig_removal_queue FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own removal queue"
  ON minifig_removal_queue FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own removal queue"
  ON minifig_removal_queue FOR UPDATE
  USING (auth.uid() = user_id);

-- minifig_sync_jobs: user-scoped
CREATE POLICY "Users can view own sync jobs"
  ON minifig_sync_jobs FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own sync jobs"
  ON minifig_sync_jobs FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own sync jobs"
  ON minifig_sync_jobs FOR UPDATE
  USING (auth.uid() = user_id);

-- minifig_sync_config: all authenticated can read, write
CREATE POLICY "Authenticated users can view config"
  ON minifig_sync_config FOR SELECT
  USING (auth.role() = 'authenticated');

CREATE POLICY "Authenticated users can update config"
  ON minifig_sync_config FOR UPDATE
  USING (auth.role() = 'authenticated');

CREATE POLICY "Authenticated users can insert config"
  ON minifig_sync_config FOR INSERT
  WITH CHECK (auth.role() = 'authenticated');
