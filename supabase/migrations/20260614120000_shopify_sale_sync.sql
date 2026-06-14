-- Shopify sale-sync support.
--
-- 1. The `chk_sold_platform` CHECK on inventory_items only permitted
--    amazon/ebay/bricklink, so a sale that originated on Shopify (or Brick Owl)
--    could not record its true `sold_platform`. This blocked the new
--    Shopify -> HB order-ingestion flow from attributing sales correctly.
--    Widen the allowed set to include 'shopify' and 'brickowl'.
-- 2. Add a cursor column to shopify_config so the order-poll cron can do
--    incremental syncs (only fetch orders updated since the last run).
-- 3. Backfill the first Shopify sale (set 6474 "Wheeled Front Shovel",
--    order #1002) which was marked SOLD before the constraint allowed
--    'shopify', leaving its sold_platform NULL.

-- 1. Widen the sold_platform constraint
ALTER TABLE inventory_items DROP CONSTRAINT IF EXISTS chk_sold_platform;
ALTER TABLE inventory_items
  ADD CONSTRAINT chk_sold_platform
  CHECK (
    sold_platform IS NULL
    OR sold_platform = ANY (ARRAY['amazon', 'ebay', 'bricklink', 'brickowl', 'shopify'])
  );

-- 2. Incremental order-sync cursor for the Shopify order poll
ALTER TABLE shopify_config
  ADD COLUMN IF NOT EXISTS last_order_sync_at TIMESTAMPTZ;

-- 3. Backfill the first Shopify sale's attribution (idempotent)
UPDATE inventory_items
SET sold_platform = 'shopify'
WHERE id = 'da0b7d58-4d0b-4d85-a47c-a2a29bab6fb0'
  AND status = 'SOLD'
  AND sold_platform IS NULL;
