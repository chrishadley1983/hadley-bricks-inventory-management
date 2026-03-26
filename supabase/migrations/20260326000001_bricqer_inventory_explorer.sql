-- Bricqer Inventory Explorer
-- Full snapshot of Bricqer inventory for the BrickSellerHub-style explorer view.
-- Synced periodically from the Bricqer API (all item types: Parts, Sets, Minifigs, Other).

-- ============================================
-- Snapshot items table
-- ============================================
CREATE TABLE bricqer_inventory_snapshot (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  bricqer_item_id INTEGER NOT NULL,
  item_number TEXT NOT NULL,
  item_name TEXT NOT NULL,
  item_type TEXT NOT NULL, -- 'Part', 'Set', 'Minifig'
  color_id INTEGER,
  color_name TEXT,
  color_rgb TEXT,
  condition TEXT NOT NULL DEFAULT 'Used', -- 'New' or 'Used'
  quantity INTEGER NOT NULL DEFAULT 1,
  bricqer_price NUMERIC(10,4) NOT NULL DEFAULT 0,
  image_url TEXT,
  storage_location TEXT,
  batch_id INTEGER,
  synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(user_id, bricqer_item_id)
);

-- Indexes for common queries
CREATE INDEX idx_bricqer_snapshot_user_type
  ON bricqer_inventory_snapshot(user_id, item_type);
CREATE INDEX idx_bricqer_snapshot_user_item_number
  ON bricqer_inventory_snapshot(user_id, item_number);
CREATE INDEX idx_bricqer_snapshot_user_condition
  ON bricqer_inventory_snapshot(user_id, condition);
CREATE INDEX idx_bricqer_snapshot_bricqer_id
  ON bricqer_inventory_snapshot(bricqer_item_id);

-- RLS
ALTER TABLE bricqer_inventory_snapshot ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own snapshot items"
  ON bricqer_inventory_snapshot FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own snapshot items"
  ON bricqer_inventory_snapshot FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own snapshot items"
  ON bricqer_inventory_snapshot FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own snapshot items"
  ON bricqer_inventory_snapshot FOR DELETE
  USING (auth.uid() = user_id);

CREATE POLICY "Service role full access to snapshot items"
  ON bricqer_inventory_snapshot FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

GRANT ALL ON bricqer_inventory_snapshot TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON bricqer_inventory_snapshot TO authenticated;

-- ============================================
-- Snapshot sync metadata (one row per user)
-- ============================================
CREATE TABLE bricqer_snapshot_meta (
  user_id UUID PRIMARY KEY REFERENCES profiles(id) ON DELETE CASCADE,
  last_full_sync TIMESTAMPTZ,
  total_items INTEGER NOT NULL DEFAULT 0,
  total_lots INTEGER NOT NULL DEFAULT 0,
  sync_status TEXT NOT NULL DEFAULT 'idle', -- 'idle', 'running', 'failed'
  sync_cursor INTEGER NOT NULL DEFAULT 0,
  sync_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- RLS
ALTER TABLE bricqer_snapshot_meta ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own snapshot meta"
  ON bricqer_snapshot_meta FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can upsert own snapshot meta"
  ON bricqer_snapshot_meta FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own snapshot meta"
  ON bricqer_snapshot_meta FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Service role full access to snapshot meta"
  ON bricqer_snapshot_meta FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

GRANT ALL ON bricqer_snapshot_meta TO service_role;
GRANT SELECT, INSERT, UPDATE ON bricqer_snapshot_meta TO authenticated;
