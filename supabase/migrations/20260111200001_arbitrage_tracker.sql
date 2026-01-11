-- Arbitrage Tracker tables for Amazon vs BrickLink price comparison
-- Migration: 20260111200001_arbitrage_tracker

-- ============================================================================
-- TRACKED ASINS TABLE
-- Primary table for all ASINs being monitored
-- ============================================================================
CREATE TABLE tracked_asins (
  asin VARCHAR(10) PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,

  -- Source information
  source VARCHAR(20) NOT NULL CHECK (source IN ('inventory', 'discovery', 'manual')),
  status VARCHAR(20) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'excluded', 'pending_review')),

  -- Product details (from Amazon)
  name VARCHAR(500),
  image_url VARCHAR(1000),
  sku VARCHAR(100),

  -- Tracking timestamps
  added_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  excluded_at TIMESTAMPTZ,
  exclusion_reason VARCHAR(500),
  last_synced_at TIMESTAMPTZ,

  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

COMMENT ON TABLE tracked_asins IS 'ASINs being tracked for arbitrage opportunities';
COMMENT ON COLUMN tracked_asins.source IS 'How ASIN was added: inventory (from Amazon inventory), discovery (Phase 2), manual (user added)';
COMMENT ON COLUMN tracked_asins.status IS 'active = being tracked, excluded = user excluded, pending_review = discovered but not reviewed';

-- Indexes
CREATE INDEX idx_tracked_asins_user ON tracked_asins(user_id);
CREATE INDEX idx_tracked_asins_status ON tracked_asins(user_id, status);
CREATE INDEX idx_tracked_asins_source ON tracked_asins(user_id, source);

-- ============================================================================
-- AMAZON PRICING TABLE
-- Historical pricing snapshots from Amazon
-- ============================================================================
CREATE TABLE amazon_arbitrage_pricing (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  asin VARCHAR(10) NOT NULL REFERENCES tracked_asins(asin) ON DELETE CASCADE,
  snapshot_date DATE NOT NULL,

  -- Pricing data
  your_price DECIMAL(10,2),
  your_qty INTEGER DEFAULT 0,
  buy_box_price DECIMAL(10,2),
  buy_box_is_yours BOOLEAN DEFAULT FALSE,
  offer_count INTEGER,

  -- Historical/reference pricing
  was_price_90d DECIMAL(10,2),

  -- Sales rank
  sales_rank INTEGER,
  sales_rank_category VARCHAR(100),

  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,

  UNIQUE(asin, snapshot_date)
);

COMMENT ON TABLE amazon_arbitrage_pricing IS 'Daily pricing snapshots from Amazon for arbitrage tracking';
COMMENT ON COLUMN amazon_arbitrage_pricing.was_price_90d IS '90-day median price from historical snapshots or Amazon reference';

-- Indexes
CREATE INDEX idx_amazon_arbitrage_pricing_user ON amazon_arbitrage_pricing(user_id);
CREATE INDEX idx_amazon_arbitrage_pricing_asin_date ON amazon_arbitrage_pricing(asin, snapshot_date DESC);

