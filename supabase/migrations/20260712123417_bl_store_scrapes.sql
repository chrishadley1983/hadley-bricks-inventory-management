CREATE TABLE IF NOT EXISTS bl_store_scrapes (
  store_slug text PRIMARY KEY,
  user_id uuid,
  store_id integer,
  scanned_at timestamptz NOT NULL DEFAULT now(),
  lot_count integer NOT NULL,
  truncated boolean NOT NULL DEFAULT false,
  lots jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE bl_store_scrapes ENABLE ROW LEVEL SECURITY;

CREATE POLICY bl_store_scrapes_read ON bl_store_scrapes
  FOR SELECT TO authenticated USING (true);

COMMENT ON TABLE bl_store_scrapes IS
  'Latest raw inventory scrape per external BL store (StoreLot[] jsonb), written by store-assessment.ts. Enables offline engine re-runs (fresh benchmarks, different thresholds) and cart prep without re-scraping.';;
