-- Bricqer inventory stats cache table
-- Stores computed stats to avoid lengthy API calls on every dashboard load

CREATE TABLE IF NOT EXISTS bricqer_stats_cache (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  lot_count INTEGER NOT NULL DEFAULT 0,
  piece_count INTEGER NOT NULL DEFAULT 0,
  inventory_value DECIMAL(12, 2) NOT NULL DEFAULT 0,
  storage_locations INTEGER NOT NULL DEFAULT 0,
  last_updated TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(user_id)
);

-- Enable RLS
ALTER TABLE bricqer_stats_cache ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY "Users can view their own stats cache"
  ON bricqer_stats_cache FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own stats cache"
  ON bricqer_stats_cache FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own stats cache"
  ON bricqer_stats_cache FOR UPDATE
  USING (auth.uid() = user_id);

-- Index for quick lookups
CREATE INDEX idx_bricqer_stats_cache_user_id ON bricqer_stats_cache(user_id);

COMMENT ON TABLE bricqer_stats_cache IS 'Cached Bricqer inventory statistics to avoid slow API calls';
