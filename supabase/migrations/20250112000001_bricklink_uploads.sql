-- BrickLink Uploads Tables
-- Migration: 20250112000001_bricklink_uploads
-- Purpose: Track inventory uploads/batches published to BrickLink/BrickOwl stores via Bricqer

-- ============================================================================
-- BRICKLINK UPLOADS TABLE (Tracks batches uploaded to stores)
-- ============================================================================
CREATE TABLE bricklink_uploads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,

  -- Bricqer sync identifiers
  bricqer_batch_id INTEGER,                    -- External ID from Bricqer (nullable for manual entries)
  bricqer_purchase_id INTEGER,                 -- Linked Bricqer purchase ID

  -- Core fields (from spreadsheet)
  upload_date DATE NOT NULL,                   -- activationDate from Bricqer
  total_quantity INTEGER NOT NULL DEFAULT 0,   -- totalQuantity (parts count)
  selling_price DECIMAL(12,2) NOT NULL DEFAULT 0, -- totalPrice (listing value)
  cost DECIMAL(12,2) DEFAULT 0,                -- From linked Bricqer purchase
  source TEXT,                                 -- Manual entry (e.g., "Car Boot", "eBay Lot")
  notes TEXT,                                  -- User notes

  -- Link to purchases table (optional FK)
  purchase_id UUID REFERENCES purchases(id) ON DELETE SET NULL,
  linked_lot TEXT,                             -- Legacy text reference (like inventory_items)

  -- Additional Bricqer batch fields
  lots INTEGER DEFAULT 0,                      -- Unique lot count
  condition CHAR(1) DEFAULT 'U',               -- 'N' (New) or 'U' (Used)
  reference TEXT,                              -- Bricqer batch reference
  is_activated BOOLEAN DEFAULT false,          -- Published status
  remaining_quantity INTEGER DEFAULT 0,        -- Unsold quantity
  remaining_price DECIMAL(12,2) DEFAULT 0,     -- Unsold value

  -- Audit fields
  raw_response JSONB,                          -- Raw Bricqer API response
  synced_from_bricqer BOOLEAN DEFAULT false,   -- Whether this came from sync

  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,

  -- Unique constraint for synced records (only where bricqer_batch_id is set)
  CONSTRAINT unique_user_bricqer_batch UNIQUE (user_id, bricqer_batch_id)
);

-- ============================================================================
-- BRICKLINK UPLOAD SYNC LOG TABLE (Tracking sync operations)
-- ============================================================================
CREATE TABLE bricklink_upload_sync_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  sync_mode TEXT NOT NULL CHECK (sync_mode IN ('FULL', 'INCREMENTAL')),
  status TEXT NOT NULL CHECK (status IN ('RUNNING', 'COMPLETED', 'FAILED')),
  started_at TIMESTAMPTZ NOT NULL,
  completed_at TIMESTAMPTZ,
  batches_processed INTEGER DEFAULT 0,
  batches_created INTEGER DEFAULT 0,
  batches_updated INTEGER DEFAULT 0,
  batches_skipped INTEGER DEFAULT 0,
  error_message TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

-- ============================================================================
-- BRICKLINK UPLOAD SYNC CONFIG TABLE (Sync settings)
-- ============================================================================
CREATE TABLE bricklink_upload_sync_config (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,

  -- Auto-sync settings
  auto_sync_enabled BOOLEAN DEFAULT false NOT NULL,
  auto_sync_interval_hours INTEGER DEFAULT 24 NOT NULL,
  last_auto_sync_at TIMESTAMPTZ,
  next_auto_sync_at TIMESTAMPTZ,

  -- Sync options
  sync_activated_only BOOLEAN DEFAULT true NOT NULL, -- Only sync activated batches

  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  UNIQUE(user_id)
);

-- ============================================================================
-- INDEXES
-- ============================================================================
CREATE INDEX idx_bricklink_uploads_user ON bricklink_uploads(user_id);
CREATE INDEX idx_bricklink_uploads_date ON bricklink_uploads(user_id, upload_date DESC);
CREATE INDEX idx_bricklink_uploads_bricqer_batch ON bricklink_uploads(bricqer_batch_id) WHERE bricqer_batch_id IS NOT NULL;
CREATE INDEX idx_bricklink_uploads_purchase ON bricklink_uploads(purchase_id) WHERE purchase_id IS NOT NULL;
CREATE INDEX idx_bricklink_uploads_source ON bricklink_uploads(user_id, source) WHERE source IS NOT NULL;

