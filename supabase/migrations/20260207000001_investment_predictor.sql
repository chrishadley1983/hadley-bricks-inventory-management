-- Investment Predictor - Phase 1: Data Foundation + Retirement Tracking
-- Migration: 20260207000001_investment_predictor
-- Purpose: Extend brickset_sets with investment columns, create retirement_sources and price_snapshots tables

-- ============================================================================
-- EXTEND BRICKSET_SETS WITH INVESTMENT COLUMNS
-- ============================================================================

-- Investment classification
ALTER TABLE brickset_sets ADD COLUMN IF NOT EXISTS exclusivity_tier TEXT;
ALTER TABLE brickset_sets ADD COLUMN IF NOT EXISTS is_licensed BOOLEAN;
ALTER TABLE brickset_sets ADD COLUMN IF NOT EXISTS is_ucs BOOLEAN;
ALTER TABLE brickset_sets ADD COLUMN IF NOT EXISTS is_modular BOOLEAN;

-- Amazon tracking
ALTER TABLE brickset_sets ADD COLUMN IF NOT EXISTS amazon_asin TEXT;
ALTER TABLE brickset_sets ADD COLUMN IF NOT EXISTS has_amazon_listing BOOLEAN;

-- Retirement tracking (rollup from retirement_sources)
ALTER TABLE brickset_sets ADD COLUMN IF NOT EXISTS retirement_status TEXT;
ALTER TABLE brickset_sets ADD COLUMN IF NOT EXISTS expected_retirement_date DATE;
ALTER TABLE brickset_sets ADD COLUMN IF NOT EXISTS retirement_confidence TEXT;

-- Rebrickable data source tracking
ALTER TABLE brickset_sets ADD COLUMN IF NOT EXISTS rebrickable_set_num TEXT;
ALTER TABLE brickset_sets ADD COLUMN IF NOT EXISTS rebrickable_last_synced_at TIMESTAMPTZ;

-- Constraints
ALTER TABLE brickset_sets ADD CONSTRAINT chk_exclusivity_tier
  CHECK (exclusivity_tier IS NULL OR exclusivity_tier IN ('standard', 'lego_exclusive', 'retailer_exclusive', 'event_exclusive'));

ALTER TABLE brickset_sets ADD CONSTRAINT chk_retirement_status
  CHECK (retirement_status IS NULL OR retirement_status IN ('available', 'retiring_soon', 'retired'));

ALTER TABLE brickset_sets ADD CONSTRAINT chk_retirement_confidence
  CHECK (retirement_confidence IS NULL OR retirement_confidence IN ('confirmed', 'likely', 'speculative'));

-- Indexes for investment queries
CREATE INDEX IF NOT EXISTS idx_brickset_sets_retirement_status ON brickset_sets(retirement_status) WHERE retirement_status IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_brickset_sets_expected_retirement ON brickset_sets(expected_retirement_date) WHERE expected_retirement_date IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_brickset_sets_amazon_asin ON brickset_sets(amazon_asin) WHERE amazon_asin IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_brickset_sets_rebrickable ON brickset_sets(rebrickable_set_num) WHERE rebrickable_set_num IS NOT NULL;

-- ============================================================================
-- RETIREMENT SOURCES TABLE
-- ============================================================================

CREATE TABLE retirement_sources (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  set_num TEXT NOT NULL,
  source TEXT NOT NULL,
  expected_retirement_date DATE,
  status TEXT,
  confidence TEXT NOT NULL DEFAULT 'speculative',
  raw_data JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,

  -- Constraints
  CONSTRAINT chk_retirement_source CHECK (source IN ('brickset', 'bricktap', 'brickfanatics', 'stonewars', 'brickeconomy', 'lego_official')),
  CONSTRAINT chk_retirement_source_confidence CHECK (confidence IN ('confirmed', 'likely', 'speculative')),
  CONSTRAINT chk_retirement_source_status CHECK (status IS NULL OR status IN ('available', 'retiring_soon', 'sold_out', 'retired')),

  -- One entry per set per source
  UNIQUE(set_num, source)
);

-- Indexes
CREATE INDEX idx_retirement_sources_set_num ON retirement_sources(set_num);
CREATE INDEX idx_retirement_sources_source ON retirement_sources(source);
CREATE INDEX idx_retirement_sources_date ON retirement_sources(expected_retirement_date) WHERE expected_retirement_date IS NOT NULL;

