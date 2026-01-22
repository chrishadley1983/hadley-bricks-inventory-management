-- Vinted Automation Tables
-- This migration creates all tables needed for the automated Vinted LEGO arbitrage system

-- ============================================================================
-- TABLE: vinted_scanner_config
-- Core configuration for the scanner
-- ============================================================================
CREATE TABLE vinted_scanner_config (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  enabled BOOLEAN NOT NULL DEFAULT false,
  paused BOOLEAN NOT NULL DEFAULT false,
  pause_reason TEXT,
  broad_sweep_cog_threshold INTEGER NOT NULL DEFAULT 40,
  watchlist_cog_threshold INTEGER NOT NULL DEFAULT 40,
  near_miss_threshold INTEGER NOT NULL DEFAULT 50,
  operating_hours_start TIME NOT NULL DEFAULT '08:00',
  operating_hours_end TIME NOT NULL DEFAULT '22:00',
  consecutive_failures INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(user_id)
);

-- ============================================================================
-- TABLE: vinted_watchlist
-- Watchlist of 200 tracked sets (100 best sellers + 100 popular retired)
-- ============================================================================
CREATE TABLE vinted_watchlist (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  set_number VARCHAR(20) NOT NULL,
  asin VARCHAR(20),
  source VARCHAR(20) NOT NULL CHECK (source IN ('best_seller', 'popular_retired')),
  sales_rank INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(user_id, set_number)
);

-- ============================================================================
-- TABLE: vinted_watchlist_stats
-- Effectiveness tracking for watchlist sets
-- ============================================================================
CREATE TABLE vinted_watchlist_stats (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  set_number VARCHAR(20) NOT NULL,
  total_scans INTEGER NOT NULL DEFAULT 0,
  listings_found INTEGER NOT NULL DEFAULT 0,
  viable_found INTEGER NOT NULL DEFAULT 0,
  near_miss_found INTEGER NOT NULL DEFAULT 0,
  last_listing_at TIMESTAMPTZ,
  last_viable_at TIMESTAMPTZ,
  first_scanned_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(user_id, set_number)
);

-- ============================================================================
-- TABLE: vinted_watchlist_exclusions
-- Manual exclusions from watchlist
-- ============================================================================
CREATE TABLE vinted_watchlist_exclusions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  set_number VARCHAR(20) NOT NULL,
  reason TEXT,
  excluded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(user_id, set_number)
);

-- ============================================================================
-- TABLE: seeded_asin_rankings
-- Sales ranks for retired set prioritisation
-- ============================================================================
CREATE TABLE seeded_asin_rankings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  seeded_asin_id UUID NOT NULL REFERENCES seeded_asins(id) ON DELETE CASCADE,
  asin VARCHAR(20) NOT NULL,
  sales_rank INTEGER,
  fetched_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================================
-- TABLE: vinted_scan_log
-- Audit trail for all scans
-- ============================================================================
CREATE TABLE vinted_scan_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  scan_type VARCHAR(20) NOT NULL CHECK (scan_type IN ('broad_sweep', 'watchlist')),
  set_number VARCHAR(20),  -- NULL for broad_sweep, set number for watchlist
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ,
  status VARCHAR(20) NOT NULL CHECK (status IN ('success', 'failed', 'partial', 'captcha')),
  listings_found INTEGER NOT NULL DEFAULT 0,
  opportunities_found INTEGER NOT NULL DEFAULT 0,
  error_message TEXT,
  timing_delay_ms INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================================
