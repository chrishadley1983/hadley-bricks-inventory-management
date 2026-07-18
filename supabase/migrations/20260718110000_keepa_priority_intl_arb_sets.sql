-- intl-set-arb F3: heal Amazon sell-side coverage for arb-target sets.
-- Adds a third source to get_keepa_priority_asins: trusted-ASIN sets that have
-- fresh Tier-1 stock_offers but no amazon_arbitrage_pricing snapshot in the last
-- 7 days. quantity=0 (not our stock) -> tier-2 stale backfill; never-snapshotted
-- rows sort first via the epoch coalesce, so ~1.8k arb-set ASINs drain through
-- the existing daily budget over a week or two without starving in-stock tier 1.

CREATE OR REPLACE FUNCTION get_keepa_priority_asins(
  p_user_id uuid,
  p_today date,
  p_budget integer
)
RETURNS TABLE (
  asin text,
  quantity integer,
  last_snapshot date,
  priority integer  -- 1 = in-stock needing refresh, 2 = stale backfill
) LANGUAGE sql STABLE AS $$
  WITH all_asins AS (
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
        THEN 1
        ELSE 2
      END AS priority
    FROM with_snapshots ws
    WHERE ws.last_snapshot IS NULL OR ws.last_snapshot < p_today
  )
  SELECT p.asin, p.quantity, p.last_snapshot, p.priority
  FROM prioritised p
  ORDER BY
    p.priority ASC,
    COALESCE(p.last_snapshot, '1970-01-01'::date) ASC
  LIMIT p_budget;
$$;
