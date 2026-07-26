-- SECURITY: every logged-in user of ANY app on this project could read AND
-- WRITE the finance schema.
--
-- Demonstrated 2026-07-25 with a throwaway confirmed user signing in through
-- the ordinary anon-key login flow: its `authenticated` JWT read
-- finance.transactions (3,683), wealth_snapshots (813), accounts, budgets, and
-- returned HTTP 204 (authorized, zero rows matched) on DELETE and PATCH
-- against transactions and wealth_snapshots.
--
-- Cause: 25 finance tables carried `ALL TO public USING (true)`. `public` in a
-- POLICY means every role, so it covered `authenticated` — which holds full
-- DELETE/INSERT/UPDATE/TRUNCATE grants. This project has 68 auth users, 58 of
-- whom signed up in June 2026 (the football prediction game shares the
-- project), so this was reachable by ~58 external people, not just Chris.
-- Strictly worse than the anon leak fixed earlier today: anon had SELECT only.
--
-- Fix: drop the permissive policies and remove `authenticated`'s grants,
-- leaving finance reachable only by `service_role`. That is how every real
-- consumer already works — the finance-tracker frontend queries via
-- supabaseAdmin/service_role server-side and uses the anon key only for
-- signInWithPassword / signOut, and the Peterbot MCP and Hadley API both use
-- service_role. service_role has BYPASSRLS, so RLS-on-with-no-policies does
-- not affect it; three tables in this schema (truelayer_connections,
-- enable_banking_sessions, monthly_reports) already run exactly this way.
--
-- ROLLBACK (restores the previous, insecure state):
--   GRANT ALL ON ALL TABLES IN SCHEMA finance TO authenticated;
--   ALTER DEFAULT PRIVILEGES IN SCHEMA finance GRANT ALL ON TABLES TO authenticated;
--   -- then recreate per-table: CREATE POLICY allow_all_<t> ON finance.<t>
--   --   FOR ALL TO public USING (true) WITH CHECK (true);

-- 1. Drop every policy in the schema. Done dynamically rather than by name
--    because three are misleadingly named ("Service role full access on
--    subscriptions", "Allow full access via service key") despite being
--    TO public, and a name list would silently miss any added since.
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT policyname, tablename FROM pg_policies WHERE schemaname = 'finance'
  LOOP
    EXECUTE format('DROP POLICY %I ON finance.%I', r.policyname, r.tablename);
  END LOOP;
END $$;

-- 2. Ensure RLS is on everywhere, so "no policies" means deny-all rather than
--    wide open, for any table that might have had it disabled.
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
           WHERE n.nspname = 'finance' AND c.relkind = 'r' AND NOT c.relrowsecurity
  LOOP
    EXECUTE format('ALTER TABLE finance.%I ENABLE ROW LEVEL SECURITY', r.relname);
  END LOOP;
END $$;

-- 3. Remove authenticated's table privileges, and stop new tables handing them
--    out automatically (pg_default_acl granted authenticated=arwdDxtm).
ALTER DEFAULT PRIVILEGES IN SCHEMA finance REVOKE ALL ON TABLES FROM authenticated;
REVOKE ALL ON ALL TABLES IN SCHEMA finance FROM authenticated;;