-- Updated_at trigger
CREATE TRIGGER update_retirement_sources_updated_at
  BEFORE UPDATE ON retirement_sources
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- RLS: Public read (retirement data is not user-specific)
ALTER TABLE retirement_sources ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can view retirement sources"
  ON retirement_sources FOR SELECT
  USING (true);

-- ============================================================================
-- PRICE SNAPSHOTS TABLE (for future price history tracking)
-- ============================================================================

CREATE TABLE price_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  set_num TEXT NOT NULL,
  date DATE NOT NULL,
  source TEXT NOT NULL,
  price_gbp DECIMAL(10,2),
  sales_rank INTEGER,
  seller_count INTEGER,
  buy_box_winner TEXT,
  raw_data JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,

  -- Constraints
  CONSTRAINT chk_price_snapshot_source CHECK (source IN ('amazon_buybox', 'amazon_was', 'bricklink_new', 'bricklink_used', 'brickset_retail')),

  -- One snapshot per set per source per day
  UNIQUE(set_num, date, source)
);

-- Indexes
CREATE INDEX idx_price_snapshots_set_num ON price_snapshots(set_num);
CREATE INDEX idx_price_snapshots_date ON price_snapshots(date);
CREATE INDEX idx_price_snapshots_set_date ON price_snapshots(set_num, date);

-- RLS: Public read
ALTER TABLE price_snapshots ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can view price snapshots"
  ON price_snapshots FOR SELECT
  USING (true);

-- ============================================================================
-- COMMENTS
-- ============================================================================

COMMENT ON COLUMN brickset_sets.exclusivity_tier IS 'Investment classification: standard, lego_exclusive, retailer_exclusive, event_exclusive';
COMMENT ON COLUMN brickset_sets.is_licensed IS 'Whether set is a licensed theme (Star Wars, Marvel, etc.)';
COMMENT ON COLUMN brickset_sets.is_ucs IS 'Whether set is Ultimate Collector Series';
COMMENT ON COLUMN brickset_sets.is_modular IS 'Whether set is a Modular Building';
COMMENT ON COLUMN brickset_sets.amazon_asin IS 'Amazon UK ASIN for price tracking';
COMMENT ON COLUMN brickset_sets.has_amazon_listing IS 'Whether set has an active Amazon UK listing';
COMMENT ON COLUMN brickset_sets.retirement_status IS 'Rollup status: available, retiring_soon, retired (derived from retirement_sources)';
COMMENT ON COLUMN brickset_sets.expected_retirement_date IS 'Best estimate of retirement date from highest-confidence source';
COMMENT ON COLUMN brickset_sets.retirement_confidence IS 'Confidence level of retirement date: confirmed, likely, speculative';
COMMENT ON COLUMN brickset_sets.rebrickable_set_num IS 'Rebrickable set number (e.g., 75192-1)';
COMMENT ON COLUMN brickset_sets.rebrickable_last_synced_at IS 'When this set was last synced from Rebrickable';

COMMENT ON TABLE retirement_sources IS 'Per-source retirement date tracking for investment analysis';
COMMENT ON COLUMN retirement_sources.set_num IS 'Set number matching brickset_sets.set_number';
COMMENT ON COLUMN retirement_sources.source IS 'Data source: brickset, bricktap, brickfanatics, stonewars, brickeconomy, lego_official';
COMMENT ON COLUMN retirement_sources.confidence IS 'Source reliability: confirmed (official), likely (multiple sources), speculative (single source)';
COMMENT ON COLUMN retirement_sources.raw_data IS 'Raw scraped/API data for audit trail';

COMMENT ON TABLE price_snapshots IS 'Historical price data for investment tracking (populated in future phase)';
COMMENT ON COLUMN price_snapshots.set_num IS 'Set number matching brickset_sets.set_number';
COMMENT ON COLUMN price_snapshots.source IS 'Price source: amazon_buybox, amazon_was, bricklink_new, bricklink_used, brickset_retail';
COMMENT ON COLUMN price_snapshots.sales_rank IS 'Amazon BSR (Best Seller Rank) at time of snapshot';
COMMENT ON COLUMN price_snapshots.buy_box_winner IS 'Who holds the Amazon buy box: FBA, FBM, Amazon';
