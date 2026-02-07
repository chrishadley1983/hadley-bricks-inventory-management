-- Add raw_data column to investment_historical for storing model artifacts
ALTER TABLE investment_historical ADD COLUMN IF NOT EXISTS raw_data JSONB;
