-- Add is_refresh flag to distinguish refreshed listings from genuinely new ones
-- This prevents the weekly targets metric from being inflated by 90-day refresh listings
ALTER TABLE inventory_items ADD COLUMN is_refresh BOOLEAN NOT NULL DEFAULT false;

-- Backfill: mark all items that were created via listing refresh
UPDATE inventory_items ii
SET is_refresh = true
WHERE EXISTS (
  SELECT 1 FROM ebay_listing_refresh_items rfi
  WHERE rfi.original_sku = ii.sku
    AND rfi.status = 'created'
    AND rfi.create_completed_at IS NOT NULL
);
