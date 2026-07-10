-- Migration: create_bricklink_price_guide_cache
-- Purpose: Rich per-(item, colour) UK price-guide cache fed by catalogPG.asp page scrapes
--          (CDP navigation, tilde-heuristic UK extraction — validated 2026-07-07 to exactly
--          reproduce the BL API's country_code=UK figures). One page = both conditions ×
--          sold+stock, plus median and monthly velocity the API cannot affordably give.
-- Mirrors conventions from bricklink_part_out_value_cache (shared cache, RLS authenticated).

CREATE TABLE bricklink_price_guide_cache (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Identity: the scrape unit is one catalogPG page = (item_type, item_no, colour_id).
  -- item_no for sets carries the "-1" sequence suffix (catalogPG 404s without it).
  -- colour_id is 0 for sets/minifigs (no colour dimension).
  item_type CHAR(1) NOT NULL CHECK (item_type IN ('P', 'S', 'M')),
  item_no VARCHAR(50) NOT NULL,
  colour_id INTEGER NOT NULL DEFAULT 0,
  item_name TEXT,

  -- UK 6-month SOLD (native-GBP transactions only), flattened per condition for SQL gating.
  -- *_lots = number of transactions (API unit_quantity); *_qty = pieces (API total_quantity).
  uk_sold_avg_new DECIMAL(12,4),
  uk_sold_avg_used DECIMAL(12,4),
  uk_sold_qty_avg_new DECIMAL(12,4),
  uk_sold_qty_avg_used DECIMAL(12,4),
  uk_sold_median_new DECIMAL(12,4),
  uk_sold_median_used DECIMAL(12,4),
  uk_sold_lots_new INTEGER NOT NULL DEFAULT 0,
  uk_sold_lots_used INTEGER NOT NULL DEFAULT 0,
  uk_sold_qty_new INTEGER NOT NULL DEFAULT 0,
  uk_sold_qty_used INTEGER NOT NULL DEFAULT 0,
  -- Pieces sold in the most recent 2 calendar months (velocity recency signal).
  uk_sold_last2mo_qty_new INTEGER NOT NULL DEFAULT 0,
  uk_sold_last2mo_qty_used INTEGER NOT NULL DEFAULT 0,

  -- UK current STOCK (native-GBP listings only).
  uk_stock_qty_new INTEGER NOT NULL DEFAULT 0,
  uk_stock_qty_used INTEGER NOT NULL DEFAULT 0,
  uk_stock_lots_new INTEGER NOT NULL DEFAULT 0,
  uk_stock_lots_used INTEGER NOT NULL DEFAULT 0,
  uk_stock_min_new DECIMAL(12,4),
  uk_stock_min_used DECIMAL(12,4),

  -- Full distribution + monthly buckets per quadrant (min/max/by_month), and the
  -- worldwide (all-currency, GBP-converted) quadrant aggregates from the same page.
  uk_detail JSONB,
  world_detail JSONB,

  parse_version INTEGER NOT NULL DEFAULT 1,
  fetched_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT bricklink_price_guide_cache_unique_item
    UNIQUE (item_type, item_no, colour_id)
);

CREATE INDEX idx_bl_pg_cache_item ON bricklink_price_guide_cache(item_no);
CREATE INDEX idx_bl_pg_cache_fetched ON bricklink_price_guide_cache(fetched_at);

ALTER TABLE bricklink_price_guide_cache ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read pg cache"
  ON bricklink_price_guide_cache FOR SELECT TO authenticated USING (TRUE);

CREATE POLICY "Authenticated users can insert pg cache"
  ON bricklink_price_guide_cache FOR INSERT TO authenticated WITH CHECK (TRUE);

CREATE POLICY "Authenticated users can update pg cache"
  ON bricklink_price_guide_cache FOR UPDATE TO authenticated USING (TRUE) WITH CHECK (TRUE);
