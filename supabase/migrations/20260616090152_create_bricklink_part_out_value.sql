-- Migration: create_bricklink_part_out_value
-- Purpose: Cache BrickLink "Part Out Value" (POV) scrape results per set + option-variant,
--          with UK retail (Brickset RRP) and a generated part-out multiple. Plus a single-row
--          config table holding conversationally-editable defaults.
-- Source : docs/features/bl-part-out-value/phase-1.md
-- Mirrors conventions from bricklink_part_price_cache (shared cache, RLS read+write authenticated).

-- ---------------------------------------------------------------------------
-- Cache table: one row per (set + option-variant)
-- ---------------------------------------------------------------------------
CREATE TABLE bricklink_part_out_value_cache (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Identity / option-variant key (different options => different POV figure)
  set_number VARCHAR(50) NOT NULL,            -- bare BL itemNo, e.g. "77075"
  set_name TEXT,
  item_seq INTEGER NOT NULL DEFAULT 1,
  condition CHAR(1) NOT NULL DEFAULT 'N',     -- 'N' (New) | 'U' (Used)
  break_type CHAR(1) NOT NULL DEFAULT 'M',    -- 'M' (parts + whole minifigs) | 'B' (break figs)
  inc_instructions BOOLEAN NOT NULL DEFAULT TRUE,
  inc_box BOOLEAN NOT NULL DEFAULT FALSE,
  inc_extra BOOLEAN NOT NULL DEFAULT FALSE,
  inc_break BOOLEAN NOT NULL DEFAULT FALSE,

  -- Native scrape values (currency depends on session: GBP logged-in, USD logged-out)
  native_currency VARCHAR(8),                 -- 'GBP' | 'USD' | ...
  sold_6mo_native DECIMAL(12,4),
  sold_6mo_items INTEGER,
  sold_6mo_lots INTEGER,
  for_sale_native DECIMAL(12,4),
  for_sale_items INTEGER,
  for_sale_lots INTEGER,
  my_inv_native DECIMAL(12,4),                -- only present logged-in; nullable
  my_inv_items INTEGER,
  my_inv_lots INTEGER,
  not_included_items INTEGER,
  not_included_lots INTEGER,

  -- GBP-normalised values (= native when native_currency = 'GBP')
  sold_6mo_avg_gbp DECIMAL(12,4),
  for_sale_avg_gbp DECIMAL(12,4),
  usd_to_gbp_rate DECIMAL(10,6),              -- rate applied when converting from USD; null if native GBP

  -- UK retail (Brickset RRP), denormalised so the generated multiple can reference it
  uk_retail_gbp DECIMAL(10,2),
  retail_source VARCHAR(40),                  -- e.g. 'brickset_sets' | 'brickset_api'
  retail_fetched_at TIMESTAMPTZ,

  -- Derived: realistic part-out multiple = 6mo sold avg (GBP) / UK RRP. Null-safe.
  partout_multiple NUMERIC GENERATED ALWAYS AS (sold_6mo_avg_gbp / NULLIF(uk_retail_gbp, 0)) STORED,

  fetched_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT bricklink_part_out_value_cache_unique_variant
    UNIQUE (set_number, item_seq, condition, break_type,
            inc_instructions, inc_box, inc_extra, inc_break)
);

CREATE INDEX idx_bl_pov_cache_set ON bricklink_part_out_value_cache(set_number);
CREATE INDEX idx_bl_pov_cache_fetched ON bricklink_part_out_value_cache(fetched_at);
CREATE INDEX idx_bl_pov_cache_multiple ON bricklink_part_out_value_cache(partout_multiple DESC);

ALTER TABLE bricklink_part_out_value_cache ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read pov cache"
  ON bricklink_part_out_value_cache FOR SELECT TO authenticated USING (TRUE);

CREATE POLICY "Authenticated users can insert pov cache"
  ON bricklink_part_out_value_cache FOR INSERT TO authenticated WITH CHECK (TRUE);

CREATE POLICY "Authenticated users can update pov cache"
  ON bricklink_part_out_value_cache FOR UPDATE TO authenticated USING (TRUE) WITH CHECK (TRUE);

-- ---------------------------------------------------------------------------
-- Config table: single row (id = 1) of conversationally-editable defaults
-- ---------------------------------------------------------------------------
CREATE TABLE bricklink_pov_config (
  id INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  default_condition CHAR(1) NOT NULL DEFAULT 'N',
  default_break_type CHAR(1) NOT NULL DEFAULT 'M',
  default_inc_instructions BOOLEAN NOT NULL DEFAULT TRUE,
  default_inc_box BOOLEAN NOT NULL DEFAULT FALSE,
  default_inc_extra BOOLEAN NOT NULL DEFAULT FALSE,
  default_inc_break BOOLEAN NOT NULL DEFAULT FALSE,
  freshness_days INTEGER NOT NULL DEFAULT 30,
  backfill_delay_ms INTEGER NOT NULL DEFAULT 12000,
  backfill_batch_size INTEGER NOT NULL DEFAULT 25,
  usd_to_gbp_rate DECIMAL(10,6),              -- fallback rate when one can't be derived live
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO bricklink_pov_config (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

ALTER TABLE bricklink_pov_config ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read pov config"
  ON bricklink_pov_config FOR SELECT TO authenticated USING (TRUE);

CREATE POLICY "Authenticated users can update pov config"
  ON bricklink_pov_config FOR UPDATE TO authenticated USING (TRUE) WITH CHECK (TRUE);
