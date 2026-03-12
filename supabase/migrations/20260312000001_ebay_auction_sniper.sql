-- ============================================
-- eBay Auction Sniper
-- Tables for config, alert history, and scan logs
-- ============================================

-- Configuration table (single row per user)
CREATE TABLE IF NOT EXISTS ebay_auction_config (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  enabled BOOLEAN NOT NULL DEFAULT true,

  -- Margin thresholds (profit margin % on Amazon FBM sale)
  min_margin_percent NUMERIC(5,2) NOT NULL DEFAULT 15.0,
  great_margin_percent NUMERIC(5,2) NOT NULL DEFAULT 25.0,

  -- Minimum profit in £ to alert (avoid tiny margin items)
  min_profit_gbp NUMERIC(8,2) NOT NULL DEFAULT 3.0,

  -- Maximum bid price to consider (avoid expensive items)
  max_bid_price_gbp NUMERIC(8,2) DEFAULT NULL,

  -- eBay postage assumption when not shown (£)
  default_postage_gbp NUMERIC(5,2) NOT NULL DEFAULT 3.99,

  -- Quiet hours (UTC) - no alerts during these hours
  quiet_hours_enabled BOOLEAN NOT NULL DEFAULT false,
  quiet_hours_start INTEGER NOT NULL DEFAULT 22, -- 22:00 UTC = 10pm
  quiet_hours_end INTEGER NOT NULL DEFAULT 7,    -- 07:00 UTC = 7am

  -- Excluded set numbers (JSON array of strings)
  excluded_sets JSONB NOT NULL DEFAULT '[]'::jsonb,

  -- Scan window: how many minutes before auction end to scan
  scan_window_minutes INTEGER NOT NULL DEFAULT 15,

  -- Minimum number of bids (filter out zero-bid auctions as less reliable)
  min_bids INTEGER NOT NULL DEFAULT 0,

  -- Maximum sales rank on Amazon (filter out slow sellers)
  max_sales_rank INTEGER DEFAULT NULL,

  -- Joblot analysis enabled
  joblot_analysis_enabled BOOLEAN NOT NULL DEFAULT true,

  -- Minimum total value for joblot alerts
  joblot_min_total_value_gbp NUMERIC(8,2) NOT NULL DEFAULT 50.0,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  UNIQUE(user_id)
);

-- Alert history (deduplication + tracking)
CREATE TABLE IF NOT EXISTS ebay_auction_alerts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  -- eBay auction details
  ebay_item_id TEXT NOT NULL,
  ebay_title TEXT NOT NULL,
  ebay_url TEXT,
  ebay_image_url TEXT,

  -- Identified LEGO set
  set_number TEXT,
  set_name TEXT,

  -- Pricing at time of alert
  current_bid_gbp NUMERIC(8,2) NOT NULL,
  postage_gbp NUMERIC(5,2) NOT NULL DEFAULT 0,
  total_cost_gbp NUMERIC(8,2) NOT NULL,
  bid_count INTEGER NOT NULL DEFAULT 0,

  -- Amazon comparison
  amazon_price_gbp NUMERIC(8,2),
  amazon_90d_avg_gbp NUMERIC(8,2),
  amazon_asin TEXT,
  amazon_sales_rank INTEGER,

  -- Calculated profit
  profit_gbp NUMERIC(8,2),
  margin_percent NUMERIC(5,2),
  roi_percent NUMERIC(8,2),

  -- Alert metadata
  alert_tier TEXT NOT NULL DEFAULT 'good', -- 'great', 'good'
  is_joblot BOOLEAN NOT NULL DEFAULT false,
  joblot_sets JSONB, -- Array of {setNumber, setName, amazonPrice} for joblots

  -- Auction timing
  auction_end_time TIMESTAMPTZ,

  -- Discord message tracking
  discord_sent BOOLEAN NOT NULL DEFAULT false,
  discord_sent_at TIMESTAMPTZ,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- Prevent duplicate alerts for same auction
  UNIQUE(user_id, ebay_item_id)
);

-- Scan execution log
CREATE TABLE IF NOT EXISTS ebay_auction_scan_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  -- Scan results
  auctions_found INTEGER NOT NULL DEFAULT 0,
  auctions_with_sets INTEGER NOT NULL DEFAULT 0,
  opportunities_found INTEGER NOT NULL DEFAULT 0,
  alerts_sent INTEGER NOT NULL DEFAULT 0,
  joblots_found INTEGER NOT NULL DEFAULT 0,

  -- Execution details
  duration_ms INTEGER,
  api_calls_made INTEGER NOT NULL DEFAULT 0,
  error_message TEXT,
  skipped_reason TEXT, -- 'quiet_hours', 'disabled', etc.

  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_ebay_auction_alerts_user_created
  ON ebay_auction_alerts(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ebay_auction_alerts_ebay_item
  ON ebay_auction_alerts(ebay_item_id);
CREATE INDEX IF NOT EXISTS idx_ebay_auction_alerts_set_number
  ON ebay_auction_alerts(set_number);
CREATE INDEX IF NOT EXISTS idx_ebay_auction_scan_log_user_created
  ON ebay_auction_scan_log(user_id, created_at DESC);

-- RLS policies
ALTER TABLE ebay_auction_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE ebay_auction_alerts ENABLE ROW LEVEL SECURITY;
ALTER TABLE ebay_auction_scan_log ENABLE ROW LEVEL SECURITY;

-- Config: users can read/write their own
CREATE POLICY "Users can manage their own auction config"
  ON ebay_auction_config FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Alerts: users can read their own
CREATE POLICY "Users can read their own auction alerts"
  ON ebay_auction_alerts FOR SELECT
  USING (auth.uid() = user_id);

-- Alerts: service role inserts (cron job)
CREATE POLICY "Service role can insert auction alerts"
  ON ebay_auction_alerts FOR INSERT
  WITH CHECK (true);

-- Scan log: users can read their own
CREATE POLICY "Users can read their own scan logs"
  ON ebay_auction_scan_log FOR SELECT
  USING (auth.uid() = user_id);

-- Scan log: service role inserts (cron job)
CREATE POLICY "Service role can insert scan logs"
  ON ebay_auction_scan_log FOR INSERT
  WITH CHECK (true);

-- Insert default config for the main user
INSERT INTO ebay_auction_config (user_id)
VALUES ('4b6e94b4-661c-4462-9d14-b21df7d51e5b')
ON CONFLICT (user_id) DO NOTHING;

-- Auto-cleanup: delete scan logs older than 30 days
-- (Can be run via pg_cron if desired)
