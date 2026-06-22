-- POV freshness / refresh mechanism.
--
-- Keeps the bricklink_part_out_value_cache from going stale without a 180-day "cliff" where the
-- whole synchronised backfill cohort expires at once. Three moving parts live here:
--
--  1) bricklink_pov_config gains the refresh knobs (age-tier cadences, daily budget, the
--     not-partable yearly recheck, and the no-data backoff shape). All decisions locked:
--     tiers 30/60/180d, budget 500/day, not_partable recheck 365d, backoff x2-after-3 cap x4.
--
--  2) bricklink_part_out_value_cache gains three tracking columns:
--       - no_data_reason     : 'not_partable' (structurally never partable -> slow 365d recheck)
--                              vs 'no_sales_yet' (valid empty shell -> keep age-tier cadence).
--                              NULL = has data.
--       - consecutive_empty_count : drives adaptive backoff for persistently-empty sets.
--       - last_changed_at    : when the sold/for-sale figure last materially moved (recoveries).
--
--  3) bricklink_pov_refresh_status VIEW : the single source of truth for "what is stale and in
--     what order". Encodes age-tier cadence, deterministic per-set jitter (anti-cliff), the
--     not_partable override, and the empty-count backoff. BOTH the local refresh job (LIMIT budget,
--     ORDER BY overdue_ratio DESC) and the Discord report cron (freshness %, backlog, cliff radar)
--     read this one view, so the math can never drift between them.
--
--  Plus pov_refresh_runs: one audit row per daily refresh run (throughput, recoveries, backlog
--  trend, breathers) for the report's trend lines + job-missed detection.
--
-- Idempotent (IF NOT EXISTS / CREATE OR REPLACE / DROP+CREATE POLICY) so it is safe to re-apply.

-- ---------------------------------------------------------------------------
-- 1) Config knobs (defaults backfill the singleton id=1 row automatically)
-- ---------------------------------------------------------------------------
ALTER TABLE public.bricklink_pov_config
  ADD COLUMN IF NOT EXISTS tier1_days               integer NOT NULL DEFAULT 30,   -- set age < 1yr
  ADD COLUMN IF NOT EXISTS tier2_days               integer NOT NULL DEFAULT 60,   -- 1-3yr
  ADD COLUMN IF NOT EXISTS tier3_days               integer NOT NULL DEFAULT 180,  -- > 3yr
  ADD COLUMN IF NOT EXISTS refresh_daily_budget     integer NOT NULL DEFAULT 500,  -- max scrapes/day
  ADD COLUMN IF NOT EXISTS not_partable_recheck_days integer NOT NULL DEFAULT 365, -- 'not_partable' recheck
  ADD COLUMN IF NOT EXISTS backoff_after            integer NOT NULL DEFAULT 3,    -- empties before backoff
  ADD COLUMN IF NOT EXISTS backoff_cap              integer NOT NULL DEFAULT 4;    -- max cadence multiplier

COMMENT ON COLUMN public.bricklink_pov_config.tier1_days IS 'Refresh cadence (days) for sets aged < 1 year.';
COMMENT ON COLUMN public.bricklink_pov_config.tier2_days IS 'Refresh cadence (days) for sets aged 1-3 years.';
COMMENT ON COLUMN public.bricklink_pov_config.tier3_days IS 'Refresh cadence (days) for sets aged > 3 years.';
COMMENT ON COLUMN public.bricklink_pov_config.refresh_daily_budget IS 'Hard cap on POV scrapes per daily refresh run (makes a due-date spike physically impossible).';
COMMENT ON COLUMN public.bricklink_pov_config.not_partable_recheck_days IS 'Recheck cadence for rows marked no_data_reason=not_partable (structurally non-partable; only re-verify ~yearly).';
COMMENT ON COLUMN public.bricklink_pov_config.backoff_after IS 'consecutive_empty_count threshold at which cadence starts doubling.';
COMMENT ON COLUMN public.bricklink_pov_config.backoff_cap IS 'Maximum cadence multiplier from empty-count backoff.';

-- ---------------------------------------------------------------------------
-- 2) Cache tracking columns
-- ---------------------------------------------------------------------------
ALTER TABLE public.bricklink_part_out_value_cache
  ADD COLUMN IF NOT EXISTS no_data_reason          text,
  ADD COLUMN IF NOT EXISTS consecutive_empty_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_changed_at         timestamptz;

