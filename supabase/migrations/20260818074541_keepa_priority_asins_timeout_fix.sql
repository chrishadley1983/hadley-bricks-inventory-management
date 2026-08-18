-- Fix: get_keepa_priority_asins statement timeout (2026-08-18 06:02 Keepa sync failure).
--
-- The planner inlined the with_snapshots CTE, so the correlated
-- MAX(snapshot_date) subquery against amazon_arbitrage_pricing (427k rows) was
-- re-evaluated up to three times per ASIN inside the priority filter — six
-- separate subplans, ~24k index probes per call. Cold-cache runs blew the 8s
-- API statement timeout (3.1s warm).
--
-- Fix: MATERIALIZED CTEs + a LATERAL top-1 lookup so the latest snapshot is
-- computed exactly once per ASIN. Same signature, same results, same ordering.
-- Measured: 3,086ms -> 154ms on live data (8,032 ASINs).

CREATE OR REPLACE FUNCTION get_keepa_priority_asins(
  p_user_id uuid,
  p_today date,
  p_budget integer
)
RETURNS TABLE (
  asin text,
  quantity integer,
  last_snapshot date,
  priority integer  -- 1 = in-stock due its weekly refresh, 2 = stale backfill
) LANGUAGE sql STABLE AS $$
  WITH all_asins AS MATERIALIZED (
    SELECT ta.asin, ta.quantity
    FROM tracked_asins ta
    WHERE ta.user_id = p_user_id AND ta.status = 'active'
    UNION
    SELECT COALESCE(usp.manual_asin_override, sa.asin) AS asin, 0 AS quantity
    FROM user_seeded_asin_preferences usp
    JOIN seeded_asins sa ON sa.id = usp.seeded_asin_id
    WHERE usp.user_id = p_user_id
      AND usp.include_in_sync = true
      AND usp.user_status = 'active'
      AND COALESCE(usp.manual_asin_override, sa.asin) IS NOT NULL
    UNION
    -- intl-set-arb targets: trusted identity + fresh Tier-1 offers on BL
    SELECT bs.amazon_asin AS asin, 0 AS quantity
    FROM brickset_sets bs
    WHERE bs.amazon_asin IS NOT NULL
      AND bs.asin_confidence >= 95
      AND EXISTS (
        SELECT 1 FROM bricklink_price_guide_cache pg
        WHERE pg.item_type = 'S'
          AND pg.stock_offers IS NOT NULL
          AND pg.fetched_at >= (p_today - 10)
          AND (pg.item_no = bs.set_number OR pg.item_no = split_part(bs.set_number, '-', 1))
      )
  ),
  with_snapshots AS MATERIALIZED (
    SELECT a.asin, a.quantity, ls.last_snapshot
    FROM all_asins a
    LEFT JOIN LATERAL (
      SELECT ap.snapshot_date AS last_snapshot
      FROM amazon_arbitrage_pricing ap
      WHERE ap.asin = a.asin
      ORDER BY ap.snapshot_date DESC
      LIMIT 1
    ) ls ON true
  ),
  prioritised AS (
    SELECT
      ws.asin,
      ws.quantity,
      ws.last_snapshot,
      CASE
        WHEN ws.quantity > 0 THEN 1
        ELSE 2
      END AS priority
    FROM with_snapshots ws
    WHERE
      -- in-stock: due only when its snapshot is a week old (SP-API covers daily)
      (ws.quantity > 0 AND (ws.last_snapshot IS NULL OR ws.last_snapshot <= p_today - 7))
      -- everything else: stale-backfill daily eligibility, as before
      OR (ws.quantity = 0 AND (ws.last_snapshot IS NULL OR ws.last_snapshot < p_today))
  )
  SELECT p.asin, p.quantity, p.last_snapshot, p.priority
  FROM prioritised p
  ORDER BY
    p.priority ASC,
    COALESCE(p.last_snapshot, '1970-01-01'::date) ASC
  LIMIT p_budget;
$$;
