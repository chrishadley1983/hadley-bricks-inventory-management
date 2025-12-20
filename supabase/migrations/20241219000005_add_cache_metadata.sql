-- Create cache_metadata table for tracking sync status
-- This table stores metadata about when data was last synced from Google Sheets

CREATE TABLE IF NOT EXISTS cache_metadata (
  id TEXT PRIMARY KEY,
  table_name TEXT NOT NULL,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  last_sync TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  sync_status TEXT NOT NULL DEFAULT 'pending' CHECK (sync_status IN ('pending', 'success', 'error')),
  error_message TEXT,
  record_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Create index for fast lookups
CREATE INDEX IF NOT EXISTS idx_cache_metadata_user_table ON cache_metadata(user_id, table_name);

-- Enable RLS
ALTER TABLE cache_metadata ENABLE ROW LEVEL SECURITY;

-- RLS policies
CREATE POLICY "Users can view their own cache metadata"
  ON cache_metadata FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own cache metadata"
  ON cache_metadata FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own cache metadata"
  ON cache_metadata FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own cache metadata"
  ON cache_metadata FOR DELETE
  USING (auth.uid() = user_id);

-- Add sheets_synced_at column to inventory_items table
ALTER TABLE inventory_items ADD COLUMN IF NOT EXISTS sheets_synced_at TIMESTAMPTZ;

-- Add sheets_id and sheets_synced_at to purchases table (if not already exists)
ALTER TABLE purchases ADD COLUMN IF NOT EXISTS sheets_id TEXT;
ALTER TABLE purchases ADD COLUMN IF NOT EXISTS sheets_synced_at TIMESTAMPTZ;

-- Create unique index for sheets_id per user (for upsert operations)
CREATE UNIQUE INDEX IF NOT EXISTS idx_purchases_sheets_id_user ON purchases(sheets_id, user_id) WHERE sheets_id IS NOT NULL;

-- Note: Unique index on sku was skipped due to duplicate SKUs in existing data
-- The cache sync uses INSERT with conflict detection differently
-- CREATE UNIQUE INDEX IF NOT EXISTS idx_inventory_sku_user ON inventory_items(sku, user_id) WHERE sku IS NOT NULL;

-- Update trigger for cache_metadata
CREATE OR REPLACE FUNCTION update_cache_metadata_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_cache_metadata_updated_at
  BEFORE UPDATE ON cache_metadata
  FOR EACH ROW
  EXECUTE FUNCTION update_cache_metadata_updated_at();