-- Only the two known sentinels (or NULL = has data) are valid.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'pov_cache_no_data_reason_chk'
  ) THEN
    ALTER TABLE public.bricklink_part_out_value_cache
      ADD CONSTRAINT pov_cache_no_data_reason_chk
      CHECK (no_data_reason IS NULL OR no_data_reason IN ('not_partable', 'no_sales_yet'));
  END IF;
END $$;

COMMENT ON COLUMN public.bricklink_part_out_value_cache.no_data_reason IS
  'Why a row has no POV figures: not_partable (bounced to catalogPG, structurally never -> 365d recheck) | no_sales_yet (valid empty shell -> age-tier cadence). NULL = has data.';
COMMENT ON COLUMN public.bricklink_part_out_value_cache.consecutive_empty_count IS
  'Count of consecutive refreshes that returned no data; drives adaptive backoff. Reset to 0 on any data hit.';
COMMENT ON COLUMN public.bricklink_part_out_value_cache.last_changed_at IS
  'When sold_6mo_avg_gbp / for_sale_avg_gbp last materially changed (used for recovery detection + churn reporting).';

-- Backfill last_changed_at for existing rows so reports have a baseline (best estimate = fetched_at).
UPDATE public.bricklink_part_out_value_cache
  SET last_changed_at = fetched_at
  WHERE last_changed_at IS NULL;

-- Partial index to make the report's "stale candidates" scan + ORDER cheap.
CREATE INDEX IF NOT EXISTS idx_pov_cache_refresh_scan
  ON public.bricklink_part_out_value_cache (condition, fetched_at)
  WHERE break_type = 'M' AND inc_instructions = true AND inc_box = false
    AND inc_extra = false AND inc_break = false;

