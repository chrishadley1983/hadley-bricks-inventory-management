-- Mileage Tracking System
-- Migration: 20250106000001_mileage_tracking
-- Purpose: Create dedicated mileage_tracking table and remove old columns from purchases

-- First, drop the view that depends on purchases.mileage column
DROP VIEW IF EXISTS purchase_roi_view;

-- Drop the index that depends on mileage column
DROP INDEX IF EXISTS idx_purchases_user_mileage;

-- Remove old columns from purchases table (if they exist)
ALTER TABLE purchases DROP COLUMN IF EXISTS mileage;
ALTER TABLE purchases DROP COLUMN IF EXISTS collection_address;
ALTER TABLE purchases DROP COLUMN IF EXISTS collection_location;

-- Create mileage_tracking table
CREATE TABLE mileage_tracking (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  purchase_id UUID REFERENCES purchases(id) ON DELETE CASCADE,
  tracking_date DATE NOT NULL,
  destination_postcode TEXT NOT NULL,
  miles_travelled DECIMAL(6,1) NOT NULL,
  amount_claimed DECIMAL(10,2) NOT NULL,
  reason TEXT NOT NULL,
  expense_type TEXT NOT NULL DEFAULT 'mileage', -- 'mileage', 'parking', 'toll', 'other'
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

-- Add comments for documentation
COMMENT ON TABLE mileage_tracking IS 'Tracks mileage and travel-related expenses for purchases';
COMMENT ON COLUMN mileage_tracking.user_id IS 'User who owns this mileage entry';
COMMENT ON COLUMN mileage_tracking.purchase_id IS 'Optional link to associated purchase';
COMMENT ON COLUMN mileage_tracking.tracking_date IS 'Date of the travel/expense';
COMMENT ON COLUMN mileage_tracking.destination_postcode IS 'Destination postcode for route calculation';
COMMENT ON COLUMN mileage_tracking.miles_travelled IS 'Round-trip miles travelled';
COMMENT ON COLUMN mileage_tracking.amount_claimed IS 'Amount claimed in GBP (default rate: 45p per mile)';
COMMENT ON COLUMN mileage_tracking.reason IS 'Reason for travel (e.g., Collection, Delivery, Viewing)';
COMMENT ON COLUMN mileage_tracking.expense_type IS 'Type of expense: mileage, parking, toll, other';
COMMENT ON COLUMN mileage_tracking.notes IS 'Additional notes or details';

-- Enable Row Level Security
ALTER TABLE mileage_tracking ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY "Users can view own mileage_tracking"
  ON mileage_tracking FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own mileage_tracking"
  ON mileage_tracking FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own mileage_tracking"
  ON mileage_tracking FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own mileage_tracking"
  ON mileage_tracking FOR DELETE
  USING (auth.uid() = user_id);

-- Indexes for common queries
CREATE INDEX idx_mileage_tracking_purchase_id ON mileage_tracking(purchase_id);
CREATE INDEX idx_mileage_tracking_user_date ON mileage_tracking(user_id, tracking_date);
CREATE INDEX idx_mileage_tracking_expense_type ON mileage_tracking(expense_type);

-- Trigger for updated_at
CREATE TRIGGER update_mileage_tracking_updated_at
  BEFORE UPDATE ON mileage_tracking
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- Add home_address to profiles table for route calculation starting point
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS home_address TEXT;

COMMENT ON COLUMN profiles.home_address IS 'Full home address/postcode for mileage calculation starting point';

-- ============================================================================
-- RECREATE PURCHASE ROI VIEW (updated to use mileage_tracking table)
-- ============================================================================
CREATE OR REPLACE VIEW purchase_roi_view AS
SELECT
  p.id AS purchase_id,
  p.user_id,
  p.purchase_date,
  p.short_description,
  p.cost AS purchase_cost,
  p.source,
  COALESCE(mt.total_miles, 0) AS mileage,
  COALESCE(mt.total_mileage_cost, 0) AS mileage_cost,
  COUNT(DISTINCT i.id) AS items_count,
  COUNT(DISTINCT CASE WHEN i.status = 'SOLD' THEN i.id END) AS items_sold,
  COALESCE(SUM(CASE WHEN i.status = 'SOLD' THEN i.listing_value ELSE 0 END), 0) AS revenue_from_sold,
  COALESCE(SUM(i.cost), 0) AS total_item_cost
FROM purchases p
LEFT JOIN (
  -- Aggregate mileage for each purchase
  SELECT
    purchase_id,
    SUM(miles_travelled) AS total_miles,
    SUM(amount_claimed) AS total_mileage_cost
  FROM mileage_tracking
  WHERE expense_type = 'mileage'
  GROUP BY purchase_id
) mt ON mt.purchase_id = p.id
LEFT JOIN inventory_items i ON i.source = p.short_description
  AND i.user_id = p.user_id
  AND i.purchase_date = p.purchase_date
GROUP BY p.id, p.user_id, p.purchase_date, p.short_description, p.cost, p.source, mt.total_miles, mt.total_mileage_cost;

-- Grant select on the view
GRANT SELECT ON purchase_roi_view TO authenticated;
