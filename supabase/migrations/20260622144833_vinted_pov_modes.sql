-- Vinted/eBay Part-Out-Value buy modes
-- ------------------------------------------------------------------------------------------------
-- 1. get_pov_public(set_number): anon-readable POV lookup for the Vinted Sniper browser extension.
--    The extension talks to PostgREST with the ANON key, but bricklink_part_out_value_cache only
--    grants read to `authenticated`. Rather than open the whole table to anon (which would also
--    leak my_inv_* holdings), expose a SECURITY DEFINER function that returns ONLY the public POV
--    columns for a set — both N and U condition rows, aggregate-listing rows excluded (their
--    multiple is inflated ~Nx; see migration 20260618081650). Mirrors how seeded_asin_pricing is
--    surfaced to anon today. search_path pinned; callers may pass "10307" or "10307-1".
-- 2. POV/mode columns on vinted_sniper_decisions so the audit log captures which mode fired.
-- 3. POV buy-signal config on ebay_auction_config (used by the eBay auction cron).

-- 1. ----------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_pov_public(p_set_number text)
RETURNS TABLE (
  set_number       text,
  item_seq         integer,
  set_name         text,
  condition        text,
  sold_6mo_avg_gbp numeric,
  for_sale_avg_gbp numeric,
  uk_retail_gbp    numeric,
  partout_multiple numeric,
  sold_6mo_lots    integer,
  no_data_reason   text,
  fetched_at       timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT c.set_number::text,
         c.item_seq,
         c.set_name,
         c.condition::text,
         c.sold_6mo_avg_gbp,
         c.for_sale_avg_gbp,
         c.uk_retail_gbp,
         c.partout_multiple,
         c.sold_6mo_lots,
         c.no_data_reason,
         c.fetched_at
  FROM public.bricklink_part_out_value_cache c
  WHERE c.set_number = split_part(p_set_number, '-', 1)
    AND NOT c.is_aggregate_listing
  ORDER BY c.item_seq ASC, c.condition ASC;
$$;

REVOKE ALL ON FUNCTION public.get_pov_public(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_pov_public(text) TO anon, authenticated, service_role;

COMMENT ON FUNCTION public.get_pov_public(text) IS
  'Anon-safe BrickLink Part-Out-Value lookup for the Vinted Sniper extension. Returns N + U rows '
  '(aggregate listings excluded, my_inv_* withheld) for a bare or variant set number.';

-- 2. ----------------------------------------------------------------------------------------------
ALTER TABLE public.vinted_sniper_decisions
  ADD COLUMN IF NOT EXISTS mode              text,
  ADD COLUMN IF NOT EXISTS condition_class   text,
  ADD COLUMN IF NOT EXISTS pov_new_sold_gbp  numeric,
  ADD COLUMN IF NOT EXISTS pov_used_sold_gbp numeric,
  ADD COLUMN IF NOT EXISTS pov_multiple_new  numeric,
  ADD COLUMN IF NOT EXISTS pov_multiple_used numeric,
  ADD COLUMN IF NOT EXISTS pov_signal        text;

-- 3. ----------------------------------------------------------------------------------------------
ALTER TABLE public.ebay_auction_config
  ADD COLUMN IF NOT EXISTS pov_buy_enabled       boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS pov_multiple          numeric NOT NULL DEFAULT 3.0,
  ADD COLUMN IF NOT EXISTS pov_great_multiple    numeric NOT NULL DEFAULT 4.0,
  ADD COLUMN IF NOT EXISTS used_pov_mode_enabled boolean NOT NULL DEFAULT false;

-- 4. ----------------------------------------------------------------------------------------------
-- POV audit columns on the eBay alert history (used-mode alerts carry no Amazon data).
ALTER TABLE public.ebay_auction_alerts
  ADD COLUMN IF NOT EXISTS pov_condition text,
  ADD COLUMN IF NOT EXISTS pov_sold_gbp  numeric,
  ADD COLUMN IF NOT EXISTS pov_multiple  numeric,
  ADD COLUMN IF NOT EXISTS buy_signal    text;
