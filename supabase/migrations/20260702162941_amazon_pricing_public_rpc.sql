-- Anon-safe Amazon pricing lookup for the Vinted Sniper extension: one call
-- returning Buy Box + 90d + BSR (sales_rank lives in the user-scoped
-- amazon_arbitrage_pricing table, which anon cannot read directly).
-- Mirrors the get_pov_public pattern. Applied to prod via MCP as 20260702162941.
CREATE OR REPLACE FUNCTION public.get_amazon_pricing_public(p_set_number text)
RETURNS TABLE (
  set_number      text,
  set_name        text,
  amazon_price    numeric,
  was_price_90d   numeric,
  uk_retail_price numeric,
  asin            text,
  sales_rank      integer
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT s.set_number::text,
         s.set_name,
         s.amazon_price,
         s.was_price_90d,
         s.uk_retail_price,
         s.asin,
         (SELECT a.sales_rank::int
          FROM amazon_arbitrage_pricing a
          WHERE a.asin = s.asin AND a.sales_rank IS NOT NULL
          LIMIT 1) AS sales_rank
  FROM seeded_asin_pricing s
  WHERE s.set_number IN (p_set_number, p_set_number || '-1', split_part(p_set_number, '-', 1) || '-1')
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.get_amazon_pricing_public(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_amazon_pricing_public(text) TO anon, authenticated, service_role;
