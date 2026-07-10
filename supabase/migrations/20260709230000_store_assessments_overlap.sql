-- Store-assessment engine v3: lot overlap vs OUR OWN inventory.
-- buyable_fresh_lots = buyable lots tagged NEW (not stocked, never sold by us) or
-- RESTOCK_OUT (we sold out of it) — the "fresh demand" buys that widen the catalogue
-- or refill proven sellers instead of adding depth. Full per-tag detail lives in
-- assessment->'overlap'. NULL = run predates v3 or had no user index.

ALTER TABLE store_assessments
  ADD COLUMN IF NOT EXISTS buyable_fresh_lots INTEGER;

COMMENT ON COLUMN store_assessments.buyable_fresh_lots IS
  'Buyable lots tagged NEW or RESTOCK_OUT vs our own Bricqer stock+sales (engine v3 overlap). NULL = pre-v3 run or overlap unavailable.';