-- ============================================================================
-- ASIN BRICKLINK MAPPING TABLE
-- Maps Amazon ASINs to BrickLink set numbers
-- ============================================================================
CREATE TABLE asin_bricklink_mapping (
  asin VARCHAR(10) PRIMARY KEY REFERENCES tracked_asins(asin) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,

  -- BrickLink reference
  bricklink_set_number VARCHAR(20) NOT NULL,

  -- Mapping confidence
  match_confidence VARCHAR(20) NOT NULL CHECK (match_confidence IN ('exact', 'probable', 'manual')),
  match_method VARCHAR(50),

  -- Verification
  verified_at TIMESTAMPTZ,

  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

COMMENT ON TABLE asin_bricklink_mapping IS 'Maps Amazon ASINs to BrickLink set numbers';
COMMENT ON COLUMN asin_bricklink_mapping.match_confidence IS 'exact = title contains set number format, probable = fuzzy match, manual = user linked';
COMMENT ON COLUMN asin_bricklink_mapping.match_method IS 'Description of how the match was made (regex pattern, API lookup, etc.)';

-- Indexes
CREATE INDEX idx_mapping_user ON asin_bricklink_mapping(user_id);
CREATE INDEX idx_mapping_set_number ON asin_bricklink_mapping(user_id, bricklink_set_number);

-- ============================================================================
-- BRICKLINK PRICING TABLE
-- Historical pricing snapshots from BrickLink
-- ============================================================================
CREATE TABLE bricklink_arbitrage_pricing (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  bricklink_set_number VARCHAR(20) NOT NULL,
  snapshot_date DATE NOT NULL,

  -- Condition and location filters
  condition VARCHAR(10) NOT NULL DEFAULT 'N' CHECK (condition IN ('N', 'U')),
  country_code VARCHAR(5) NOT NULL DEFAULT 'UK',

  -- Pricing stats
  min_price DECIMAL(10,2),
  avg_price DECIMAL(10,2),
  max_price DECIMAL(10,2),
  qty_avg_price DECIMAL(10,2),

  -- Availability
  total_lots INTEGER,
  total_qty INTEGER,

  -- Detailed price breakdown (from price_detail array in API response)
  price_detail_json JSONB,

  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,

  UNIQUE(user_id, bricklink_set_number, snapshot_date, condition, country_code)
);

COMMENT ON TABLE bricklink_arbitrage_pricing IS 'Daily pricing snapshots from BrickLink for arbitrage tracking';
COMMENT ON COLUMN bricklink_arbitrage_pricing.price_detail_json IS 'Array of {quantity, unit_price, seller_country_code} from BrickLink API';

-- Indexes
CREATE INDEX idx_bricklink_arbitrage_pricing_user ON bricklink_arbitrage_pricing(user_id);
CREATE INDEX idx_bricklink_arbitrage_pricing_set_date ON bricklink_arbitrage_pricing(user_id, bricklink_set_number, snapshot_date DESC);

-- ============================================================================
-- ARBITRAGE SYNC STATUS TABLE
-- Track sync job status and timing
-- ============================================================================
CREATE TABLE arbitrage_sync_status (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,

  -- Job identification
  job_type VARCHAR(50) NOT NULL CHECK (job_type IN (
    'inventory_asins',
    'amazon_pricing',
    'bricklink_pricing',
    'asin_mapping'
  )),

  -- Status
  status VARCHAR(20) NOT NULL DEFAULT 'idle' CHECK (status IN (
    'idle',
    'running',
    'completed',
    'failed'
  )),

  -- Timing
  last_run_at TIMESTAMPTZ,
  last_success_at TIMESTAMPTZ,
  next_scheduled_at TIMESTAMPTZ,

  -- Statistics
  last_run_duration_ms INTEGER,
  items_processed INTEGER DEFAULT 0,
  items_failed INTEGER DEFAULT 0,

  -- Error info
  error_message TEXT,
  error_details JSONB,

  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,

  UNIQUE(user_id, job_type)
);

COMMENT ON TABLE arbitrage_sync_status IS 'Tracks sync job status for each job type per user';

-- Indexes
CREATE INDEX idx_arbitrage_sync_status_user ON arbitrage_sync_status(user_id);

-- ============================================================================
-- ARBITRAGE CURRENT VIEW
-- Denormalized view for fast UI queries
-- ============================================================================
CREATE OR REPLACE VIEW arbitrage_current_view AS
SELECT
  t.asin,
  t.user_id,
  t.name,
  t.image_url,
  t.sku,
  t.source,
  t.status,
  m.bricklink_set_number,
  m.match_confidence,

  -- Amazon latest
  ap.your_price,
  ap.your_qty,
  ap.buy_box_price,
  ap.buy_box_is_yours,
  ap.offer_count,
  ap.was_price_90d,
  ap.sales_rank,
  ap.sales_rank_category,
  ap.snapshot_date as amazon_snapshot_date,

  -- BrickLink latest (New, UK)
  bp.min_price as bl_min_price,
  bp.avg_price as bl_avg_price,
  bp.max_price as bl_max_price,
  bp.total_lots as bl_total_lots,
  bp.total_qty as bl_total_qty,
  bp.price_detail_json as bl_price_detail,
  bp.snapshot_date as bl_snapshot_date,

  -- Calculated margin
  CASE
    WHEN ap.your_price > 0 AND bp.min_price > 0
    THEN ROUND(((ap.your_price - bp.min_price) / ap.your_price) * 100, 1)
    ELSE NULL
  END as margin_percent,

  CASE
    WHEN ap.your_price > 0 AND bp.min_price > 0
    THEN ROUND(ap.your_price - bp.min_price, 2)
    ELSE NULL
  END as margin_absolute

FROM tracked_asins t
LEFT JOIN asin_bricklink_mapping m ON t.asin = m.asin
LEFT JOIN LATERAL (
  SELECT * FROM amazon_arbitrage_pricing
  WHERE asin = t.asin
  ORDER BY snapshot_date DESC
  LIMIT 1
) ap ON true
LEFT JOIN LATERAL (
  SELECT * FROM bricklink_arbitrage_pricing
  WHERE bricklink_set_number = m.bricklink_set_number
    AND user_id = t.user_id
    AND condition = 'N'
    AND country_code = 'UK'
  ORDER BY snapshot_date DESC
  LIMIT 1
) bp ON true
WHERE t.status = 'active';

COMMENT ON VIEW arbitrage_current_view IS 'Denormalized view combining tracked ASINs with latest pricing from Amazon and BrickLink';

-- ============================================================================
-- ROW LEVEL SECURITY
-- ============================================================================
ALTER TABLE tracked_asins ENABLE ROW LEVEL SECURITY;
ALTER TABLE amazon_arbitrage_pricing ENABLE ROW LEVEL SECURITY;
ALTER TABLE asin_bricklink_mapping ENABLE ROW LEVEL SECURITY;
ALTER TABLE bricklink_arbitrage_pricing ENABLE ROW LEVEL SECURITY;
ALTER TABLE arbitrage_sync_status ENABLE ROW LEVEL SECURITY;

-- tracked_asins policies
CREATE POLICY "Users can view own tracked ASINs"
  ON tracked_asins FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own tracked ASINs"
  ON tracked_asins FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own tracked ASINs"
  ON tracked_asins FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own tracked ASINs"
  ON tracked_asins FOR DELETE
  USING (auth.uid() = user_id);

-- amazon_arbitrage_pricing policies
CREATE POLICY "Users can view own Amazon pricing"
  ON amazon_arbitrage_pricing FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own Amazon pricing"
  ON amazon_arbitrage_pricing FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own Amazon pricing"
  ON amazon_arbitrage_pricing FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own Amazon pricing"
  ON amazon_arbitrage_pricing FOR DELETE
  USING (auth.uid() = user_id);

-- asin_bricklink_mapping policies
CREATE POLICY "Users can view own ASIN mappings"
  ON asin_bricklink_mapping FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own ASIN mappings"
  ON asin_bricklink_mapping FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own ASIN mappings"
  ON asin_bricklink_mapping FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own ASIN mappings"
  ON asin_bricklink_mapping FOR DELETE
  USING (auth.uid() = user_id);

-- bricklink_arbitrage_pricing policies
CREATE POLICY "Users can view own BrickLink pricing"
  ON bricklink_arbitrage_pricing FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own BrickLink pricing"
  ON bricklink_arbitrage_pricing FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own BrickLink pricing"
  ON bricklink_arbitrage_pricing FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own BrickLink pricing"
  ON bricklink_arbitrage_pricing FOR DELETE
  USING (auth.uid() = user_id);

-- arbitrage_sync_status policies
CREATE POLICY "Users can view own sync status"
  ON arbitrage_sync_status FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own sync status"
  ON arbitrage_sync_status FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own sync status"
  ON arbitrage_sync_status FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own sync status"
  ON arbitrage_sync_status FOR DELETE
  USING (auth.uid() = user_id);

-- ============================================================================
-- UPDATED_AT TRIGGERS
-- ============================================================================
CREATE TRIGGER update_tracked_asins_updated_at
  BEFORE UPDATE ON tracked_asins
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_asin_bricklink_mapping_updated_at
  BEFORE UPDATE ON asin_bricklink_mapping
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_arbitrage_sync_status_updated_at
  BEFORE UPDATE ON arbitrage_sync_status
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();
