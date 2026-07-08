-- Complete POV refresh security hardening (idempotent).
ALTER VIEW public.bricklink_pov_refresh_status SET (security_invoker = true);
-- Supabase default-privileges auto-grant EXECUTE to anon + authenticated on new public functions;
-- revoke PUBLIC and the explicit anon grant so only authenticated + the service-role cron can call it.
REVOKE EXECUTE ON FUNCTION public.get_pov_freshness_report() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_pov_freshness_report() FROM anon;
GRANT EXECUTE ON FUNCTION public.get_pov_freshness_report() TO authenticated, service_role;;
