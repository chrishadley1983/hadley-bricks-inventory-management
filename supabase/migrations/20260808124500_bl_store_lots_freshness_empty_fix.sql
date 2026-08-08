-- Empty scrapes (lot_count = 0) produce no flattened rows, so the freshness view
-- saw flattened_at NULL and flagged them needs_refresh forever — 49 wasted RPCs on
-- every part-arb discover run. Nothing-to-flatten is fresh, not stale.

CREATE OR REPLACE VIEW bl_store_lots_freshness
  WITH (security_invoker = on) AS
SELECT
  s.store_slug,
  s.scanned_at AS scrape_scanned_at,
  s.lot_count AS scrape_lot_count,
  f.flattened_at,
  COALESCE(f.lot_rows, 0) AS lot_rows,
  (s.lot_count > 0 AND (f.flattened_at IS NULL OR f.flattened_at < s.scanned_at)) AS needs_refresh
FROM bl_store_scrapes s
LEFT JOIN (
  SELECT store_slug, max(scanned_at) AS flattened_at, count(*) AS lot_rows
  FROM bl_store_lots
  GROUP BY store_slug
) f USING (store_slug);
