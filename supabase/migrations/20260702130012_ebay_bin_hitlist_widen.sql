-- Widen the BIN part-out hit list to EVERY set with usable used-POV data
-- (per Chris 2026-07-02: the multiple bar is the real filter; no GBP40 floor,
-- no ratio floor, young sets included and FLAGGED at alert time instead of
-- excluded). The broad eBay scan is processed locally, so universe size does
-- not change API spend. Applied to prod via MCP as version 20260702130012.

ALTER TABLE public.ebay_bin_hitlist ALTER COLUMN ratio DROP NOT NULL;

CREATE OR REPLACE FUNCTION public.refresh_ebay_bin_hitlist(
  p_min_ratio numeric DEFAULT 0,
  p_min_pov   numeric DEFAULT 0
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count integer;
BEGIN
  CREATE TEMP TABLE _fresh ON COMMIT DROP AS
  WITH n AS (
    SELECT set_number,
           max(uk_retail_gbp)    AS rrp,
           max(sold_6mo_avg_gbp) AS new_sold,
           max(set_name)         AS set_name
    FROM bricklink_part_out_value_cache
    WHERE condition = 'N' AND NOT is_aggregate_listing
    GROUP BY set_number
  ), u AS (
    SELECT set_number, max(sold_6mo_avg_gbp) AS used_sold, max(set_name) AS set_name
    FROM bricklink_part_out_value_cache
    WHERE condition = 'U' AND NOT is_aggregate_listing AND sold_6mo_avg_gbp > 0
    GROUP BY set_number
  )
  SELECT u.set_number,
         coalesce(n.set_name, u.set_name) AS set_name,
         b.theme,
         b.year_from,
         b.pieces,
         n.rrp AS rrp_gbp,
         LEAST(u.used_sold, coalesce(n.new_sold, u.used_sold)) AS used_pov_gbp,
         n.new_sold AS new_pov_gbp,
         CASE WHEN n.rrp > 0
              THEN LEAST(u.used_sold, coalesce(n.new_sold, u.used_sold)) / n.rrp
         END AS ratio
  FROM u
  LEFT JOIN n USING (set_number)
  LEFT JOIN brickset_sets b ON b.set_number = u.set_number || '-1'
  WHERE LEAST(u.used_sold, coalesce(n.new_sold, u.used_sold)) >= p_min_pov
    AND (p_min_ratio <= 0
         OR (n.rrp > 0 AND LEAST(u.used_sold, coalesce(n.new_sold, u.used_sold)) / n.rrp >= p_min_ratio));

  DELETE FROM ebay_bin_hitlist h
  WHERE NOT EXISTS (SELECT 1 FROM _fresh f WHERE f.set_number = h.set_number);

  INSERT INTO ebay_bin_hitlist AS h
    (set_number, set_name, theme, year_from, pieces, rrp_gbp, used_pov_gbp, new_pov_gbp, ratio, refreshed_at)
  SELECT set_number, set_name, theme, year_from, pieces, rrp_gbp, used_pov_gbp, new_pov_gbp, ratio, now()
  FROM _fresh
  ON CONFLICT (set_number) DO UPDATE SET
    set_name     = excluded.set_name,
    theme        = excluded.theme,
    year_from    = excluded.year_from,
    pieces       = excluded.pieces,
    rrp_gbp      = excluded.rrp_gbp,
    used_pov_gbp = excluded.used_pov_gbp,
    new_pov_gbp  = excluded.new_pov_gbp,
    ratio        = excluded.ratio,
    refreshed_at = now();
    -- ebay_floor_gbp / ebay_floor_seen_at / fig_share_pct deliberately untouched

  SELECT count(*) INTO v_count FROM ebay_bin_hitlist;
  RETURN v_count;
END;
$$;

UPDATE public.ebay_bin_config SET min_ratio = 0, min_used_pov_gbp = 0, updated_at = now();
