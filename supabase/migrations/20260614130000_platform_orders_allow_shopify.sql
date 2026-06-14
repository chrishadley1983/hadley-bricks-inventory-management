-- Allow Shopify orders in platform_orders.
--
-- The inbound Shopify order-ingestion flow upserts rows with platform = 'shopify',
-- but `chk_platform_orders_platform` only permitted amazon/ebay/bricklink/
-- brickowl/bricqer. Without this, every Shopify order upsert throws and the
-- sale never propagates (no mark-sold, no eBay de-list). Widen the constraint.

ALTER TABLE platform_orders DROP CONSTRAINT IF EXISTS chk_platform_orders_platform;
ALTER TABLE platform_orders
  ADD CONSTRAINT chk_platform_orders_platform
  CHECK (platform = ANY (ARRAY['amazon', 'ebay', 'bricklink', 'brickowl', 'bricqer', 'shopify']));
