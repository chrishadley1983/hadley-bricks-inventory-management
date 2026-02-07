-- Phase 3: Add Keepa source to price_snapshots + create investment tables
-- This migration:
-- 1. Adds 'keepa_amazon_buybox' to price_snapshots source constraint
-- 2. Creates investment_historical table for retired set appreciation data
-- 3. Creates investment_predictions table for ML scores and predictions

-- 1. Update price_snapshots source constraint to include Keepa
ALTER TABLE price_snapshots DROP CONSTRAINT IF EXISTS chk_price_snapshot_source;
ALTER TABLE price_snapshots ADD CONSTRAINT chk_price_snapshot_source
  CHECK (source IN ('amazon_buybox', 'amazon_was', 'bricklink_new', 'bricklink_used', 'brickset_retail', 'keepa_amazon_buybox'));

-- 2. Create investment_historical table
CREATE TABLE IF NOT EXISTS investment_historical (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  set_num TEXT NOT NULL UNIQUE,
  retired_date DATE,
  rrp_gbp DECIMAL(10,2),
  price_at_retirement DECIMAL(10,2),
  price_1yr_post DECIMAL(10,2),
  price_3yr_post DECIMAL(10,2),
  actual_1yr_appreciation DECIMAL(8,2),
  actual_3yr_appreciation DECIMAL(8,2),
  had_amazon_listing BOOLEAN DEFAULT false,
  avg_sales_rank_post INTEGER,
  data_quality TEXT NOT NULL DEFAULT 'pending',
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,

  CONSTRAINT chk_data_quality CHECK (data_quality IN ('good', 'partial', 'insufficient', 'pending'))
);

CREATE INDEX idx_investment_historical_set_num ON investment_historical(set_num);
CREATE INDEX idx_investment_historical_data_quality ON investment_historical(data_quality);

-- RLS for investment_historical
ALTER TABLE investment_historical ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone can view investment historical" ON investment_historical
  FOR SELECT USING (true);

-- 3. Create investment_predictions table
CREATE TABLE IF NOT EXISTS investment_predictions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  set_num TEXT NOT NULL UNIQUE,
  investment_score DECIMAL(3,1) NOT NULL,
  predicted_1yr_appreciation DECIMAL(8,2),
  predicted_3yr_appreciation DECIMAL(8,2),
  predicted_1yr_price_gbp DECIMAL(10,2),
  predicted_3yr_price_gbp DECIMAL(10,2),
  confidence DECIMAL(3,2) NOT NULL DEFAULT 0,
  risk_factors JSONB DEFAULT '[]'::jsonb,
  amazon_viable BOOLEAN DEFAULT false,
  model_version TEXT,
  scored_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,

  CONSTRAINT chk_investment_score_range CHECK (investment_score >= 1.0 AND investment_score <= 10.0),
  CONSTRAINT chk_confidence_range CHECK (confidence >= 0 AND confidence <= 1)
);

CREATE INDEX idx_investment_predictions_set_num ON investment_predictions(set_num);
CREATE INDEX idx_investment_predictions_score ON investment_predictions(investment_score DESC);
CREATE INDEX idx_investment_predictions_scored_at ON investment_predictions(scored_at);

-- RLS for investment_predictions
ALTER TABLE investment_predictions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone can view investment predictions" ON investment_predictions
  FOR SELECT USING (true);
