-- ============================================================================
-- Add Seeded ASINs to Arbitrage Watchlist
-- Migration: 20260212121655_add_seeded_asins_to_watchlist.sql
--
-- 1. Adds 'seeded' as a valid source type on the watchlist
-- 2. Inserts all seeded ASINs (with Amazon pricing) that aren't already on
--    the watchlist, so they get BrickLink + eBay pricing via the nightly crons.
-- ============================================================================

-- ============================================================================
-- STEP 1: Add 'seeded' source to CHECK constraint
-- ============================================================================
ALTER TABLE arbitrage_watchlist
  DROP CONSTRAINT IF EXISTS arbitrage_watchlist_source_check;

ALTER TABLE arbitrage_watchlist
  ADD CONSTRAINT arbitrage_watchlist_source_check
  CHECK (source IN (
    'sold_inventory',
    'retired_with_pricing',
    'seeded'
  ));

-- ============================================================================
-- STEP 2: Update stats view to include seeded count
-- ============================================================================
DROP VIEW IF EXISTS arbitrage_watchlist_stats;
CREATE VIEW arbitrage_watchlist_stats AS
SELECT
  user_id,
  COUNT(*) FILTER (WHERE is_active = true) as total_active,
  COUNT(*) FILTER (WHERE source = 'sold_inventory') as sold_inventory_count,
  COUNT(*) FILTER (WHERE source = 'retired_with_pricing') as retired_with_pricing_count,
  COUNT(*) FILTER (WHERE source = 'seeded') as seeded_count,
  COUNT(*) FILTER (WHERE ebay_last_synced_at IS NULL AND is_active = true) as ebay_never_synced,
  COUNT(*) FILTER (WHERE bricklink_last_synced_at IS NULL AND is_active = true) as bricklink_never_synced,
  COUNT(*) FILTER (WHERE ebay_last_synced_at < NOW() - INTERVAL '3 days' AND is_active = true) as ebay_stale,
  COUNT(*) FILTER (WHERE bricklink_last_synced_at < NOW() - INTERVAL '3 days' AND is_active = true) as bricklink_stale,
  MIN(ebay_last_synced_at) as oldest_ebay_sync,
  MIN(bricklink_last_synced_at) as oldest_bricklink_sync,
  MAX(ebay_last_synced_at) as newest_ebay_sync,
  MAX(bricklink_last_synced_at) as newest_bricklink_sync
FROM arbitrage_watchlist
GROUP BY user_id;

-- ============================================================================
-- STEP 3: Insert seeded ASINs with pricing into watchlist
-- Only inserts items that:
--   - Have discovery_status = 'found' and a non-null ASIN
--   - Have at least one amazon_arbitrage_pricing row (buy_box_price OR was_price_90d)
--   - Are NOT already on the watchlist for this user
-- ============================================================================
INSERT INTO arbitrage_watchlist (user_id, asin, bricklink_set_number, source, is_active)
SELECT
  tu.user_id,
  sa.asin,
  CASE
    WHEN bs.set_number ~ '-' THEN bs.set_number
    ELSE bs.set_number || '-1'
  END AS bricklink_set_number,
  'seeded'::text AS source,
  true AS is_active
FROM seeded_asins sa
JOIN brickset_sets bs ON sa.brickset_set_id = bs.id
CROSS JOIN (SELECT DISTINCT user_id FROM tracked_asins LIMIT 1) tu
WHERE sa.discovery_status = 'found'
  AND sa.asin IS NOT NULL
  -- Must have Amazon pricing data
  AND EXISTS (
    SELECT 1 FROM amazon_arbitrage_pricing aap
    WHERE aap.asin = sa.asin
      AND (aap.buy_box_price IS NOT NULL OR aap.was_price_90d IS NOT NULL)
  )
  -- Not already on the watchlist
  AND NOT EXISTS (
    SELECT 1 FROM arbitrage_watchlist aw
    WHERE aw.user_id = tu.user_id
      AND aw.bricklink_set_number = CASE
        WHEN bs.set_number ~ '-' THEN bs.set_number
        ELSE bs.set_number || '-1'
      END
  )
ON CONFLICT (user_id, bricklink_set_number) DO NOTHING;
