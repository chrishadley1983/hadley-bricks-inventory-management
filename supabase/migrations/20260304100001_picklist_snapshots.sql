-- Picklist snapshots table for interactive pick list pages
CREATE TABLE picklist_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  platform TEXT NOT NULL CHECK (platform IN ('amazon', 'ebay')),
  data JSONB NOT NULL,
  generated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  user_id UUID NOT NULL REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_picklist_snapshots_lookup
  ON picklist_snapshots(user_id, platform, generated_at DESC);

ALTER TABLE picklist_snapshots ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own snapshots" ON picklist_snapshots
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Public read access" ON picklist_snapshots
  FOR SELECT USING (true);
