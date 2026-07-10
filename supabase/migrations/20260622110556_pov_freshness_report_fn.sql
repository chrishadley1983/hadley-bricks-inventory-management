-- get_pov_freshness_report(): one round-trip JSON blob of every figure the daily Discord report
-- needs, computed in SQL (supabase-js can't GROUP BY). Reads bricklink_pov_refresh_status (the
-- staleness view) so the report and the refresh job share identical math. security definer so the
-- cron's service-role call bypasses RLS on the underlying tables; search_path pinned to public.
--
--   freshness by age-tier · total/stale backlog · backoff count · no-data composition
--   (not_partable vs no_sales_yet vs unclassified) · cliff radar (peak projected due-day vs budget)
CREATE OR REPLACE FUNCTION public.get_pov_freshness_report()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH cfg AS (
    SELECT COALESCE(refresh_daily_budget, 500) AS budget FROM public.bricklink_pov_config WHERE id = 1
  ),
  v AS (
    SELECT age_tier, is_stale, is_no_data, no_data_reason, backoff_mult, due_date
    FROM public.bricklink_pov_refresh_status
  ),
  tier AS (
    SELECT age_tier,
      count(*) AS total,
      count(*) FILTER (WHERE NOT is_stale) AS fresh,
      count(*) FILTER (WHERE is_stale)     AS stale
    FROM v GROUP BY age_tier
  ),
  nodata AS (
    SELECT
      count(*) FILTER (WHERE no_data_reason = 'not_partable')                  AS not_partable,
      count(*) FILTER (WHERE no_data_reason = 'no_sales_yet')                  AS no_sales_yet,
      count(*) FILTER (WHERE is_no_data AND no_data_reason IS NULL)            AS unclassified_empty
    FROM v
  ),
  totals AS (
    SELECT count(*) AS total,
           count(*) FILTER (WHERE is_stale)        AS stale,
           count(*) FILTER (WHERE backoff_mult > 1) AS backed_off
    FROM v
  ),
  radar AS (
    -- 280d window covers the full tier-3 horizon (180d cadence + up to +cadence/2 jitter ~= 270d)
    -- so a cliff forming beyond the next few months is still visible (the physical budget cap already
    -- guarantees no over-budget run regardless; this is the early-warning radar).
    SELECT due_date, count(*) AS due_count
    FROM v
    WHERE due_date <= (now() + interval '280 days')::date
    GROUP BY due_date
  ),
  radar_agg AS (
    SELECT
      COALESCE(max(due_count), 0) AS peak_day_count,
      (SELECT due_date FROM radar ORDER BY due_count DESC, due_date ASC LIMIT 1) AS peak_day,
      count(*) FILTER (WHERE due_count > (SELECT budget FROM cfg)) AS days_over_budget
    FROM radar
  )
  SELECT jsonb_build_object(
    'generated_at', now(),
    'budget',       (SELECT budget FROM cfg),
    'total',        (SELECT total FROM totals),
    'stale',        (SELECT stale FROM totals),
    'backed_off',   (SELECT backed_off FROM totals),
    'tiers',        (SELECT jsonb_agg(jsonb_build_object(
                       'tier', age_tier, 'total', total, 'fresh', fresh, 'stale', stale
                     ) ORDER BY age_tier) FROM tier),
    'no_data',      (SELECT to_jsonb(nodata) FROM nodata),
    'cliff',        (SELECT to_jsonb(radar_agg) FROM radar_agg)
  );
$$;

GRANT EXECUTE ON FUNCTION public.get_pov_freshness_report() TO authenticated, service_role;
