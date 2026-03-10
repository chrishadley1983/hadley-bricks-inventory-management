-- RPC to get prioritised ASINs for Keepa sync in a single query.
-- Returns in-stock ASINs needing refresh first, then stalest remaining.
-- Replaces 10+ paginated queries with 1 efficient SQL call.
CREATE OR REPLACE FUNCTION get_keepa_priority_asins(
  p_user_id uuid,
  p_today date,
  p_budget integer
)
RETURNS TABLE (
  asin text,
  quantity integer,
  last_snapshot date,
  priority integer  -- 1 = in-stock needing refresh, 2 = stale
) LANGUAGE sql STABLE AS $$
  WITH all_asins AS (
    -- Tracked ASINs
    SELECT ta.asin, ta.quantity
    FROM tracked_asins ta
    WHERE ta.user_id = p_user_id AND ta.status = 'active'
    UNION
    -- Seeded ASINs (quantity 0 since they're not in inventory)
    SELECT COALESCE(usp.manual_asin_override, sa.asin) AS asin, 0 AS quantity
    FROM user_seeded_asin_preferences usp
    JOIN seeded_asins sa ON sa.id = usp.seeded_asin_id
    WHERE usp.user_id = p_user_id
      AND usp.include_in_sync = true
      AND usp.user_status = 'active'
      AND COALESCE(usp.manual_asin_override, sa.asin) IS NOT NULL
  ),
  with_snapshots AS (
    SELECT
      a.asin,
      a.quantity,
      (SELECT MAX(ap.snapshot_date)
       FROM amazon_arbitrage_pricing ap
       WHERE ap.asin = a.asin) AS last_snapshot
    FROM all_asins a
  ),
  prioritised AS (
    SELECT
      ws.asin,
      ws.quantity,
      ws.last_snapshot,
      CASE
        WHEN ws.quantity > 0 AND (ws.last_snapshot IS NULL OR ws.last_snapshot < p_today)
        THEN 1  -- Tier 1: in-stock, needs refresh today
        ELSE 2  -- Tier 2: stale backfill
      END AS priority
    FROM with_snapshots ws
    WHERE ws.last_snapshot IS NULL OR ws.last_snapshot < p_today  -- Skip already refreshed today
  )
  SELECT p.asin, p.quantity, p.last_snapshot, p.priority
  FROM prioritised p
  ORDER BY
    p.priority ASC,
    COALESCE(p.last_snapshot, '1970-01-01'::date) ASC
  LIMIT p_budget;
$$;
