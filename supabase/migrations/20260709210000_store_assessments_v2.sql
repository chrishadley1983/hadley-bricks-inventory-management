-- Store-assessment v2 (audit fixes, engine v2):
--   * median_ask_vs_uk → median_ask_vs_market: the benchmark is UK 6-mo avg where
--     covered but the worldwide pg_summary avg (+11% UK calibration) otherwise, so
--     the old name over-claimed provenance.
--   * engine_version: scoring semantics version the row was built with (1 = PR #540,
--     2 = cherry-pick-first verdict + world-benchmark calibration + ageing no-data bucket).
--   * scan_truncated: the inventory scrape hit its page cap — totals understate the store.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'store_assessments' AND column_name = 'median_ask_vs_uk'
  ) THEN
    ALTER TABLE store_assessments RENAME COLUMN median_ask_vs_uk TO median_ask_vs_market;
  END IF;
END $$;

ALTER TABLE store_assessments
  ADD COLUMN IF NOT EXISTS engine_version INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS scan_truncated BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN store_assessments.median_ask_vs_market IS
  'Value-weighted median ask ÷ 6-mo market avg (UK where covered; worldwide +11% UK calibration otherwise — see assessment.confidence for the split).';
COMMENT ON COLUMN store_assessments.engine_version IS
  'Scoring-engine version the row was built with (ENGINE_VERSION in bl-store-assessment/engine.ts).';
COMMENT ON COLUMN store_assessments.scan_truncated IS
  'True when the inventory scrape hit its page cap or stopped early — totals understate the store.';