-- TABLE: vinted_opportunities
-- Found arbitrage opportunities
-- ============================================================================
CREATE TABLE vinted_opportunities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  scan_log_id UUID REFERENCES vinted_scan_log(id) ON DELETE SET NULL,
  vinted_listing_id VARCHAR(50) NOT NULL,
  vinted_url TEXT NOT NULL,
  set_number VARCHAR(20) NOT NULL,
  set_name TEXT,
  vinted_price DECIMAL(10,2) NOT NULL,
  amazon_price DECIMAL(10,2),
  asin VARCHAR(20),
  cog_percent DECIMAL(5,2),
  estimated_profit DECIMAL(10,2),
  is_viable BOOLEAN NOT NULL DEFAULT false,
  status VARCHAR(20) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'purchased', 'expired', 'dismissed')),
  listed_at TIMESTAMPTZ,
  found_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (now() + INTERVAL '7 days'),
  UNIQUE(user_id, vinted_listing_id)
);

-- ============================================================================
-- TABLE: vinted_dom_selectors
-- Maintainable CSS selectors for DOM parsing
-- ============================================================================
CREATE TABLE vinted_dom_selectors (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  selector_name VARCHAR(50) NOT NULL UNIQUE,
  selector_value TEXT NOT NULL,
  description TEXT,
  version INTEGER NOT NULL DEFAULT 1,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================================
-- INDEXES
-- Performance optimisation for common queries
-- ============================================================================

-- Config lookup by user
CREATE INDEX idx_vinted_scanner_config_user ON vinted_scanner_config(user_id);

-- Watchlist queries
CREATE INDEX idx_vinted_watchlist_user ON vinted_watchlist(user_id);
CREATE INDEX idx_vinted_watchlist_source ON vinted_watchlist(source);

-- Watchlist stats queries
CREATE INDEX idx_vinted_watchlist_stats_user ON vinted_watchlist_stats(user_id);
CREATE INDEX idx_vinted_watchlist_stats_last_viable ON vinted_watchlist_stats(last_viable_at DESC NULLS LAST);

-- Watchlist exclusions
CREATE INDEX idx_vinted_watchlist_exclusions_user ON vinted_watchlist_exclusions(user_id);

-- Sales rank queries
CREATE INDEX idx_seeded_asin_rankings_seeded_asin ON seeded_asin_rankings(seeded_asin_id);
CREATE INDEX idx_seeded_asin_rankings_asin ON seeded_asin_rankings(asin);

-- Scan log queries
CREATE INDEX idx_vinted_scan_log_user ON vinted_scan_log(user_id);
CREATE INDEX idx_vinted_scan_log_created ON vinted_scan_log(created_at DESC);
CREATE INDEX idx_vinted_scan_log_status ON vinted_scan_log(status);
CREATE INDEX idx_vinted_scan_log_type_date ON vinted_scan_log(scan_type, created_at DESC);

-- Opportunities queries
CREATE INDEX idx_vinted_opportunities_user ON vinted_opportunities(user_id);
CREATE INDEX idx_vinted_opportunities_status ON vinted_opportunities(status);
CREATE INDEX idx_vinted_opportunities_found ON vinted_opportunities(found_at DESC);
CREATE INDEX idx_vinted_opportunities_viable ON vinted_opportunities(is_viable, found_at DESC);
CREATE INDEX idx_vinted_opportunities_expires ON vinted_opportunities(expires_at);

-- DOM selectors
CREATE INDEX idx_vinted_dom_selectors_active ON vinted_dom_selectors(active, selector_name);

-- ============================================================================
-- ROW LEVEL SECURITY
-- All tables require RLS with user_id-based policies
-- ============================================================================

-- vinted_scanner_config
ALTER TABLE vinted_scanner_config ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own scanner config"
  ON vinted_scanner_config FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own scanner config"
  ON vinted_scanner_config FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own scanner config"
  ON vinted_scanner_config FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own scanner config"
  ON vinted_scanner_config FOR DELETE
  USING (auth.uid() = user_id);

-- vinted_watchlist
ALTER TABLE vinted_watchlist ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own watchlist"
  ON vinted_watchlist FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own watchlist"
  ON vinted_watchlist FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own watchlist"
  ON vinted_watchlist FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own watchlist"
  ON vinted_watchlist FOR DELETE
  USING (auth.uid() = user_id);

-- vinted_watchlist_stats
ALTER TABLE vinted_watchlist_stats ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own watchlist stats"
  ON vinted_watchlist_stats FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own watchlist stats"
  ON vinted_watchlist_stats FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own watchlist stats"
  ON vinted_watchlist_stats FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own watchlist stats"
  ON vinted_watchlist_stats FOR DELETE
  USING (auth.uid() = user_id);

-- vinted_watchlist_exclusions
ALTER TABLE vinted_watchlist_exclusions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own watchlist exclusions"
  ON vinted_watchlist_exclusions FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own watchlist exclusions"
  ON vinted_watchlist_exclusions FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own watchlist exclusions"
  ON vinted_watchlist_exclusions FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own watchlist exclusions"
  ON vinted_watchlist_exclusions FOR DELETE
  USING (auth.uid() = user_id);

-- seeded_asin_rankings - Anyone can read (no user_id), but only service role can write
ALTER TABLE seeded_asin_rankings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can view seeded_asin_rankings"
  ON seeded_asin_rankings FOR SELECT
  USING (true);

-- vinted_scan_log
ALTER TABLE vinted_scan_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own scan logs"
  ON vinted_scan_log FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own scan logs"
  ON vinted_scan_log FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own scan logs"
  ON vinted_scan_log FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own scan logs"
  ON vinted_scan_log FOR DELETE
  USING (auth.uid() = user_id);

-- vinted_opportunities
ALTER TABLE vinted_opportunities ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own opportunities"
  ON vinted_opportunities FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own opportunities"
  ON vinted_opportunities FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own opportunities"
  ON vinted_opportunities FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own opportunities"
  ON vinted_opportunities FOR DELETE
  USING (auth.uid() = user_id);

-- vinted_dom_selectors - Anyone can read, but only service role can write
ALTER TABLE vinted_dom_selectors ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can view DOM selectors"
  ON vinted_dom_selectors FOR SELECT
  USING (true);

-- ============================================================================
-- SEED DATA: Default DOM Selectors
-- ============================================================================
INSERT INTO vinted_dom_selectors (selector_name, selector_value, description) VALUES
  ('listing_card', '[data-testid="item-card"]', 'Individual listing card container'),
  ('listing_title', '.new-item-box__overlay', 'Title text within listing card'),
  ('listing_price', '[data-testid="price-text"]', 'Price element within listing card'),
  ('listing_link', 'a[href^="/items/"]', 'Link to listing detail page'),
  ('listing_image', 'img[alt*="brand"]', 'Listing thumbnail image with alt text'),
  ('pagination_next', '[data-testid="pagination-next"]', 'Next page button'),
  ('captcha_iframe', 'iframe[src*="captcha"]', 'CAPTCHA iframe element'),
  ('datadome_container', '[class*="datadome"]', 'DataDome CAPTCHA container')
ON CONFLICT (selector_name) DO NOTHING;

-- ============================================================================
-- COMMENTS
-- ============================================================================
COMMENT ON TABLE vinted_scanner_config IS 'Configuration for automated Vinted scanning';
COMMENT ON TABLE vinted_watchlist IS 'Tracked sets for watchlist scanning (200 sets max)';
COMMENT ON TABLE vinted_watchlist_stats IS 'Effectiveness tracking for watchlist sets';
COMMENT ON TABLE vinted_watchlist_exclusions IS 'Manually excluded sets from watchlist';
COMMENT ON TABLE seeded_asin_rankings IS 'Amazon sales rankings for retired set prioritisation';
COMMENT ON TABLE vinted_scan_log IS 'Audit trail for all automated scans';
COMMENT ON TABLE vinted_opportunities IS 'Found arbitrage opportunities from scans';
COMMENT ON TABLE vinted_dom_selectors IS 'Maintainable CSS selectors for Vinted DOM parsing';
