-- Set-arb house-margin fields (fix/set-arb-house-margin).
-- Decision contract ratified 2026-07-20: NET margin % of SALE (green >25%, amber >15%,
-- drop below); BSR + drops90 displayed as information, never a gate.
-- net_margin_pct semantics change with this branch: margin ÷ sale (was margin ÷ landed).

ALTER TABLE bl_set_arb_candidates
  ADD COLUMN IF NOT EXISTS was_price_90d NUMERIC(10,2),
  ADD COLUMN IF NOT EXISTS sales_rank INTEGER,
  ADD COLUMN IF NOT EXISTS amazon_snapshot_date DATE;

COMMENT ON COLUMN bl_set_arb_candidates.was_price_90d IS '90-day average buy box (Keepa avg90) — conservative sale basis alongside sell_price_gbp';
COMMENT ON COLUMN bl_set_arb_candidates.sales_rank IS 'Amazon BSR at flag time — informational, never a gate';
COMMENT ON COLUMN bl_set_arb_candidates.amazon_snapshot_date IS 'Snapshot date the sell side was quoted from — page badges aged data instead of hiding rows';
COMMENT ON COLUMN bl_set_arb_candidates.net_margin_pct IS 'NET margin ÷ SALE price (house convention, max-buy.ts bands: green >0.25, amber >0.15)';
