-- Migration: Home Costs Tables
-- Purpose: Store home working expense configuration for P&L integration

-- Home costs table (polymorphic for all cost types)
CREATE TABLE home_costs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  -- Discriminator
  cost_type TEXT NOT NULL CHECK (cost_type IN ('use_of_home', 'phone_broadband', 'insurance')),

  -- Common fields
  description TEXT, -- Required for phone_broadband only
  start_date DATE NOT NULL,
  end_date DATE, -- NULL = ongoing

  -- Use of Home fields
  hours_per_month TEXT CHECK (hours_per_month IN ('25-50', '51-100', '101+') OR hours_per_month IS NULL),

  -- Phone & Broadband fields
  monthly_cost DECIMAL(10,2),
  business_percent INTEGER CHECK (business_percent IS NULL OR (business_percent >= 1 AND business_percent <= 100)),

  -- Insurance fields
  annual_premium DECIMAL(10,2),
  business_stock_value DECIMAL(10,2),
  total_contents_value DECIMAL(10,2),

  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  -- Constraints per cost type
  CONSTRAINT check_use_of_home CHECK (
    cost_type != 'use_of_home' OR (hours_per_month IS NOT NULL)
  ),
  CONSTRAINT check_phone_broadband CHECK (
    cost_type != 'phone_broadband' OR (
      description IS NOT NULL AND
      monthly_cost IS NOT NULL AND
      business_percent IS NOT NULL
    )
  ),
  CONSTRAINT check_insurance CHECK (
    cost_type != 'insurance' OR (
      annual_premium IS NOT NULL AND
      business_stock_value IS NOT NULL AND
      total_contents_value IS NOT NULL AND
      business_stock_value <= total_contents_value
    )
  ),
  CONSTRAINT check_end_date CHECK (end_date IS NULL OR end_date >= start_date)
);

-- Index for efficient monthly lookups
CREATE INDEX idx_home_costs_user_dates ON home_costs(user_id, start_date, end_date);
CREATE INDEX idx_home_costs_type ON home_costs(user_id, cost_type);

-- Settings table
CREATE TABLE home_costs_settings (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  display_mode TEXT NOT NULL DEFAULT 'separate' CHECK (display_mode IN ('separate', 'consolidated')),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- RLS Policies
ALTER TABLE home_costs ENABLE ROW LEVEL SECURITY;
ALTER TABLE home_costs_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own home_costs"
  ON home_costs FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own home_costs"
  ON home_costs FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own home_costs"
  ON home_costs FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own home_costs"
  ON home_costs FOR DELETE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can view own home_costs_settings"
  ON home_costs_settings FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own home_costs_settings"
  ON home_costs_settings FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own home_costs_settings"
  ON home_costs_settings FOR UPDATE
  USING (auth.uid() = user_id);

-- Updated_at trigger function (reuse if exists)
CREATE OR REPLACE FUNCTION update_home_costs_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER home_costs_updated_at
  BEFORE UPDATE ON home_costs
  FOR EACH ROW EXECUTE FUNCTION update_home_costs_updated_at();

CREATE TRIGGER home_costs_settings_updated_at
  BEFORE UPDATE ON home_costs_settings
  FOR EACH ROW EXECUTE FUNCTION update_home_costs_updated_at();
