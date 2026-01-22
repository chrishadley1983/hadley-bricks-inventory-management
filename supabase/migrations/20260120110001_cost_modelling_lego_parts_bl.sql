-- Add Lego Parts % (BrickLink) column to cost_model_scenarios
-- This field allows setting a percentage of BrickLink turnover spent on Lego parts,
-- similar to the existing lego_parts_percent for eBay.

ALTER TABLE cost_model_scenarios
ADD COLUMN lego_parts_percent_bl DECIMAL(5,4) DEFAULT 0.02;

-- Add comment for documentation
COMMENT ON COLUMN cost_model_scenarios.lego_parts_percent_bl IS 'Percentage of BrickLink turnover spent on Lego parts (as decimal, e.g., 0.02 = 2%)';
