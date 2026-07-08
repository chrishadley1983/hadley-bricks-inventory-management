-- Allow cross-project writers (which only hold this project's publishable/anon key,
-- not the service-role key) to INSERT audit rows. INSERT-only: no SELECT/UPDATE/DELETE
-- for anon/authenticated, so the audit data cannot be read or tampered with via the
-- public key. Reads/reconciliation stay service-role only.
GRANT INSERT ON public.ai_api_usage TO anon, authenticated;

DROP POLICY IF EXISTS ai_api_usage_insert_anon ON public.ai_api_usage;
CREATE POLICY ai_api_usage_insert_anon
  ON public.ai_api_usage
  FOR INSERT
  TO anon, authenticated
  WITH CHECK (true);;
