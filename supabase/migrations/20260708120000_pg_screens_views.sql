-- PG Market Intelligence P2: sourcing screens (spec §3 F5, done-criteria F5).
--
-- Three SELECT-only views feeding apps/web/scripts/pg/pg-screens.ts:
--   pg_screen_high_str    - L1 part (item_type='P') high-STR buy-target screen.
--   pg_screen_fig_radar   - L1 minifig (item_type='M') screen + new/used spread.
--   pg_screen_trend_movers - L2 snapshots, MoM delta between each tuple's latest two
--                            monthly snapshot rows (the 28-day cycle writes one row per
--                            active tuple per pass, so "latest two" ~= month-over-month).
--
-- GBP normalisation: bricklink_pg_summary_cache carries a per-row `currency` + nullable
-- `fx_rate` (non-null only on converted, i.e. non-GBP-native, rows — see the P0 provenance
-- migration). Sold value is left NULL (excluded by the >= £20 floor) when a non-GBP row
-- has no fx_rate stamped, rather than guessing a rate — mirrors the same discipline used
-- in pg-rank.ts's rank_score computation.
--
-- security_invoker = true (Postgres 15+): views run with the querying role's own
-- permissions so the underlying tables' RLS policies are respected, not the view owner's.
-- No RLS is placed on the views themselves; GRANT SELECT is the read-authorization step.

CREATE OR REPLACE VIEW pg_screen_high_str
WITH (security_invoker = true) AS
WITH base AS (
  SELECT
    item_type,
    item_no,
    colour_id,
    str_new,
    str_used,
    sold6m_new_qty,
    sold6m_new_avg,
    sold6m_used_qty,
    sold6m_used_avg,
    (COALESCE(stock_new_qty, 0) + COALESCE(stock_used_qty, 0)) AS stock_qty,
    fetched_at,
    CASE
      WHEN currency IS NULL OR currency = 'GBP' THEN
        COALESCE(sold6m_new_qty, 0) * COALESCE(sold6m_new_avg, 0)
        + COALESCE(sold6m_used_qty, 0) * COALESCE(sold6m_used_avg, 0)
      WHEN fx_rate IS NOT NULL THEN
        (COALESCE(sold6m_new_qty, 0) * COALESCE(sold6m_new_avg, 0)
          + COALESCE(sold6m_used_qty, 0) * COALESCE(sold6m_used_avg, 0)) * fx_rate
      ELSE NULL -- non-GBP row with no stamped fx_rate: unconverted, excluded by the >=£20 floor below
    END AS sold_value_gbp
  FROM bricklink_pg_summary_cache
  WHERE item_type = 'P'
    AND no_data = false
)
SELECT
  item_type,
  item_no,
  colour_id,
  str_new,
  str_used,
  sold6m_new_qty,
  sold6m_new_avg,
  sold6m_used_qty,
  sold6m_used_avg,
  stock_qty,
  sold_value_gbp,
  CASE
    WHEN (COALESCE(sold6m_new_qty, 0) + COALESCE(sold6m_used_qty, 0)) > 0 THEN
      stock_qty / NULLIF((COALESCE(sold6m_new_qty, 0) + COALESCE(sold6m_used_qty, 0))::numeric / 6, 0)
    ELSE NULL
  END AS months_of_stock,
  fetched_at
FROM base
WHERE (str_used >= 0.5 OR str_new >= 0.5)
  AND sold_value_gbp >= 20;

COMMENT ON VIEW pg_screen_high_str IS
  'High-STR part buy-target screen (spec F5): L1 parts, STR>=0.5 either condition, GBP-normalised sold6m value >=£20, no_data=false.';

GRANT SELECT ON pg_screen_high_str TO authenticated;

-- ---------------------------------------------------------------------------