CREATE INDEX idx_bricklink_upload_sync_log_user ON bricklink_upload_sync_log(user_id);
CREATE INDEX idx_bricklink_upload_sync_log_started ON bricklink_upload_sync_log(user_id, started_at DESC);
CREATE INDEX idx_bricklink_upload_sync_log_status ON bricklink_upload_sync_log(user_id, status);

CREATE INDEX idx_bricklink_upload_sync_config_user ON bricklink_upload_sync_config(user_id);

-- ============================================================================
-- UPDATED_AT TRIGGERS
-- ============================================================================
CREATE TRIGGER update_bricklink_uploads_updated_at
  BEFORE UPDATE ON bricklink_uploads
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_bricklink_upload_sync_config_updated_at
  BEFORE UPDATE ON bricklink_upload_sync_config
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- ============================================================================
-- ROW LEVEL SECURITY
-- ============================================================================
ALTER TABLE bricklink_uploads ENABLE ROW LEVEL SECURITY;
ALTER TABLE bricklink_upload_sync_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE bricklink_upload_sync_config ENABLE ROW LEVEL SECURITY;

-- bricklink_uploads policies
CREATE POLICY "Users can view own BrickLink uploads"
  ON bricklink_uploads FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own BrickLink uploads"
  ON bricklink_uploads FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own BrickLink uploads"
  ON bricklink_uploads FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete own BrickLink uploads"
  ON bricklink_uploads FOR DELETE USING (auth.uid() = user_id);

-- bricklink_upload_sync_log policies
CREATE POLICY "Users can view own upload sync logs"
  ON bricklink_upload_sync_log FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own upload sync logs"
  ON bricklink_upload_sync_log FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own upload sync logs"
  ON bricklink_upload_sync_log FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete own upload sync logs"
  ON bricklink_upload_sync_log FOR DELETE USING (auth.uid() = user_id);

-- bricklink_upload_sync_config policies
CREATE POLICY "Users can view own upload sync config"
  ON bricklink_upload_sync_config FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own upload sync config"
  ON bricklink_upload_sync_config FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own upload sync config"
  ON bricklink_upload_sync_config FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete own upload sync config"
  ON bricklink_upload_sync_config FOR DELETE USING (auth.uid() = user_id);

-- ============================================================================
-- COMMENTS
-- ============================================================================
COMMENT ON TABLE bricklink_uploads IS 'Tracks inventory batches uploaded to BrickLink/BrickOwl stores via Bricqer';
COMMENT ON COLUMN bricklink_uploads.bricqer_batch_id IS 'External batch ID from Bricqer API';
COMMENT ON COLUMN bricklink_uploads.bricqer_purchase_id IS 'External purchase ID from Bricqer API';
COMMENT ON COLUMN bricklink_uploads.upload_date IS 'Date the batch was activated/published to stores';
COMMENT ON COLUMN bricklink_uploads.total_quantity IS 'Total number of parts/items in the batch';
COMMENT ON COLUMN bricklink_uploads.selling_price IS 'Total listing value (sum of all item prices)';
COMMENT ON COLUMN bricklink_uploads.cost IS 'Total cost of items (from linked purchase)';
COMMENT ON COLUMN bricklink_uploads.lots IS 'Number of unique lots in the batch';
COMMENT ON COLUMN bricklink_uploads.condition IS 'N = New, U = Used';
COMMENT ON COLUMN bricklink_uploads.remaining_quantity IS 'Quantity still available (not sold)';
COMMENT ON COLUMN bricklink_uploads.remaining_price IS 'Value of remaining inventory';
COMMENT ON COLUMN bricklink_uploads.synced_from_bricqer IS 'True if record was created/updated via Bricqer sync';
COMMENT ON TABLE bricklink_upload_sync_config IS 'Sync configuration for BrickLink uploads from Bricqer batches';
