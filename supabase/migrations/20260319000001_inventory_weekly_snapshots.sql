-- Inventory Weekly Snapshots
-- Stores weekly aggregated metrics for trend tracking on the Inventory Health dashboard
-- week_start is always a Monday (ISO week start)

CREATE TABLE inventory_weekly_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  week_start DATE NOT NULL,
  platform TEXT NOT NULL DEFAULT 'amazon',
  listed_count INTEGER NOT NULL DEFAULT 0,
  total_cog NUMERIC(12,2) NOT NULL DEFAULT 0,
  total_list_value NUMERIC(12,2) NOT NULL DEFAULT 0,
  items_sold INTEGER NOT NULL DEFAULT 0,
  gross_revenue NUMERIC(12,2) NOT NULL DEFAULT 0,
  items_bought INTEGER NOT NULL DEFAULT 0,
  avg_cog_bought NUMERIC(10,2) NOT NULL DEFAULT 0,
  avg_list_value_listed NUMERIC(10,2) NOT NULL DEFAULT 0,
  sell_through_pct NUMERIC(5,2) NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  UNIQUE(user_id, week_start, platform)
);

-- Indexes
CREATE INDEX idx_weekly_snapshots_user_week
  ON inventory_weekly_snapshots(user_id, week_start DESC);
CREATE INDEX idx_weekly_snapshots_user_platform
  ON inventory_weekly_snapshots(user_id, platform, week_start DESC);

-- RLS
ALTER TABLE inventory_weekly_snapshots ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own weekly snapshots"
  ON inventory_weekly_snapshots FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own weekly snapshots"
  ON inventory_weekly_snapshots FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own weekly snapshots"
  ON inventory_weekly_snapshots FOR UPDATE
  USING (auth.uid() = user_id);

-- Service role needs full access for cron/backfill
CREATE POLICY "Service role full access to weekly snapshots"
  ON inventory_weekly_snapshots FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

GRANT ALL ON inventory_weekly_snapshots TO service_role;
GRANT SELECT, INSERT, UPDATE ON inventory_weekly_snapshots TO authenticated;
