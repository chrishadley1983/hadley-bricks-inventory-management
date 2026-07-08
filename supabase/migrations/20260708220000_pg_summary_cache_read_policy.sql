-- bricklink_pg_summary_cache (the POC-era L1 table, migration 20260707193202) had
-- RLS ENABLED but NO policy — so service-role scripts worked (they bypass RLS) while
-- the BrickRadar UI, reading as the authenticated user, saw ZERO rows. This also
-- silently emptied the security_invoker pg_screen_* views (they read the summary
-- cache with the querying user's permissions). Every SQL-based validation used an
-- elevated connection and never hit it; only rendering the live page did.
-- Mirrors the read policy every sibling PG table already has.
CREATE POLICY pg_summary_cache_read ON bricklink_pg_summary_cache
  FOR SELECT TO authenticated USING (true);
