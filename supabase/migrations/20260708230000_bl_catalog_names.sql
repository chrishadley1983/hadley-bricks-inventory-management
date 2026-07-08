-- Migration: bl_catalog_names
-- Purpose: Small cache of BrickLink catalog item names (PART/SET/MINIFIG), keyed by
--          (item_type, item_no). Fed on-demand by the BrickRadar tuple drill-down page
--          (one BL API call per uncached item, never looped over screen rows) so the UI
--          can show a human name instead of just the bare item number/colour tuple.
-- Writes are service-role only (drill-down resolver upserts via createServiceRoleClient());
-- authenticated users get read-only access for rendering.

CREATE TABLE bl_catalog_names (
  item_type TEXT NOT NULL CHECK (item_type IN ('P', 'S', 'M')),
  item_no TEXT NOT NULL,
  name TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'bl_api',
  fetched_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  PRIMARY KEY (item_type, item_no)
);

ALTER TABLE bl_catalog_names ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read catalog names"
  ON bl_catalog_names FOR SELECT TO authenticated USING (TRUE);

-- No INSERT/UPDATE/DELETE policy for authenticated or anon — writes go through the
-- service-role client only (RLS is bypassed for service_role, so no explicit policy
-- is needed there).
