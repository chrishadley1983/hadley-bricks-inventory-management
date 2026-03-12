-- ============================================
-- Smart Auto-Markdown
-- Automated markdown engine for aged inventory
-- Tables: config, proposals + column on inventory_items
-- ============================================

-- Add markdown_hold flag to inventory_items
ALTER TABLE inventory_items ADD COLUMN IF NOT EXISTS markdown_hold BOOLEAN NOT NULL DEFAULT false;

-- Configuration table (single row per user)
CREATE TABLE IF NOT EXISTS markdown_config (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  -- Mode: 'review' = all proposals need manual approval, 'auto' = OVERPRICED auto-executes
  mode TEXT NOT NULL DEFAULT 'review' CHECK (mode IN ('review', 'auto')),

  -- Amazon markdown thresholds (days in stock)
  amazon_step1_days INTEGER NOT NULL DEFAULT 60,
  amazon_step2_days INTEGER NOT NULL DEFAULT 90,
  amazon_step3_days INTEGER NOT NULL DEFAULT 120,
  amazon_step4_days INTEGER NOT NULL DEFAULT 150,

  -- Amazon markdown percentages (step 1 = match market, 2/3 = undercut %)
  amazon_step2_undercut_pct NUMERIC(5,2) NOT NULL DEFAULT 5.0,
  amazon_step3_undercut_pct NUMERIC(5,2) NOT NULL DEFAULT 10.0,

  -- eBay markdown thresholds (days in stock)
  ebay_step1_days INTEGER NOT NULL DEFAULT 60,
  ebay_step2_days INTEGER NOT NULL DEFAULT 90,
  ebay_step3_days INTEGER NOT NULL DEFAULT 120,
  ebay_step4_days INTEGER NOT NULL DEFAULT 150,

  -- eBay markdown percentages (from current/original listing price)
  ebay_step1_reduction_pct NUMERIC(5,2) NOT NULL DEFAULT 5.0,
  ebay_step2_reduction_pct NUMERIC(5,2) NOT NULL DEFAULT 10.0,

  -- Platform fee rates for floor calculation
  amazon_fee_rate NUMERIC(5,4) NOT NULL DEFAULT 0.1836,
  ebay_fee_rate NUMERIC(5,4) NOT NULL DEFAULT 0.1800,

  -- Diagnosis thresholds
  overpriced_threshold_pct NUMERIC(5,2) NOT NULL DEFAULT 10.0,  -- >10% above market = OVERPRICED
  low_demand_sales_rank INTEGER NOT NULL DEFAULT 100000,          -- sales rank above this = LOW_DEMAND signal

  -- Auction settings
  auction_default_duration_days INTEGER NOT NULL DEFAULT 7,
  auction_max_per_day INTEGER NOT NULL DEFAULT 2,
  auction_enabled BOOLEAN NOT NULL DEFAULT true,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  UNIQUE(user_id)
);

-- Markdown proposals table
CREATE TABLE IF NOT EXISTS markdown_proposals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  inventory_item_id UUID NOT NULL REFERENCES inventory_items(id) ON DELETE CASCADE,

  -- Platform this proposal targets
  platform TEXT NOT NULL CHECK (platform IN ('amazon', 'ebay')),

  -- Diagnosis
  diagnosis TEXT NOT NULL CHECK (diagnosis IN ('OVERPRICED', 'LOW_DEMAND')),
  diagnosis_reason TEXT NOT NULL,

  -- Pricing
  current_price NUMERIC(8,2) NOT NULL,
  proposed_price NUMERIC(8,2),          -- NULL for auction proposals
  price_floor NUMERIC(8,2) NOT NULL,    -- breakeven price after fees
  market_price NUMERIC(8,2),            -- reference market price used

  -- Action
  proposed_action TEXT NOT NULL CHECK (proposed_action IN ('MARKDOWN', 'AUCTION')),
  markdown_step INTEGER,                -- 1-4 for markdown, NULL for direct auction
  aging_days INTEGER NOT NULL,

  -- Auction-specific
  auction_end_date DATE,                -- suggested end date for auction staggering
  auction_duration_days INTEGER,        -- 3, 5, 7, or 10

  -- Status
  status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'APPROVED', 'REJECTED', 'AUTO_APPLIED', 'FAILED', 'EXPIRED')),
  error_message TEXT,

  -- Metadata
  set_number TEXT,
  item_name TEXT,
  sales_rank INTEGER,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_markdown_proposals_user_status
  ON markdown_proposals(user_id, status);
CREATE INDEX IF NOT EXISTS idx_markdown_proposals_inventory_item
  ON markdown_proposals(inventory_item_id);
CREATE INDEX IF NOT EXISTS idx_markdown_proposals_auction_end_date
  ON markdown_proposals(auction_end_date) WHERE proposed_action = 'AUCTION';
CREATE INDEX IF NOT EXISTS idx_inventory_items_markdown_hold
  ON inventory_items(user_id, markdown_hold) WHERE markdown_hold = true;

-- RLS Policies
ALTER TABLE markdown_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE markdown_proposals ENABLE ROW LEVEL SECURITY;

-- markdown_config policies
CREATE POLICY "Users can view own markdown config"
  ON markdown_config FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own markdown config"
  ON markdown_config FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own markdown config"
  ON markdown_config FOR UPDATE
  USING (auth.uid() = user_id);

-- Service role bypass for cron jobs
CREATE POLICY "Service role full access to markdown_config"
  ON markdown_config FOR ALL
  USING (auth.role() = 'service_role');

-- markdown_proposals policies
CREATE POLICY "Users can view own markdown proposals"
  ON markdown_proposals FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can update own markdown proposals"
  ON markdown_proposals FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Service role full access to markdown_proposals"
  ON markdown_proposals FOR ALL
  USING (auth.role() = 'service_role');

-- Seed default config for Chris
INSERT INTO markdown_config (user_id, mode)
VALUES ('4b6e94b4-661c-4462-9d14-b21df7d51e5b', 'review')
ON CONFLICT (user_id) DO NOTHING;
