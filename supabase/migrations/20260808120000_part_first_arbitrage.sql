-- Part-first arbitrage (feature/part-first-arbitrage).
--
-- 1. bl_store_lots: flattened, indexed copy of bl_store_scrapes.lots so "which UK
--    stores stock part X and at what ask" is one indexed query instead of a
--    jsonb_array_elements scan over ~2.5M elements. Refreshed per store by
--    refresh_bl_store_lots() whenever store-assessment writes a scrape.
-- 2. part_arb_candidates: persisted findings from the part-first discovery run
--    (anchor part -> nominated store -> concentrated basket), so runs are
--    comparable day to day and the ground/buy stage can update status.

-- ---------------------------------------------------------------------------
-- 1. Flattened store lots
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS bl_store_lots (
  store_slug text NOT NULL REFERENCES bl_store_scrapes(store_slug) ON DELETE CASCADE,
  inv_id bigint NOT NULL,
  item_type char(1) NOT NULL CHECK (item_type IN ('P', 'S', 'M')),
  item_no text NOT NULL,
  -- BL colour id; 0 for sets/minifigs (same normalisation as bl_pg_refresh_queue).
  colour_id integer NOT NULL DEFAULT 0,
  condition char(1) NOT NULL CHECK (condition IN ('N', 'U')),
  inv_qty integer NOT NULL,
  unit_price_gbp numeric(12, 4) NOT NULL,
  description text,
  -- Copied from the parent scrape so freshness checks never need the jsonb row.
  scanned_at timestamptz NOT NULL,
  PRIMARY KEY (store_slug, inv_id)
);

-- The part-first lookup: anchor tuple -> stores/asks.
CREATE INDEX IF NOT EXISTS idx_bl_store_lots_tuple
  ON bl_store_lots (item_type, item_no, colour_id);

ALTER TABLE bl_store_lots ENABLE ROW LEVEL SECURITY;

CREATE POLICY bl_store_lots_read ON bl_store_lots
  FOR SELECT TO authenticated USING (true);

COMMENT ON TABLE bl_store_lots IS
  'Flattened bl_store_scrapes.lots (one row per lot), refreshed per store by refresh_bl_store_lots(). Enables indexed part->stores lookups for part-first arbitrage.';

-- Per-store freshness of the flattened copy vs the parent scrape, so the discover
-- run can re-flatten only stores whose scrape moved on.
CREATE OR REPLACE VIEW bl_store_lots_freshness
  WITH (security_invoker = on) AS
SELECT
  s.store_slug,
  s.scanned_at AS scrape_scanned_at,
  s.lot_count AS scrape_lot_count,
  f.flattened_at,
  COALESCE(f.lot_rows, 0) AS lot_rows,
  (f.flattened_at IS NULL OR f.flattened_at < s.scanned_at) AS needs_refresh
FROM bl_store_scrapes s
LEFT JOIN (
  SELECT store_slug, max(scanned_at) AS flattened_at, count(*) AS lot_rows
  FROM bl_store_lots
  GROUP BY store_slug
) f USING (store_slug);

COMMENT ON VIEW bl_store_lots_freshness IS
  'Per-store flatten status: needs_refresh = the flattened copy is missing or older than the latest scrape.';

-- Refresh one store''s flattened lots from its latest scrape. Called per slug
-- (never bulk) so each call stays far inside statement timeouts.
CREATE OR REPLACE FUNCTION refresh_bl_store_lots(p_slug text)
RETURNS integer
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_inserted integer;
BEGIN
  DELETE FROM bl_store_lots WHERE store_slug = p_slug;

  INSERT INTO bl_store_lots
    (store_slug, inv_id, item_type, item_no, colour_id, condition, inv_qty,
     unit_price_gbp, description, scanned_at)
  SELECT
    s.store_slug,
    (l ->> 'invID')::bigint,
    l ->> 'itemType',
    l ->> 'itemNo',
    CASE WHEN l ->> 'itemType' = 'P' THEN COALESCE((l ->> 'colourId')::integer, 0) ELSE 0 END,
    CASE WHEN l ->> 'invNew' = 'New' THEN 'N' ELSE 'U' END,
    COALESCE((l ->> 'invQty')::integer, 0),
    COALESCE((l ->> 'unitPriceGBP')::numeric, 0),
    NULLIF(l ->> 'description', ''),
    s.scanned_at
  FROM bl_store_scrapes s
  CROSS JOIN LATERAL jsonb_array_elements(s.lots) l
  WHERE s.store_slug = p_slug
    AND (l ->> 'invID') IS NOT NULL
  ON CONFLICT (store_slug, inv_id) DO NOTHING;

  GET DIAGNOSTICS v_inserted = ROW_COUNT;
  RETURN v_inserted;
END;
$$;

-- Scripts (service role) drive the refresh; browser roles have no business calling it.
REVOKE EXECUTE ON FUNCTION refresh_bl_store_lots(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION refresh_bl_store_lots(text) TO service_role;

-- ---------------------------------------------------------------------------
-- 2. Part-first arbitrage candidates
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS part_arb_candidates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_at timestamptz NOT NULL DEFAULT now(),
  user_id uuid,
  store_slug text NOT NULL,
  store_name text,
  -- Anchor hits that nominated this store: the undervalued high-STR tuples and
  -- the store's asks against maxViableAsk.
  anchor_count integer NOT NULL,
  anchors jsonb NOT NULL,
  -- Basket summary straight from the common bl-store-report DecisionSummary —
  -- same demand cap, gate ladder and standalone-postage rules as every surface.
  basket_lots integer NOT NULL,
  basket_outlay_gbp numeric(12, 2),
  basket_raw_net_gbp numeric(12, 2),
  basket_capped_net_gbp numeric(12, 2),
  basket_liquid_net_gbp numeric(12, 2),
  inbound_postage_gbp numeric(8, 2) NOT NULL,
  -- Freshness of the cached scrape the nomination was built on. The ground stage
  -- re-scrapes live before any wanted list / cart is built.
  scanned_at timestamptz,
  inputs jsonb NOT NULL,
  report_md text,
  status text NOT NULL DEFAULT 'candidate'
    CHECK (status IN ('candidate', 'grounded', 'bought', 'dismissed')),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_part_arb_candidates_run ON part_arb_candidates (run_at DESC);
CREATE INDEX IF NOT EXISTS idx_part_arb_candidates_store ON part_arb_candidates (store_slug, run_at DESC);

ALTER TABLE part_arb_candidates ENABLE ROW LEVEL SECURITY;

CREATE POLICY part_arb_candidates_read ON part_arb_candidates
  FOR SELECT TO authenticated USING (true);

COMMENT ON TABLE part_arb_candidates IS
  'Part-first arbitrage findings: anchor parts (high STR, underpriced vs UK 6MA) -> nominated store -> concentrated-basket summary. Written by scripts/part-arb.ts; status advanced by the ground/buy stage.';
