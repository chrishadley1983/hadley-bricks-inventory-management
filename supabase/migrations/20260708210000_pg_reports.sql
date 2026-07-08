-- BrickRadar completion UI (spec: docs/features/pg-market-intelligence/spec.md §5.1):
-- persist pg-own-store-audit.ts and pg-digest.ts markdown reports so the "Reports" section
-- of /brickradar can list + render past own-store-audit and weekly-digest runs without
-- re-reading tmp/ markdown files.

CREATE TABLE IF NOT EXISTS bl_pg_reports (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  kind text NOT NULL CHECK (kind IN ('own_store_audit', 'digest')),
  subject text,                    -- store slug for audit; ISO week/date for digest
  generated_at timestamptz NOT NULL DEFAULT now(),
  summary jsonb NOT NULL DEFAULT '{}'::jsonb,   -- kind-specific headline counts/figures
  report_md text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_bl_pg_reports_kind_time
  ON bl_pg_reports (kind, generated_at DESC);

ALTER TABLE bl_pg_reports ENABLE ROW LEVEL SECURITY;

-- Service role (scripts) writes; authenticated dashboard users read.
CREATE POLICY bl_pg_reports_read ON bl_pg_reports
  FOR SELECT TO authenticated USING (true);

COMMENT ON TABLE bl_pg_reports IS
  'Persisted pg-own-store-audit.ts and pg-digest.ts markdown reports (spec §5.1) — powers the BrickRadar dashboard reports section. Written by the scripts via service-role client; read-only for authenticated dashboard users.';
