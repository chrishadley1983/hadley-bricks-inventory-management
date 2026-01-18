-- Cost Modelling Tables Migration
-- Creates tables for financial scenario modelling and projection

-- Main scenarios table
CREATE TABLE cost_model_scenarios (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  name VARCHAR(255) NOT NULL,
  description TEXT,

  -- Sales Volume & Pricing (per month)
  bl_sales_per_month INTEGER DEFAULT 165,
  bl_avg_sale_value DECIMAL(10,2) DEFAULT 15.00,
  bl_avg_postage_cost DECIMAL(10,2) DEFAULT 2.70,

  amazon_sales_per_month INTEGER DEFAULT 75,
  amazon_avg_sale_value DECIMAL(10,2) DEFAULT 40.00,
  amazon_avg_postage_cost DECIMAL(10,2) DEFAULT 3.95,

  ebay_sales_per_month INTEGER DEFAULT 80,
  ebay_avg_sale_value DECIMAL(10,2) DEFAULT 25.00,
  ebay_avg_postage_cost DECIMAL(10,2) DEFAULT 3.20,

  -- Fee Rates (as decimals)
  bl_fee_rate DECIMAL(5,4) DEFAULT 0.10,
  amazon_fee_rate DECIMAL(5,4) DEFAULT 0.183,
  ebay_fee_rate DECIMAL(5,4) DEFAULT 0.20,

  -- COG Percentages (as decimals)
  bl_cog_percent DECIMAL(5,4) DEFAULT 0.20,
  amazon_cog_percent DECIMAL(5,4) DEFAULT 0.35,
  ebay_cog_percent DECIMAL(5,4) DEFAULT 0.30,

  -- Fixed Costs (Monthly)
  fixed_shopify DECIMAL(10,2) DEFAULT 25.00,
  fixed_ebay_store DECIMAL(10,2) DEFAULT 35.00,
  fixed_seller_tools DECIMAL(10,2) DEFAULT 50.00,
  fixed_amazon DECIMAL(10,2) DEFAULT 30.00,
  fixed_storage DECIMAL(10,2) DEFAULT 110.00,

  -- Annual Costs
  annual_accountant_cost DECIMAL(10,2) DEFAULT 200.00,
  annual_misc_costs DECIMAL(10,2) DEFAULT 1000.00,

  -- VAT Settings
  is_vat_registered BOOLEAN DEFAULT FALSE,
  vat_flat_rate DECIMAL(5,4) DEFAULT 0.075,
  accountant_cost_if_vat DECIMAL(10,2) DEFAULT 1650.00,

  -- Tax Settings
  target_annual_profit DECIMAL(10,2) DEFAULT 26000.00,
  personal_allowance DECIMAL(10,2) DEFAULT 12570.00,
  income_tax_rate DECIMAL(5,4) DEFAULT 0.20,
  ni_rate DECIMAL(5,4) DEFAULT 0.06,

  -- Lego Parts (% of eBay turnover)
  lego_parts_percent DECIMAL(5,4) DEFAULT 0.02,

  -- Draft for auto-save
  draft_data JSONB,
  draft_updated_at TIMESTAMPTZ,

  -- Metadata
  is_default BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  UNIQUE(user_id, name)
);

-- Package costs table (6 rows per scenario)
CREATE TABLE cost_model_package_costs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  scenario_id UUID NOT NULL REFERENCES cost_model_scenarios(id) ON DELETE CASCADE,

  package_type VARCHAR(50) NOT NULL,
  -- 'large_parcel_amazon', 'small_parcel_amazon', 'large_letter_amazon',
  -- 'large_parcel_ebay', 'small_parcel_ebay', 'large_letter_ebay'

  postage DECIMAL(10,2) NOT NULL,
  cardboard DECIMAL(10,2) NOT NULL,
  bubble_wrap DECIMAL(10,2) NOT NULL,
  lego_card DECIMAL(10,2) DEFAULT 0.00,
  business_card DECIMAL(10,2) DEFAULT 0.00,

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  UNIQUE(scenario_id, package_type)
);

-- Indexes
CREATE INDEX idx_cost_scenarios_user ON cost_model_scenarios(user_id);
CREATE INDEX idx_cost_scenarios_updated ON cost_model_scenarios(updated_at DESC);
CREATE INDEX idx_cost_package_scenario ON cost_model_package_costs(scenario_id);

-- RLS Policies
ALTER TABLE cost_model_scenarios ENABLE ROW LEVEL SECURITY;
ALTER TABLE cost_model_package_costs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own scenarios"
  ON cost_model_scenarios FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own scenarios"
  ON cost_model_scenarios FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own scenarios"
  ON cost_model_scenarios FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own scenarios"
  ON cost_model_scenarios FOR DELETE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can view own package costs"
  ON cost_model_package_costs FOR SELECT
  USING (
    scenario_id IN (
      SELECT id FROM cost_model_scenarios WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "Users can insert own package costs"
  ON cost_model_package_costs FOR INSERT
  WITH CHECK (
    scenario_id IN (
      SELECT id FROM cost_model_scenarios WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "Users can update own package costs"
  ON cost_model_package_costs FOR UPDATE
  USING (
    scenario_id IN (
      SELECT id FROM cost_model_scenarios WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "Users can delete own package costs"
  ON cost_model_package_costs FOR DELETE
  USING (
    scenario_id IN (
      SELECT id FROM cost_model_scenarios WHERE user_id = auth.uid()
    )
  );

-- Trigger for updated_at
CREATE OR REPLACE FUNCTION update_cost_model_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER cost_model_scenarios_updated_at
  BEFORE UPDATE ON cost_model_scenarios
  FOR EACH ROW EXECUTE FUNCTION update_cost_model_updated_at();

CREATE TRIGGER cost_model_package_costs_updated_at
  BEFORE UPDATE ON cost_model_package_costs
  FOR EACH ROW EXECUTE FUNCTION update_cost_model_updated_at();
