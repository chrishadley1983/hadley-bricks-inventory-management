-- Unified markdown v2: position-first Amazon pricing
-- New Keepa-derived columns on the daily pricing snapshot, and config knobs
-- for the persistence-gated match / velocity-gated decay / 365d exit design.

-- 180-day buy-box average (Keepa stats.avg180) and 90-day sales-rank drops
-- (Keepa salesRankDrops90 — proxy for ASIN-level sales velocity).
ALTER TABLE amazon_arbitrage_pricing
  ADD COLUMN IF NOT EXISTS was_price_180d numeric,
  ADD COLUMN IF NOT EXISTS sales_rank_drops_90d integer;

-- Markdown config: postage in floors + Amazon position-pricing knobs.
ALTER TABLE markdown_config
  ADD COLUMN IF NOT EXISTS amazon_postage_cost numeric NOT NULL DEFAULT 2.80,
  ADD COLUMN IF NOT EXISTS ebay_postage_cost numeric NOT NULL DEFAULT 1.55,
  ADD COLUMN IF NOT EXISTS amazon_persistence_window_days integer NOT NULL DEFAULT 14,
  ADD COLUMN IF NOT EXISTS amazon_persistence_min_pct numeric NOT NULL DEFAULT 75,
  ADD COLUMN IF NOT EXISTS amazon_reference_window_days integer NOT NULL DEFAULT 180,
  ADD COLUMN IF NOT EXISTS amazon_decay_start_days integer NOT NULL DEFAULT 90,
  ADD COLUMN IF NOT EXISTS amazon_decay_interval_days integer NOT NULL DEFAULT 60,
  ADD COLUMN IF NOT EXISTS amazon_decay_step_pct numeric NOT NULL DEFAULT 5,
  ADD COLUMN IF NOT EXISTS amazon_decay_floor_pct numeric NOT NULL DEFAULT 60,
  ADD COLUMN IF NOT EXISTS amazon_exit_days integer NOT NULL DEFAULT 365,
  ADD COLUMN IF NOT EXISTS amazon_min_drops_90d integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS amazon_healthy_drops_90d integer NOT NULL DEFAULT 10;

COMMENT ON COLUMN amazon_arbitrage_pricing.was_price_180d IS 'Keepa 180-day average buy-box price (GBP)';
COMMENT ON COLUMN amazon_arbitrage_pricing.sales_rank_drops_90d IS 'Keepa salesRankDrops90 — rank-drop count over 90d, sales-velocity proxy';
COMMENT ON COLUMN markdown_config.amazon_decay_floor_pct IS 'Low-demand decay never goes below this % of the anchor (max historical your_price)';
