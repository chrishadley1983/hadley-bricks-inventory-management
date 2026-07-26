-- SECURITY: the finance schema was readable with the public anon key.
-- Verified 2026-07-25: anon held SELECT on 29 finance tables, and 25 of them
-- carry an `ALL TO public USING (true)` policy, so anon could read live HSBC
-- transactions (3,683 rows), wealth snapshots back to 2019 (813), budgets
-- (2,148) and more. Writes were already blocked (anon holds SELECT only).
--
-- Fixed by removing anon's table privileges rather than rewriting 25 policies:
-- service_role and authenticated hold their own explicit grants, so neither is
-- affected. Verified no legitimate consumer reads finance via anon — the
-- finance-tracker frontend queries through service_role server-side and uses
-- the anon key only for auth (signInWithPassword / signOut), and the Peterbot
-- MCP / Hadley API both use service_role.

-- 1. New tables in this schema were auto-granted SELECT to anon via
--    pg_default_acl ({anon=r/postgres}), which would silently reopen this.
ALTER DEFAULT PRIVILEGES IN SCHEMA finance REVOKE SELECT ON TABLES FROM anon;

-- 2. Remove anon's existing privileges across every table in the schema.
REVOKE ALL ON ALL TABLES IN SCHEMA finance FROM anon;

-- 3. _backup_global_money_tx_20260701 had RLS disabled entirely (the only
--    defect Supabase's linter flagged, since it only ERRORs on RLS-off).
--    Defence in depth now that the grant is gone.
ALTER TABLE finance._backup_global_money_tx_20260701 ENABLE ROW LEVEL SECURITY;;
