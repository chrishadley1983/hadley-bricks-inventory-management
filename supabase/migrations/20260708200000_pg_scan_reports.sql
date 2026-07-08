-- BrickRadar completion UI (spec: docs/features/pg-market-intelligence/spec.md §5.1):
-- persist each store scan report (bl-pg-store-scan.ts) so the "Recent store scans"
-- section of /brickradar can list + render past reports without re-scraping.

CREATE TABLE IF NOT EXISTS bl_pg_scan_reports (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  store_slug text NOT NULL,
  scanned_at timestamptz NOT NULL DEFAULT now(),
  verdict text,                    -- BUY | REVIEW | SKIP
  lots_total integer,
  lots_passing integer,
  outlay_gbp numeric,
  raw_net_gbp numeric,
  realisable_net_gbp numeric,
  price_source_uk integer,
  price_source_world integer,
  price_source_uncovered integer,
  identity_ambiguous integer,
  floor_unviable integer,
  variant_recovered integer,
  report_md text NOT NULL,         -- full markdown report (buildReport output)
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_pg_scan_reports_slug_date
  ON bl_pg_scan_reports (store_slug, scanned_at DESC);

ALTER TABLE bl_pg_scan_reports ENABLE ROW LEVEL SECURITY;

-- Service role (scripts) writes; authenticated dashboard users read.
CREATE POLICY pg_scan_reports_read ON bl_pg_scan_reports
  FOR SELECT TO authenticated USING (true);

COMMENT ON TABLE bl_pg_scan_reports IS
  'Persisted bl-pg-store-scan.ts markdown reports (spec §5.1) — powers the BrickRadar dashboard "Recent store scans" section. Written by the script via service-role client; read-only for authenticated dashboard users.';
