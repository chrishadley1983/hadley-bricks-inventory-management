-- PG coverage truth (audit 2026-07-20).
-- Root cause: pg-universe --seed-from-cache stamped last_refreshed_at on every L1-seeded
-- queue row, overloading "skip gap-fill" with "UK price is fresh" — ~78k rows read as
-- covered that were never UK-scraped, and every coverage metric keyed off the queue lied.
-- See docs/features/pg-market-intelligence/coverage-metric-review-2026-07-20.md.
--
-- This migration: (1) gives the seed stamp its own column, (2) corrects the data,
-- (3) records confirmed no-data scrapes properly, (4) parks not-in-catalog tuples,
-- (5) accelerates active-tier first-touch, (6) adopts orphan L3 tuples, and
-- (7) creates pg_coverage_report — THE canonical coverage/staleness/yield statement.

-- ---------------------------------------------------------------------------
-- 1. seeded_at: "offered by a seed/enqueue path, skip gap-fill" — distinct from
--    last_refreshed_at, which from now on means "actually scraped" only.
ALTER TABLE bl_pg_refresh_queue ADD COLUMN IF NOT EXISTS seeded_at timestamptz;

-- ---------------------------------------------------------------------------
-- 2. Record the lane-D confirmed no-data scrapes properly BEFORE the un-stamp pass:
--    a genuine "never sold/listed anywhere" result is a successful scrape whose answer
--    is empty — it gets a zero L1 row (no_data=true) and counts as covered until the
--    normal 90d cycle re-checks it. (731 rows at audit time.)
INSERT INTO bricklink_pg_summary_cache
  (item_type, item_no, colour_id, currency, source, no_data, fetch_identity, fetched_at, updated_at)
SELECT q.item_type, q.item_no, q.colour_id, 'GBP', 'catalogpg', true, 'catalogpg_cdp',
       q.updated_at, now()
FROM bl_pg_refresh_queue q
WHERE q.last_error LIKE 'Price guide has no sales/stock%'
ON CONFLICT (item_type, item_no, colour_id) DO NOTHING;

UPDATE bl_pg_refresh_queue
SET last_refreshed_at = updated_at,
    attempts = 0,
    last_error = NULL
WHERE last_error LIKE 'Price guide has no sales/stock%';

-- ---------------------------------------------------------------------------
-- 3. Un-fake the seed stamps: any stamped row with NO backing evidence (no L3 UK row
--    via exact or set '-1'-suffix identity, no L1 no-data record) is a seed placeholder.
--    Move the stamp to seeded_at so pg-residual-fill keeps its skip semantics without
--    last_refreshed_at lying about UK freshness.
UPDATE bl_pg_refresh_queue q
SET seeded_at = q.last_refreshed_at,
    last_refreshed_at = NULL
WHERE q.last_refreshed_at IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM bricklink_price_guide_cache p
    WHERE p.item_type = q.item_type AND p.colour_id = q.colour_id
      AND (p.item_no = q.item_no
           OR (q.item_type = 'S' AND q.item_no !~ '-\d+$' AND p.item_no = q.item_no || '-1'))
  )
  AND NOT EXISTS (
    SELECT 1 FROM bricklink_pg_summary_cache s
    WHERE s.item_type = q.item_type AND s.item_no = q.item_no AND s.colour_id = q.colour_id
      AND s.no_data
  );

-- ---------------------------------------------------------------------------
-- 4. Backfill queue stamps for tuples that WERE page-scraped ad-hoc (store scans wrote
--    L3 but never told the queue): stamp the real scrape time and push next_due_at to
--    the tier-correct cycle so tonight's lane D doesn't redo daytime work.
UPDATE bl_pg_refresh_queue q
SET last_refreshed_at = p.fetched_at,
    next_due_at = p.fetched_at
      + CASE WHEN q.tier = 'active' THEN interval '60 days' ELSE interval '90 days' END
FROM bricklink_price_guide_cache p
WHERE q.last_refreshed_at IS NULL
  AND p.item_type = q.item_type AND p.colour_id = q.colour_id
  AND (p.item_no = q.item_no
       OR (q.item_type = 'S' AND q.item_no !~ '-\d+$' AND p.item_no = q.item_no || '-1'));

