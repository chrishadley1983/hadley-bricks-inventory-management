-- eBay BIN Part-Out Watcher (discovery-driven, 2026-07-02)
-- ------------------------------------------------------------------------------------------------
-- 1. ebay_bin_hitlist — the target universe: sets whose USED part-out value (capped at New)
--    is a high multiple of RRP. Refreshed from bricklink_part_out_value_cache + brickset_sets
--    by refresh_ebay_bin_hitlist(); learned columns (ebay_floor_gbp, fig_share_pct) survive.
-- 2. ebay_bin_config — single-row scan config.
-- 3. ebay_auction_alerts gains listing_type/flags/offer columns (BIN alerts reuse the table
--    and its dedupe).

-- 1. ----------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.ebay_bin_hitlist (
  set_number        text PRIMARY KEY,
  set_name          text,
  theme             text,
  year_from         integer,
  pieces            integer,
  rrp_gbp           numeric,
  used_pov_gbp      numeric NOT NULL,   -- capped at the New part-out (77254 guard)
  new_pov_gbp       numeric,
  ratio             numeric NOT NULL,   -- used_pov_gbp / rrp_gbp (bootstrap denominator)
  fig_share_pct     numeric,            -- % of used POV carried by minifigs (backfilled)
  ebay_floor_gbp    numeric,            -- learned: cheapest genuine complete used ask seen
  ebay_floor_seen_at timestamptz,
  refreshed_at      timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.ebay_bin_hitlist ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated users can read the BIN hitlist"
  ON public.ebay_bin_hitlist FOR SELECT
  TO authenticated
  USING (true);

-- 2. ----------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.ebay_bin_config (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id               uuid NOT NULL,
  enabled               boolean NOT NULL DEFAULT true,
  min_multiple          numeric NOT NULL DEFAULT 3.0,   -- good buy: used POV >= N x total cost
  great_multiple        numeric NOT NULL DEFAULT 4.0,
  min_ratio             numeric NOT NULL DEFAULT 2.0,   -- hitlist: used POV / RRP floor
  min_used_pov_gbp      numeric NOT NULL DEFAULT 40,
  price_floor_pct       numeric NOT NULL DEFAULT 15,    -- below this % of POV = probable part listing
  max_price_gbp         numeric NOT NULL DEFAULT 250,
  quiet_hours_start     integer NOT NULL DEFAULT 23,
  quiet_hours_end       integer NOT NULL DEFAULT 7,
  hitlist_max_age_hours integer NOT NULL DEFAULT 24,
  last_scan_cursor      timestamptz,                    -- newest listing creation seen
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.ebay_bin_config ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can manage their own BIN config"
  ON public.ebay_bin_config FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

INSERT INTO public.ebay_bin_config (user_id)
VALUES ('4b6e94b4-661c-4462-9d14-b21df7d51e5b')
ON CONFLICT DO NOTHING;

-- 3. ----------------------------------------------------------------------------------------------
ALTER TABLE public.ebay_auction_alerts
  ADD COLUMN IF NOT EXISTS listing_type         text NOT NULL DEFAULT 'auction',
  ADD COLUMN IF NOT EXISTS flags                text,
  ADD COLUMN IF NOT EXISTS offer_suggestion_gbp numeric,
  ADD COLUMN IF NOT EXISTS ratio_to_rrp         numeric;

-- 4. ----------------------------------------------------------------------------------------------
-- Hit-list refresh: rebuilds qualifying rows, preserves learned columns, prunes drop-outs.
CREATE OR REPLACE FUNCTION public.refresh_ebay_bin_hitlist(
  p_min_ratio numeric DEFAULT 2.0,
  p_min_pov   numeric DEFAULT 40
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
    SELECT set_number, max(sold_6mo_avg_gbp) AS used_sold
    FROM bricklink_part_out_value_cache
    WHERE condition = 'U' AND NOT is_aggregate_listing AND sold_6mo_avg_gbp > 0
    GROUP BY set_number
  )
  SELECT u.set_number,
         n.set_name,
         b.theme,
         b.year_from,
         b.pieces,
         n.rrp AS rrp_gbp,
         LEAST(u.used_sold, coalesce(n.new_sold, u.used_sold)) AS used_pov_gbp,
         n.new_sold AS new_pov_gbp,
         LEAST(u.used_sold, coalesce(n.new_sold, u.used_sold)) / n.rrp AS ratio
  FROM u
  JOIN n USING (set_number)
  JOIN brickset_sets b ON b.set_number = u.set_number || '-1'
  WHERE n.rrp > 0
    AND b.year_from <= extract(year FROM now())::int - 2
    AND LEAST(u.used_sold, coalesce(n.new_sold, u.used_sold)) >= p_min_pov
    AND LEAST(u.used_sold, coalesce(n.new_sold, u.used_sold)) / n.rrp >= p_min_ratio;

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

REVOKE ALL ON FUNCTION public.refresh_ebay_bin_hitlist(numeric, numeric) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.refresh_ebay_bin_hitlist(numeric, numeric) TO service_role;

COMMENT ON TABLE public.ebay_bin_hitlist IS
  'Target universe for the eBay BIN part-out watcher: sets whose used part-out value (capped at New) is a high multiple of RRP. Learned columns ebay_floor_gbp/fig_share_pct survive refreshes.';
