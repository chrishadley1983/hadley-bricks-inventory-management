-- Migration: Update stock_pickups source_platform constraint
-- Updates the CHECK constraint to match frontend values (lowercase, no spaces)

-- Drop the existing constraint
ALTER TABLE stock_pickups DROP CONSTRAINT IF EXISTS stock_pickups_source_platform_check;

-- Add updated constraint with frontend-compatible values
ALTER TABLE stock_pickups ADD CONSTRAINT stock_pickups_source_platform_check
  CHECK (source_platform IN ('facebook', 'gumtree', 'ebay', 'bricklink', 'carboot', 'auction', 'referral', 'private', 'other'));
