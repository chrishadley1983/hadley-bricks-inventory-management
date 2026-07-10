-- PG Market Intelligence platform P0 (spec: docs/features/pg-market-intelligence/spec.md v2)
-- L2 snapshots, ranked refresh queue, lane telemetry, provenance columns on L1.

-- 1. Provenance on L1 (spec §2.2: fetch identity class + FX stamping)
ALTER TABLE bricklink_pg_summary_cache
  ADD COLUMN IF NOT EXISTS fetch_identity text,
  ADD COLUMN IF NOT EXISTS fx_rate numeric;

-- Backfill from the POC's source encoding ('brickstore_batch_usd@0.7407', 'pg_summary')
UPDATE bricklink_pg_summary_cache
SET fetch_identity = CASE
      WHEN source LIKE 'brickstore_batch%' THEN 'brickstore_batch'
      WHEN source = 'pg_summary' THEN 'anon_curl'
      ELSE source
    END,
    fx_rate = CASE
      WHEN source ~ 'usd@([0-9.]+)' THEN (substring(source FROM 'usd@([0-9.]+)'))::numeric
      ELSE NULL
    END
WHERE fetch_identity IS NULL;

-- 2. L2 snapshot history (spec §2.1/§4.3): L1 row shape + snapshot_date.
-- Written on the 28-day refresh cycle -> clean monthly deltas per active tuple.
CREATE TABLE IF NOT EXISTS bricklink_pg_snapshots (
  item_type text NOT NULL CHECK (item_type IN ('P','S','M')),
  item_no text NOT NULL,
  colour_id integer NOT NULL DEFAULT 0,
  snapshot_date date NOT NULL,
  currency text NOT NULL DEFAULT 'GBP',
  sold6m_new_lots integer NOT NULL DEFAULT 0,
  sold6m_new_qty integer NOT NULL DEFAULT 0,
  sold6m_new_avg numeric,
  sold6m_new_qavg numeric,
  sold6m_used_lots integer NOT NULL DEFAULT 0,
  sold6m_used_qty integer NOT NULL DEFAULT 0,
  sold6m_used_avg numeric,
  sold6m_used_qavg numeric,
  stock_new_lots integer NOT NULL DEFAULT 0,
  stock_new_qty integer NOT NULL DEFAULT 0,
  stock_new_avg numeric,
  stock_used_lots integer NOT NULL DEFAULT 0,
  stock_used_qty integer NOT NULL DEFAULT 0,
  stock_used_avg numeric,
  str_new numeric,
  str_used numeric,
  source text NOT NULL,
  fetch_identity text,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (item_type, item_no, colour_id, snapshot_date)
);
CREATE INDEX IF NOT EXISTS idx_pg_snapshots_date ON bricklink_pg_snapshots (snapshot_date);
ALTER TABLE bricklink_pg_snapshots ENABLE ROW LEVEL SECURITY;
CREATE POLICY pg_snapshots_read ON bricklink_pg_snapshots
  FOR SELECT TO authenticated USING (true);

-- 3. Ranked refresh queue (spec §4.1): one row per tuple in the managed universe.
CREATE TABLE IF NOT EXISTS bl_pg_refresh_queue (
  item_type text NOT NULL CHECK (item_type IN ('P','S','M')),
  item_no text NOT NULL,
  colour_id integer NOT NULL DEFAULT 0,
  rank_score numeric NOT NULL DEFAULT 0,          -- 6-mo sold value (GBP)
  tier text NOT NULL DEFAULT 'tail' CHECK (tier IN ('active','tail')),
  rank_floor text,                                 -- 'watchlist' | 'own_inventory' | 'new_release' | NULL
  grace_until timestamptz,                         -- new-release rule: active regardless of rank until this
  last_refreshed_at timestamptz,
  next_due_at timestamptz NOT NULL DEFAULT now(),
  locked_by text,
  locked_at timestamptz,
  attempts integer NOT NULL DEFAULT 0,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (item_type, item_no, colour_id)
);
-- Nightly claim path: due active tuples first
CREATE INDEX IF NOT EXISTS idx_pg_queue_due
  ON bl_pg_refresh_queue (tier, next_due_at)
  WHERE locked_by IS NULL;
CREATE INDEX IF NOT EXISTS idx_pg_queue_grace
  ON bl_pg_refresh_queue (grace_until)
  WHERE grace_until IS NOT NULL;
ALTER TABLE bl_pg_refresh_queue ENABLE ROW LEVEL SECURITY;
CREATE POLICY pg_queue_read ON bl_pg_refresh_queue
  FOR SELECT TO authenticated USING (true);

-- 4. Lane telemetry (spec §4.4/§5.4): per-session rows; sessions-to-first-403 trend
CREATE TABLE IF NOT EXISTS bl_pg_lane_telemetry (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  run_date date NOT NULL DEFAULT CURRENT_DATE,
  lane text NOT NULL,                              -- 'catalogpg' | 'anon_curl' | 'store_api' | 'brickstore_batch' | 'canary'
  session_no integer NOT NULL DEFAULT 1,
  requests integer NOT NULL DEFAULT 0,
  ok integer NOT NULL DEFAULT 0,
  failed integer NOT NULL DEFAULT 0,
  first_block_at_request integer,                  -- NULL = no block this session
  started_at timestamptz NOT NULL DEFAULT now(),
  ended_at timestamptz,
  notes text
);
CREATE INDEX IF NOT EXISTS idx_pg_telemetry_lane_date ON bl_pg_lane_telemetry (lane, run_date);
ALTER TABLE bl_pg_lane_telemetry ENABLE ROW LEVEL SECURITY;
CREATE POLICY pg_telemetry_read ON bl_pg_lane_telemetry
  FOR SELECT TO authenticated USING (true);
