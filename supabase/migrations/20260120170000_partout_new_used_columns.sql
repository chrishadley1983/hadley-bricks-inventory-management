-- Migration: partout_new_used_columns
-- Purpose: Add separate New/Used columns for sell-through, stock, and sold data

-- Add new columns for separate New/Used data
ALTER TABLE bricklink_part_price_cache
  ADD COLUMN sell_through_rate_new DECIMAL(5,2),
  ADD COLUMN sell_through_rate_used DECIMAL(5,2),
  ADD COLUMN stock_available_new INTEGER,
  ADD COLUMN stock_available_used INTEGER,
  ADD COLUMN times_sold_new INTEGER,
  ADD COLUMN times_sold_used INTEGER;

-- Migrate existing data (old columns were for New only)
UPDATE bricklink_part_price_cache
SET
  sell_through_rate_new = sell_through_rate,
  stock_available_new = stock_available,
  times_sold_new = times_sold;

-- Drop old columns (no longer needed)
ALTER TABLE bricklink_part_price_cache
  DROP COLUMN sell_through_rate,
  DROP COLUMN stock_available,
  DROP COLUMN times_sold;