CREATE OR REPLACE VIEW pg_screen_fig_radar
WITH (security_invoker = true) AS
WITH base AS (
  SELECT
    item_type,
    item_no,
    colour_id,
    str_new,
    str_used,
    sold6m_new_qty,
    sold6m_new_avg,
    sold6m_used_qty,
    sold6m_used_avg,
    (COALESCE(stock_new_qty, 0) + COALESCE(stock_used_qty, 0)) AS stock_qty,
    fetched_at,
    CASE
      WHEN currency IS NULL OR currency = 'GBP' THEN
        COALESCE(sold6m_new_qty, 0) * COALESCE(sold6m_new_avg, 0)
        + COALESCE(sold6m_used_qty, 0) * COALESCE(sold6m_used_avg, 0)
      WHEN fx_rate IS NOT NULL THEN
        (COALESCE(sold6m_new_qty, 0) * COALESCE(sold6m_new_avg, 0)
          + COALESCE(sold6m_used_qty, 0) * COALESCE(sold6m_used_avg, 0)) * fx_rate
      ELSE NULL
    END AS sold_value_gbp
  FROM bricklink_pg_summary_cache
  WHERE item_type = 'M'
    AND no_data = false
)
SELECT
  item_type,
  item_no,
  colour_id,
  str_new,
  str_used,
  sold6m_new_qty,
  sold6m_new_avg,
  sold6m_used_qty,
  sold6m_used_avg,
  stock_qty,
  sold_value_gbp,
  CASE
    WHEN (COALESCE(sold6m_new_qty, 0) + COALESCE(sold6m_used_qty, 0)) > 0 THEN
      stock_qty / NULLIF((COALESCE(sold6m_new_qty, 0) + COALESCE(sold6m_used_qty, 0))::numeric / 6, 0)
    ELSE NULL
  END AS months_of_stock,
  -- Fig arbitrage signal: positive = new sells for a premium over used (normal); large
  -- negative/near-zero spreads flag figs where buying+parting used commons may beat new.
  (sold6m_new_avg - sold6m_used_avg) / NULLIF(sold6m_used_avg, 0) AS new_used_spread,
  fetched_at
FROM base
WHERE (str_used >= 0.5 OR str_new >= 0.5)
  AND sold_value_gbp >= 20;

COMMENT ON VIEW pg_screen_fig_radar IS
  'Fig radar screen (spec F5): L1 minifigs, same STR/value gate as pg_screen_high_str, plus new_used_spread = (new_avg - used_avg) / used_avg.';

GRANT SELECT ON pg_screen_fig_radar TO authenticated;

-- ---------------------------------------------------------------------------

CREATE OR REPLACE VIEW pg_screen_trend_movers
WITH (security_invoker = true) AS
WITH ranked AS (
  SELECT
    item_type,
    item_no,
    colour_id,
    snapshot_date,
    sold6m_new_qty,
    sold6m_new_avg,
    sold6m_used_qty,
    sold6m_used_avg,
    str_new,
    str_used,
    ROW_NUMBER() OVER (
      PARTITION BY item_type, item_no, colour_id
      ORDER BY snapshot_date DESC
    ) AS rn
  FROM bricklink_pg_snapshots
),
pivoted AS (
  SELECT
    item_type,
    item_no,
    colour_id,
    COUNT(*) FILTER (WHERE rn <= 2) AS snapshot_count,
    MAX(snapshot_date) FILTER (WHERE rn = 1) AS latest_date,
    MAX(snapshot_date) FILTER (WHERE rn = 2) AS prior_date,
    MAX(sold6m_new_qty) FILTER (WHERE rn = 1) AS latest_new_qty,
    MAX(sold6m_new_qty) FILTER (WHERE rn = 2) AS prior_new_qty,
    MAX(sold6m_new_avg) FILTER (WHERE rn = 1) AS latest_new_avg,
    MAX(sold6m_new_avg) FILTER (WHERE rn = 2) AS prior_new_avg,
    MAX(sold6m_used_qty) FILTER (WHERE rn = 1) AS latest_used_qty,
    MAX(sold6m_used_qty) FILTER (WHERE rn = 2) AS prior_used_qty,
    MAX(sold6m_used_avg) FILTER (WHERE rn = 1) AS latest_used_avg,
    MAX(sold6m_used_avg) FILTER (WHERE rn = 2) AS prior_used_avg,
    MAX(str_new) FILTER (WHERE rn = 1) AS latest_str_new,
    MAX(str_used) FILTER (WHERE rn = 1) AS latest_str_used
  FROM ranked
  WHERE rn <= 2
  GROUP BY item_type, item_no, colour_id
)
SELECT
  item_type,
  item_no,
  colour_id,
  latest_date,
  prior_date,
  latest_new_qty,
  prior_new_qty,
  (COALESCE(latest_new_qty, 0) - COALESCE(prior_new_qty, 0)) AS new_qty_delta,
  latest_new_avg,
  prior_new_avg,
  (latest_new_avg - prior_new_avg) AS new_avg_delta,
  latest_used_qty,
  prior_used_qty,
  (COALESCE(latest_used_qty, 0) - COALESCE(prior_used_qty, 0)) AS used_qty_delta,
  latest_used_avg,
  prior_used_avg,
  (latest_used_avg - prior_used_avg) AS used_avg_delta,
  latest_str_new,
  latest_str_used
FROM pivoted
-- Only tuples with two or more snapshot dates can have a MoM delta.
WHERE snapshot_count >= 2;

COMMENT ON VIEW pg_screen_trend_movers IS
  'Trend movers screen (spec F5): L2 snapshots, MoM delta of sold6m qty/avg between each tuple''s two most recent snapshot_date rows.';

GRANT SELECT ON pg_screen_trend_movers TO authenticated;
