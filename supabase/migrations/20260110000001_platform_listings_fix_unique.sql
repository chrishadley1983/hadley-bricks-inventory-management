-- Fix unique constraint for platform_listings
-- The original constraint was on (user_id, platform, platform_item_id, import_id)
-- but Amazon can have multiple listings with the same ASIN (different SKUs)
-- Change to use platform_sku instead, which is unique per listing

-- Drop the existing unique constraint
ALTER TABLE platform_listings
DROP CONSTRAINT IF EXISTS platform_listings_user_id_platform_platform_item_id_import__key;

-- Add new unique constraint using platform_sku
-- platform_sku is the seller SKU which is unique per listing
ALTER TABLE platform_listings
ADD CONSTRAINT platform_listings_user_platform_sku_import_key
UNIQUE(user_id, platform, platform_sku, import_id);

-- Add index on platform_item_id for lookups (it's still useful for comparison queries)
CREATE INDEX IF NOT EXISTS idx_platform_listings_platform_item_id
ON platform_listings(user_id, platform, platform_item_id);
