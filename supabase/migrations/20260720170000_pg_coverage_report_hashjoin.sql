-- pg_coverage_report performance rewrite (follow-up to 20260720150000).
--
-- The original view probed L3 once per queue row via LEFT JOIN LATERAL (153k nested
-- index probes with an OR condition) — a cold read exceeded the 8s PostgREST statement
-- timeout before the plan warmed (reproduced 2026-07-20: first read 8.2s timeout, retry
-- 14.5s total). Replace the lateral with two plain LEFT JOINs (exact identity + the
-- set bare-number → '-1'-suffix identity) that the planner can hash-join in one pass;
-- each join matches at most one row (both sides are unique on the tuple), and a set
-- tuple can match BOTH joins (e.g. queue "10179" vs L3 rows "10179" AND "10179-1") —
-- COALESCE prefers the exact row, so no row multiplication and no double-counting.
-- Output columns and semantics are unchanged.

CREATE OR REPLACE VIEW pg_coverage_report
WITH (security_invoker = true) AS
WITH q AS (
  SELECT rq.item_type, rq.item_no, rq.colour_id, rq.tier, rq.next_due_at, rq.attempts,
         rq.last_error,
         CASE WHEN rq.tier = 'active' THEN 60 ELSE 90 END AS cycle_days
  FROM bl_pg_refresh_queue rq
),
classified AS (
  SELECT q.tier,
         q.next_due_at <= now() AS due_now,
         CASE
           WHEN COALESCE(pe.fetched_at, ps.fetched_at) >= now() - make_interval(days => q.cycle_days) THEN 'fresh'
           WHEN COALESCE(pe.fetched_at, ps.fetched_at) IS NOT NULL                                    THEN 'stale'
           WHEN nd.fetched_at >= now() - make_interval(days => q.cycle_days)                          THEN 'no_data_fresh'
           WHEN nd.fetched_at IS NOT NULL                                                             THEN 'no_data_stale'
           WHEN q.last_error LIKE 'Not in BL catalog%'                                                THEN 'not_in_catalog'
           WHEN q.attempts >= 8                                                                       THEN 'error_parked'
           ELSE 'never_scraped'
         END AS status,
         COALESCE(pe.uk_sold_lots_new, ps.uk_sold_lots_new, 0)
           + COALESCE(pe.uk_sold_lots_used, ps.uk_sold_lots_used, 0) > 0 AS has_uk_sold,
         COALESCE(pe.uk_stock_lots_new, ps.uk_stock_lots_new, 0)
           + COALESCE(pe.uk_stock_lots_used, ps.uk_stock_lots_used, 0) > 0 AS has_uk_stock
  FROM q
  LEFT JOIN bricklink_price_guide_cache pe
    ON pe.item_type = q.item_type
   AND pe.item_no = q.item_no
   AND pe.colour_id = q.colour_id
  LEFT JOIN bricklink_price_guide_cache ps
    ON q.item_type = 'S'
   AND q.item_no !~ '-\d+$'
   AND ps.item_type = 'S'
   AND ps.item_no = q.item_no || '-1'
   AND ps.colour_id = q.colour_id
  LEFT JOIN bricklink_pg_summary_cache nd
    ON nd.item_type = q.item_type AND nd.item_no = q.item_no
   AND nd.colour_id = q.colour_id AND nd.no_data
)
SELECT tier,
       status,
       count(*)::int                                   AS tuples,
       (count(*) FILTER (WHERE due_now))::int          AS due_now,
       (count(*) FILTER (WHERE has_uk_sold))::int      AS with_uk_sold,
       (count(*) FILTER (WHERE has_uk_stock))::int     AS with_uk_stock,
       round(100.0 * count(*) / sum(count(*)) OVER (PARTITION BY tier), 1) AS pct_of_tier
FROM classified
GROUP BY tier, status;

GRANT SELECT ON pg_coverage_report TO authenticated;
