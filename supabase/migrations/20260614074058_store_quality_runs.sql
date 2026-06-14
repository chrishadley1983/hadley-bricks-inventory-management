-- Store-quality scorecard run history.
-- One row per `store-quality.ts` run: the composite + sub-scores and headline
-- metrics, plus the full summary as jsonb. Enables run-over-run deltas, trend
-- charts, and reuse by a future dashboard / weekly email.

CREATE TABLE IF NOT EXISTS store_quality_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  segment TEXT NOT NULL,
  window_days INTEGER NOT NULL,
  snapshot_date TIMESTAMPTZ,
  snapshot_age_days INTEGER,

  composite_score NUMERIC(5,1),
  velocity_score NUMERIC(5,1),
  picking_score NUMERIC(5,1),
  margin_score NUMERIC(5,1),
  ageing_score NUMERIC(5,1),
  coverage_score NUMERIC(5,1),
  freshness_score NUMERIC(5,1),

  total_lots INTEGER,
  total_pieces INTEGER,
  total_value NUMERIC(12,2),
  avg_value_per_lot NUMERIC(10,4),
  sub_floor_lot_share NUMERIC(6,4),
  price_coverage NUMERIC(6,4),
  velocity_coverage NUMERIC(6,4),
  dead_overstock_value NUMERIC(12,2),
  blind_high_value_count INTEGER,
  stuck_high_count INTEGER,
  under_priced_count INTEGER,

  summary JSONB
);

CREATE INDEX IF NOT EXISTS idx_store_quality_runs_user_segment
  ON store_quality_runs(user_id, segment, created_at DESC);

ALTER TABLE store_quality_runs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own store-quality runs" ON store_quality_runs;
CREATE POLICY "Users can view own store-quality runs"
  ON store_quality_runs FOR SELECT
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can insert own store-quality runs" ON store_quality_runs;
CREATE POLICY "Users can insert own store-quality runs"
  ON store_quality_runs FOR INSERT
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can delete own store-quality runs" ON store_quality_runs;
CREATE POLICY "Users can delete own store-quality runs"
  ON store_quality_runs FOR DELETE
  USING (auth.uid() = user_id);
