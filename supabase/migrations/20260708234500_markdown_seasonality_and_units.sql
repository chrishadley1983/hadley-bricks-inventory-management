-- Markdown seasonality + ASIN-level proposals
--
-- 1. Keepa 365-day references on the daily Amazon pricing snapshots, so the
--    pricing engine can tell an off-season trough from the real yearly norm:
--      - was_price_365d : Keepa 365-day average buy box (yearly norm)
--      - high_365d      : Keepa 365-day maximum buy box (seasonal high)
--    A seasonal set (Christmas / Valentine / Halloween / CNY / Easter) sitting
--    in its off-season has a yearly high well above the recent window; matching
--    the trough would lock in the annual low right before the pre-season ramp.
--
-- 2. units on markdown_proposals: Amazon proposals are now generated once per
--    (asin, condition) group (an Amazon price is per-ASIN and approval reprices
--    the whole ASIN), carrying how many in-play units the decision covers.

ALTER TABLE amazon_arbitrage_pricing
  ADD COLUMN IF NOT EXISTS was_price_365d numeric,
  ADD COLUMN IF NOT EXISTS high_365d numeric;

COMMENT ON COLUMN amazon_arbitrage_pricing.was_price_365d IS 'Keepa 365-day average buy box (GBP) — yearly norm, seasonal-trough reference.';
COMMENT ON COLUMN amazon_arbitrage_pricing.high_365d IS 'Keepa 365-day maximum buy box (GBP) — seasonal high, used to detect off-season troughs.';

ALTER TABLE markdown_proposals
  ADD COLUMN IF NOT EXISTS units integer NOT NULL DEFAULT 1;

COMMENT ON COLUMN markdown_proposals.units IS 'Number of in-play units this proposal covers. Amazon: all units of the (asin, condition) group (one proposal per ASIN). eBay: always 1 (per-listing).';
