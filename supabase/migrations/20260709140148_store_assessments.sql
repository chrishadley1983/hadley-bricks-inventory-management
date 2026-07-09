CREATE TABLE IF NOT EXISTS store_assessments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  scanned_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  store_slug TEXT NOT NULL,
  store_id INTEGER,
  store_name TEXT,
  store_country TEXT,
  mode TEXT NOT NULL DEFAULT 'light',
  grade NUMERIC(5,1),
  verdict TEXT,
  total_lots INTEGER,
  total_pieces INTEGER,
  total_value NUMERIC(12,2),
  avg_value_per_lot NUMERIC(10,4),
  median_ask_vs_uk NUMERIC(6,3),
  buyable_lots INTEGER,
  buyable_outlay_gbp NUMERIC(12,2),
  buyable_net_gbp NUMERIC(12,2),
  blended_margin_pct NUMERIC(6,2),
  high_str_lots INTEGER,
  magnet_lots INTEGER,
  feedback_score INTEGER,
  positive_pct NUMERIC(6,2),
  orders_per_month NUMERIC(8,2),
  price_coverage NUMERIC(6,4),
  assessment JSONB,
  report_md TEXT
);

CREATE INDEX IF NOT EXISTS idx_store_assessments_user_slug_date
  ON store_assessments (user_id, store_slug, scanned_at DESC);

CREATE INDEX IF NOT EXISTS idx_store_assessments_user_date
  ON store_assessments (user_id, scanned_at DESC);

ALTER TABLE store_assessments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own store assessments" ON store_assessments;
CREATE POLICY "Users can view own store assessments"
  ON store_assessments FOR SELECT
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can insert own store assessments" ON store_assessments;
CREATE POLICY "Users can insert own store assessments"
  ON store_assessments FOR INSERT
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can delete own store assessments" ON store_assessments;
CREATE POLICY "Users can delete own store assessments"
  ON store_assessments FOR DELETE
  USING (auth.uid() = user_id);

COMMENT ON TABLE store_assessments IS
  'External BrickLink seller assessment runs (BL Arbitrage skill "assess" lens). Headline metrics promoted to columns; full section detail in assessment JSONB. Written by CLI via service-role; authenticated users read/insert/delete own rows.';;
