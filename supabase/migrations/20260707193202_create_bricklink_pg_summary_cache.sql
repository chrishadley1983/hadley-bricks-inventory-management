-- Worldwide BL price-guide SUMMARY cache (priceGuideSummary.asp lane).
-- Coarse layer for STR screening; the rich UK-detail layer stays in
-- bricklink_price_guide_cache (catalogPG engine).
CREATE TABLE IF NOT EXISTS bricklink_pg_summary_cache (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  item_type text NOT NULL DEFAULT 'P' CHECK (item_type IN ('P','S','M')),
  item_no text NOT NULL,
  colour_id integer NOT NULL DEFAULT 0,
  currency text NOT NULL DEFAULT 'GBP',
  sold6m_new_lots integer NOT NULL DEFAULT 0,
  sold6m_new_qty integer NOT NULL DEFAULT 0,
  sold6m_new_min numeric,
  sold6m_new_avg numeric,
  sold6m_new_qavg numeric,
  sold6m_new_max numeric,
  sold6m_used_lots integer NOT NULL DEFAULT 0,
  sold6m_used_qty integer NOT NULL DEFAULT 0,
  sold6m_used_min numeric,
  sold6m_used_avg numeric,
  sold6m_used_qavg numeric,
  sold6m_used_max numeric,
  stock_new_lots integer NOT NULL DEFAULT 0,
  stock_new_qty integer NOT NULL DEFAULT 0,
  stock_new_min numeric,
  stock_new_avg numeric,
  stock_new_qavg numeric,
  stock_new_max numeric,
  stock_used_lots integer NOT NULL DEFAULT 0,
  stock_used_qty integer NOT NULL DEFAULT 0,
  stock_used_min numeric,
  stock_used_avg numeric,
  stock_used_qavg numeric,
  stock_used_max numeric,
  str_new numeric GENERATED ALWAYS AS (CASE WHEN stock_new_qty > 0 THEN sold6m_new_qty::numeric / stock_new_qty ELSE NULL END) STORED,
  str_used numeric GENERATED ALWAYS AS (CASE WHEN stock_used_qty > 0 THEN sold6m_used_qty::numeric / stock_used_qty ELSE NULL END) STORED,
  demand_rank integer,
  source text NOT NULL DEFAULT 'pg_summary',
  no_data boolean NOT NULL DEFAULT false,
  fetched_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (item_type, item_no, colour_id)
);
CREATE INDEX IF NOT EXISTS idx_pg_summary_str_new ON bricklink_pg_summary_cache (str_new DESC NULLS LAST);
CREATE INDEX IF NOT EXISTS idx_pg_summary_fetched ON bricklink_pg_summary_cache (fetched_at);
ALTER TABLE bricklink_pg_summary_cache ENABLE ROW LEVEL SECURITY;;
