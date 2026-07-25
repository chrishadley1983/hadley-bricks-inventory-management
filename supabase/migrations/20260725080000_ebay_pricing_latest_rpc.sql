-- Fix the single heaviest query on the database (2026-07-25 outage post-mortem).
--
-- pg_stat_statements ranked this PostgREST select #1 by total time BY A WIDE MARGIN:
--   60,595 calls / 11,368s total / 187.6ms mean / 8.98M shared_blks_read (10.6% miss)
-- versus 3,931s for the #2 query. It is EbayFpDetector.recalculateAggregates()'s
-- per-batch fetch (ebay-fp-detector.service.ts), which asks for every snapshot row
-- of 15 sets and then throws all but the newest away in JS:
--
--   SELECT id, set_number, listings_json, ... FROM ebay_pricing
--   WHERE set_number = ANY($1) AND condition = $2 AND country_code = $3
--   ORDER BY snapshot_date DESC
--
-- ebay_pricing keeps ~12 snapshots per set (179k rows over ~23.9k sets), so the
-- query returns 184 rows to use 15 — and every one of those rows drags a TOASTed
-- listings_json blob (~2.3KB avg) over the wire. Measured plans on live data:
--
--   current (ANY + ORDER BY + JS dedup)   184 rows scanned, buffers 190, 136.7ms cold
--   DISTINCT ON (set_number)               184 rows scanned, buffers 190  <- server-side
--                                          dedup only; does NOT cut the scan
--   lateral LIMIT 1 per set (this fix)      12 rows scanned, buffers  57, 0.279ms
--
-- The lateral is the only form that stops after the first row per set, so it cuts
-- the heap/TOAST reads ~3.3x as well as the payload ~15x. That matters more than
-- usual here: the database is 3.9GB on a 1GB-RAM instance (shared_buffers 256MB),
-- so anything not in cache is a real disk read.

CREATE OR REPLACE FUNCTION get_latest_ebay_pricing(
  p_set_numbers text[],
  p_condition text DEFAULT 'NEW',
  p_country_code text DEFAULT 'GB'
)
RETURNS TABLE (
  id uuid,
  set_number character varying,
  listings_json jsonb,
  min_price numeric,
  avg_price numeric,
  max_price numeric,
  total_listings integer
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT l.id, l.set_number, l.listings_json,
         l.min_price, l.avg_price, l.max_price, l.total_listings
  FROM unnest(p_set_numbers) AS s(set_number)
  CROSS JOIN LATERAL (
    SELECT e.id, e.set_number, e.listings_json,
           e.min_price, e.avg_price, e.max_price, e.total_listings
    FROM ebay_pricing e
    WHERE e.set_number = s.set_number
      AND e.condition = p_condition
      AND e.country_code = p_country_code
    ORDER BY e.snapshot_date DESC
    LIMIT 1
  ) l;
$$;

COMMENT ON FUNCTION get_latest_ebay_pricing(text[], text, text) IS
  'Latest ebay_pricing row per set for a batch. Lateral LIMIT 1 so the planner stops '
  'after one row per set instead of scanning every snapshot and de-duplicating in the '
  'client. See migration 20260725080000 for the measured plans.';

GRANT EXECUTE ON FUNCTION get_latest_ebay_pricing(text[], text, text) TO authenticated, service_role;

-- Autovacuum: the churn-heavy big tables never reach the default 20% dead-tuple
-- trigger, so bloat accumulates for days and every scan reads more pages than it
-- needs — on a 1GB instance that directly costs cache residency. Observed
-- 2026-07-25: price_snapshots 389,540 dead (12.6%, needs 540k to trigger, last
-- autovacuum 5 days earlier); bl_pg_refresh_queue 31,200 dead (16.3%);
-- ebay_pricing 18,810 dead (9.5%, last autovacuum a month earlier).
ALTER TABLE price_snapshots     SET (autovacuum_vacuum_scale_factor = 0.02, autovacuum_analyze_scale_factor = 0.02);
ALTER TABLE ebay_pricing        SET (autovacuum_vacuum_scale_factor = 0.05, autovacuum_analyze_scale_factor = 0.05);
ALTER TABLE bl_pg_refresh_queue SET (autovacuum_vacuum_scale_factor = 0.05, autovacuum_analyze_scale_factor = 0.05);
