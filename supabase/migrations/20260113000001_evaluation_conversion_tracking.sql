-- Migration: Add conversion tracking to purchase evaluations
-- This allows evaluations to be converted into purchases and inventory items

-- Add 'converted' to status check constraint
ALTER TABLE purchase_evaluations
DROP CONSTRAINT IF EXISTS purchase_evaluations_status_check;

ALTER TABLE purchase_evaluations
ADD CONSTRAINT purchase_evaluations_status_check
CHECK (status IN ('draft', 'in_progress', 'completed', 'saved', 'converted'));

-- Add conversion tracking columns
ALTER TABLE purchase_evaluations
ADD COLUMN IF NOT EXISTS converted_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS converted_purchase_id UUID REFERENCES purchases(id);

-- Add index for lookups by converted purchase
CREATE INDEX IF NOT EXISTS idx_purchase_evaluations_converted_purchase
ON purchase_evaluations(converted_purchase_id)
WHERE converted_purchase_id IS NOT NULL;

-- Add comments for documentation
COMMENT ON COLUMN purchase_evaluations.converted_at IS 'Timestamp when this evaluation was converted to a purchase';
COMMENT ON COLUMN purchase_evaluations.converted_purchase_id IS 'Foreign key to the purchase created from this evaluation';
