-- Harden the POV refresh objects per Supabase advisors (idempotent).
--
-- 1) bricklink_pov_refresh_status defaulted to a SECURITY DEFINER view (lint 0010, ERROR), which
--    bypasses RLS for any querying role. Switch to security_invoker so it honours the caller's RLS,
--    matching the project's security_invoker_views convention (migration 20260422100001). Both real
--    consumers still see all rows: the refresh job queries as service_role (RLS-exempt), and
--    get_pov_freshness_report() is SECURITY DEFINER so the view executes as the function owner.
--
-- 2) get_pov_freshness_report() (SECURITY DEFINER) was EXECUTE-able by anon + PUBLIC (Supabase
--    default-privileges auto-grants new public functions to anon/authenticated). It is only ever
--    called server-side by the report cron (service_role); revoke PUBLIC + anon so unauthenticated
--    API callers cannot invoke a definer function. authenticated keeps access for dashboard reads.
ALTER VIEW public.bricklink_pov_refresh_status SET (security_invoker = true);

REVOKE EXECUTE ON FUNCTION public.get_pov_freshness_report() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_pov_freshness_report() FROM anon;
GRANT EXECUTE ON FUNCTION public.get_pov_freshness_report() TO authenticated, service_role;
