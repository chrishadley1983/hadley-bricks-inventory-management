-- Investment ML v2: label-quality metadata on investment_historical
-- Migration: 20260702000001_investment_ml_v2
-- Purpose: Support median-window label computation with corroboration counts
-- and retirement-date provenance, so training can filter/weight by label quality.

ALTER TABLE investment_historical
  ADD COLUMN IF NOT EXISTS retired_date_estimated BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS snapshots_at_retirement INTEGER,
  ADD COLUMN IF NOT EXISTS snapshots_1yr INTEGER,
  ADD COLUMN IF NOT EXISTS snapshots_3yr INTEGER,
  ADD COLUMN IF NOT EXISTS label_method TEXT;

COMMENT ON COLUMN investment_historical.retired_date_estimated IS 'TRUE when retired_date fell back to expected_retirement_date (no Brickset exit_date) — date may be a placeholder';
COMMENT ON COLUMN investment_historical.snapshots_at_retirement IS 'Count of valid (junk-filtered) price snapshots in the at-retirement window used for price_at_retirement';
COMMENT ON COLUMN investment_historical.snapshots_1yr IS 'Count of valid price snapshots corroborating price_1yr_post (median of window)';
COMMENT ON COLUMN investment_historical.snapshots_3yr IS 'Count of valid price snapshots corroborating price_3yr_post (median of window)';
COMMENT ON COLUMN investment_historical.label_method IS 'Label computation version, e.g. median_window_v2 (v1 was single-closest-snapshot, no junk filter)';

-- Staleness-ordered candidates for the keepa-refresh cron: sets we want fresh
-- Keepa data for (active/retiring, or retired within the label-accrual window)
-- with the date of their most recent Keepa snapshot.
CREATE OR REPLACE VIEW keepa_refresh_candidates AS
SELECT
  b.set_number,
  b.amazon_asin,
  b.retirement_status,
  MAX(ps.date) AS last_keepa_date
FROM brickset_sets b
LEFT JOIN price_snapshots ps
  ON ps.set_num = b.set_number AND ps.source = 'keepa_amazon_buybox'
WHERE b.amazon_asin IS NOT NULL
  AND (
    b.retirement_status IN ('available', 'retiring_soon')
    OR (
      b.retirement_status = 'retired'
      AND COALESCE(b.exit_date, b.expected_retirement_date) >= CURRENT_DATE - INTERVAL '4 years'
    )
  )
GROUP BY b.set_number, b.amazon_asin, b.retirement_status;

COMMENT ON VIEW keepa_refresh_candidates IS 'Sets eligible for ongoing Keepa price refresh, with last snapshot date for staleness ordering';
