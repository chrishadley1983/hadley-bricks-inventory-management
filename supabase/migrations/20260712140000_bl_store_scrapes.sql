-- Raw store-inventory scrapes (latest per store), written by store-assessment.ts
-- alongside each assessment. Persisting the full lot list means benchmark re-scores
-- (e.g. UK live-check → re-run the engine) and cart preparation never need the
-- inventory re-scraped — the sweep already paid for it once that night.
-- PK upsert keeps only the latest scrape per store, so the table stays bounded.

CREATE TABLE IF NOT EXISTS bl_store_scrapes (
  store_slug text PRIMARY KEY,
  user_id uuid,
  store_id integer,
  scanned_at timestamptz NOT NULL DEFAULT now(),
  lot_count integer NOT NULL,
  truncated boolean NOT NULL DEFAULT false,
  lots jsonb NOT NULL,             -- StoreLot[] exactly as scraped (asks, qtys, conditions, remarks)
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE bl_store_scrapes ENABLE ROW LEVEL SECURITY;

-- Service role (scripts) writes; authenticated dashboard users read.
CREATE POLICY bl_store_scrapes_read ON bl_store_scrapes
  FOR SELECT TO authenticated USING (true);

COMMENT ON TABLE bl_store_scrapes IS
  'Latest raw inventory scrape per external BL store (StoreLot[] jsonb), written by store-assessment.ts. Enables offline engine re-runs (fresh benchmarks, different thresholds) and cart prep without re-scraping.';