-- ---------------------------------------------------------------------------
-- 3) Refresh run audit log
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.pov_refresh_runs (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  started_at     timestamptz NOT NULL DEFAULT now(),
  finished_at    timestamptz,
  budget         integer NOT NULL,
  candidates     integer NOT NULL DEFAULT 0,  -- stale rows available at run start
  attempted      integer NOT NULL DEFAULT 0,  -- scrapes attempted (<= budget)
  refreshed      integer NOT NULL DEFAULT 0,  -- scrapes that returned data
  no_data        integer NOT NULL DEFAULT 0,  -- scrapes that ended no-data
  recoveries     integer NOT NULL DEFAULT 0,  -- no_data -> data this run
  newly_empty    integer NOT NULL DEFAULT 0,  -- data -> no_data this run
  errors         integer NOT NULL DEFAULT 0,
  breathers      integer NOT NULL DEFAULT 0,  -- self-healing throttle pauses taken
  stopped_early  boolean NOT NULL DEFAULT false,
  stop_reason    text,
  backlog_before integer,                     -- total stale rows before the run
  backlog_after  integer,                     -- total stale rows after the run
  duration_ms    bigint,
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_pov_refresh_runs_started ON public.pov_refresh_runs (started_at DESC);

ALTER TABLE public.pov_refresh_runs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated users can read pov refresh runs" ON public.pov_refresh_runs;
CREATE POLICY "Authenticated users can read pov refresh runs"
  ON public.pov_refresh_runs FOR SELECT TO authenticated USING (TRUE);

DROP POLICY IF EXISTS "Authenticated users can insert pov refresh runs" ON public.pov_refresh_runs;
CREATE POLICY "Authenticated users can insert pov refresh runs"
  ON public.pov_refresh_runs FOR INSERT TO authenticated WITH CHECK (TRUE);

-- ---------------------------------------------------------------------------
-- 4) The staleness / priority view (the refresh brain)
-- ---------------------------------------------------------------------------
-- Joins the cache (bare itemNo + seq) to brickset_sets on the FULL key
-- "<set_number>-<item_seq>" (NOT the bare number, which fans out across seqs), reads age from
-- brickset_sets.year_from, applies the age-tier cadence, a not_partable override, an empty-count
-- backoff multiplier, and a deterministic per-set jitter so a synchronised cohort's due-dates
-- pre-spread across the cadence window instead of all firing on the same day.
CREATE OR REPLACE VIEW public.bricklink_pov_refresh_status AS
WITH cfg AS (
  SELECT
    COALESCE(tier1_days, 30)                AS tier1_days,
    COALESCE(tier2_days, 60)                AS tier2_days,
    COALESCE(tier3_days, 180)               AS tier3_days,
    COALESCE(not_partable_recheck_days,365) AS not_partable_recheck_days,
    COALESCE(backoff_after, 3)              AS backoff_after,
    COALESCE(backoff_cap, 4)                AS backoff_cap
  FROM public.bricklink_pov_config WHERE id = 1
),
base AS (
  SELECT
    c.id, c.set_number, c.item_seq, c.condition, c.set_name,
    c.fetched_at, c.last_changed_at, c.sold_6mo_avg_gbp, c.for_sale_avg_gbp,
    c.no_data_reason, COALESCE(c.consecutive_empty_count, 0) AS consecutive_empty_count,
    bs.year_from,
    (c.sold_6mo_avg_gbp IS NULL AND c.for_sale_avg_gbp IS NULL) AS is_no_data,
    CASE
      WHEN bs.year_from IS NULL THEN 3                                                  -- unknown age -> slowest
      WHEN (EXTRACT(year FROM now())::int - bs.year_from) < 1  THEN 1
      WHEN (EXTRACT(year FROM now())::int - bs.year_from) <= 3 THEN 2
      ELSE 3
    END AS age_tier,
    cfg.tier1_days, cfg.tier2_days, cfg.tier3_days,
    cfg.not_partable_recheck_days, cfg.backoff_after, cfg.backoff_cap
  FROM public.bricklink_part_out_value_cache c
  CROSS JOIN cfg
  LEFT JOIN public.brickset_sets bs
    ON bs.set_number = c.set_number || '-' || c.item_seq
  WHERE c.break_type = 'M' AND c.inc_instructions = true AND c.inc_box = false
    AND c.inc_extra = false AND c.inc_break = false
),
cadence AS (
  SELECT base.*,
    CASE
      WHEN no_data_reason = 'not_partable' THEN not_partable_recheck_days
      WHEN age_tier = 1 THEN tier1_days
      WHEN age_tier = 2 THEN tier2_days
      ELSE tier3_days
    END AS base_cadence_days,
    -- x2 each `backoff_after` consecutive empties, capped. Exponent clamped to avoid int overflow.
    LEAST(
      backoff_cap,
      POWER(2, LEAST(FLOOR(consecutive_empty_count::numeric / NULLIF(backoff_after, 0)), 10))::int
    ) AS backoff_mult
  FROM base
),
eff AS (
  SELECT cadence.*,
    GREATEST(1, base_cadence_days * backoff_mult)::int AS effective_cadence_days
  FROM cadence
),
jit AS (
  SELECT eff.*,
    -- Deterministic per-set jitter in [-cadence/2, +cadence/2): a 28-bit hash of the set key,
    -- modulo the cadence, recentred. Same set -> same phase every cycle, so due-dates stay spread.
    (
      ('x' || substr(md5(set_number || ':' || item_seq::text || ':' || condition), 1, 7))::bit(28)::int
      % GREATEST(effective_cadence_days, 1)
    ) - (effective_cadence_days / 2) AS jitter_days
  FROM eff
)
SELECT
  id, set_number, item_seq, condition, set_name, fetched_at, last_changed_at,
  sold_6mo_avg_gbp, for_sale_avg_gbp, no_data_reason, consecutive_empty_count,
  year_from, is_no_data, age_tier,
  base_cadence_days, backoff_mult, effective_cadence_days, jitter_days,
  (fetched_at + make_interval(days => (effective_cadence_days + jitter_days)))        AS due_at,
  (fetched_at + make_interval(days => (effective_cadence_days + jitter_days)))::date  AS due_date,
  (now() >= fetched_at + make_interval(days => (effective_cadence_days + jitter_days))) AS is_stale,
  EXTRACT(epoch FROM (now() - fetched_at)) / NULLIF(effective_cadence_days * 86400.0, 0) AS overdue_ratio
FROM jit;

COMMENT ON VIEW public.bricklink_pov_refresh_status IS
  'Per-cache-row refresh status: age-tier cadence (config tier1/2/3_days) with not_partable override (not_partable_recheck_days), empty-count backoff (x2 per backoff_after, capped backoff_cap), and deterministic per-set jitter so a synchronised cohort spreads across its cadence window. is_stale = due now; order by overdue_ratio DESC to drain most-overdue first. Restricted to the canonical option-variant (M / instr=Y / box=N / extra=N / break=N).';

GRANT SELECT ON public.bricklink_pov_refresh_status TO authenticated, service_role;