-- ---------------------------------------------------------------------------
-- 5. Park not-in-catalog tuples (PgNotFoundError is permanent — the 90d recycle was a
--    bug). last_error keeps the provenance; the coverage view surfaces them.
UPDATE bl_pg_refresh_queue
SET next_due_at = now() + interval '100 years'
WHERE last_error LIKE 'Not in BL catalog%';

-- ---------------------------------------------------------------------------
-- 6. First-touch acceleration: never-scraped ACTIVE tuples were hiding behind random
--    seed due-dates spread to ~October; make them due now so the nightly cadence
--    (~2,100/night) drains the genuine backlog in order. Tail keeps its 90-day spread.
UPDATE bl_pg_refresh_queue q
SET next_due_at = now()
WHERE q.tier = 'active'
  AND q.last_refreshed_at IS NULL
  AND q.next_due_at > now();

-- ---------------------------------------------------------------------------
-- 7. Adopt orphan L3 tuples (ad-hoc scrapes outside the seeded universe — e.g. the
--    2026-07-17 torso-split arm×colour sweep): they have real UK data but no queue row,
--    so nothing would ever refresh them. tier=tail, cycle-correct due date.
INSERT INTO bl_pg_refresh_queue
  (item_type, item_no, colour_id, tier, rank_score, rank_floor, last_refreshed_at, next_due_at)
SELECT p.item_type, p.item_no, p.colour_id, 'tail', 0, 'catalog_backfill_l3_orphan',
       p.fetched_at, p.fetched_at + interval '90 days'
FROM bricklink_price_guide_cache p
WHERE NOT EXISTS (
  SELECT 1 FROM bl_pg_refresh_queue q
  WHERE q.item_type = p.item_type AND q.colour_id = p.colour_id
    AND (q.item_no = p.item_no
         OR (p.item_type = 'S' AND q.item_no = regexp_replace(p.item_no, '-1$', '')))
)
ON CONFLICT (item_type, item_no, colour_id) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 8. THE canonical coverage/staleness/yield report. Truth = L3 presence + fetched_at
--    (and L1 no_data records), never queue.last_refreshed_at. Ask the daily question with:
--      SELECT * FROM pg_coverage_report ORDER BY tier, tuples DESC;
--    Statuses: fresh / stale (L3-scraped, within/past the 60d-active|90d-tail cycle),
--    no_data_fresh / no_data_stale (confirmed empty), not_in_catalog, error_parked
--    (attempts >= 8, operator attention), never_scraped.
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
           WHEN l3.fetched_at >= now() - make_interval(days => q.cycle_days) THEN 'fresh'
           WHEN l3.fetched_at IS NOT NULL                                    THEN 'stale'
           WHEN nd.fetched_at >= now() - make_interval(days => q.cycle_days) THEN 'no_data_fresh'
           WHEN nd.fetched_at IS NOT NULL                                    THEN 'no_data_stale'
           WHEN q.last_error LIKE 'Not in BL catalog%'                       THEN 'not_in_catalog'
           WHEN q.attempts >= 8                                              THEN 'error_parked'
           ELSE 'never_scraped'
         END AS status,
         COALESCE(l3.uk_sold_lots_new, 0) + COALESCE(l3.uk_sold_lots_used, 0) > 0 AS has_uk_sold,
         COALESCE(l3.uk_stock_lots_new, 0) + COALESCE(l3.uk_stock_lots_used, 0) > 0 AS has_uk_stock
  FROM q
  LEFT JOIN LATERAL (
    SELECT p.fetched_at, p.uk_sold_lots_new, p.uk_sold_lots_used,
           p.uk_stock_lots_new, p.uk_stock_lots_used
    FROM bricklink_price_guide_cache p
    WHERE p.item_type = q.item_type AND p.colour_id = q.colour_id
      AND (p.item_no = q.item_no
           OR (q.item_type = 'S' AND q.item_no !~ '-\d+$' AND p.item_no = q.item_no || '-1'))
    ORDER BY p.fetched_at DESC
    LIMIT 1
  ) l3 ON true
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
