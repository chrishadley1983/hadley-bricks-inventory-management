-- Watchlist of external BL stores for the nightly assessment sweep (BL Arbitrage
-- "assess" lens, phase 2). The batch runner picks the stalest enabled entries each
-- night (staleness = latest store_assessments.scanned_at per slug), re-assesses via
-- the caches, and Discord-alerts on BUY verdicts / material deltas.

CREATE TABLE IF NOT EXISTS store_assessment_watchlist (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  store_slug TEXT NOT NULL,
  store_name TEXT,
  enabled BOOLEAN NOT NULL DEFAULT true,
  source TEXT,                          -- 'assessed' | 'arbitrage_purchase' | 'manual' | ...
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, store_slug)
);

CREATE INDEX IF NOT EXISTS idx_store_assessment_watchlist_user_enabled
  ON store_assessment_watchlist (user_id, enabled);

ALTER TABLE store_assessment_watchlist ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users manage own assessment watchlist" ON store_assessment_watchlist;
CREATE POLICY "Users manage own assessment watchlist"
  ON store_assessment_watchlist FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

COMMENT ON TABLE store_assessment_watchlist IS
  'External BL stores queued for the nightly store-assessment sweep. Batch runner picks stalest enabled entries; staleness derived from store_assessments history.';
