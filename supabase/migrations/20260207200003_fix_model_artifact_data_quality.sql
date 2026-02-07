-- Allow 'model_artifact' as a data_quality value for ML model storage
ALTER TABLE investment_historical DROP CONSTRAINT IF EXISTS chk_data_quality;
ALTER TABLE investment_historical ADD CONSTRAINT chk_data_quality
  CHECK (data_quality IN ('good', 'partial', 'insufficient', 'pending', 'model_artifact'));

-- Update any existing model artifact rows to use the correct data_quality
UPDATE investment_historical
SET data_quality = 'model_artifact'
WHERE set_num = '__model_artifact__';
