-- Quarterly BL store-directory discovery (BL Arbitrage "assess" lens).
-- Each row logs one scan of browseStores.asp?countryID=UK&groupState=Y (England
-- group). The nightly sweep triggers a re-scan when the latest row is >90 days
-- old, upserting newly-opened England stores into store_assessment_watchlist.

CREATE TABLE IF NOT EXISTS store_directory_scans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  scanned_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  region TEXT NOT NULL DEFAULT 'England',
  stores_found INTEGER NOT NULL,
  stores_added INTEGER NOT NULL,
  stores_skipped_small INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_store_directory_scans_user_date
  ON store_directory_scans (user_id, scanned_at DESC);

ALTER TABLE store_directory_scans ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users manage own directory scans" ON store_directory_scans;
CREATE POLICY "Users manage own directory scans"
  ON store_directory_scans FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Directory metadata on watchlist entries: which region group the store sat in
-- and its advertised item count at discovery time (tiny stores are skipped at
-- seed time but the threshold may change).
ALTER TABLE store_assessment_watchlist
  ADD COLUMN IF NOT EXISTS region TEXT,
  ADD COLUMN IF NOT EXISTS directory_items INTEGER;

COMMENT ON TABLE store_directory_scans IS
  'Log of quarterly BL browseStores directory scans (England). Nightly sweep re-scans when latest row >90d old.';
