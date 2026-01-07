-- BrickLink Transaction Staging Tables
-- Migration: 20250109000001_bricklink_transaction_staging
-- Purpose: Store BrickLink orders with full financial breakdown for transaction staging

-- ============================================================================
-- BRICKLINK TRANSACTIONS TABLE (All orders with full financial breakdown)
-- ============================================================================
CREATE TABLE bricklink_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  bricklink_order_id TEXT NOT NULL,

  -- Order metadata
  order_date TIMESTAMPTZ NOT NULL,
  status_changed_date TIMESTAMPTZ,
  buyer_name TEXT NOT NULL,
  buyer_email TEXT,
  base_currency TEXT NOT NULL DEFAULT 'GBP',

  -- Financial breakdown (spreadsheet columns)
  shipping DECIMAL(12,2) DEFAULT 0,
  insurance DECIMAL(12,2) DEFAULT 0,
  add_charge_1 DECIMAL(12,2) DEFAULT 0,
  add_charge_2 DECIMAL(12,2) DEFAULT 0,
  credit DECIMAL(12,2) DEFAULT 0,
  coupon_credit DECIMAL(12,2) DEFAULT 0,
  order_total DECIMAL(12,2) NOT NULL,
  tax DECIMAL(12,2) DEFAULT 0,
  base_grand_total DECIMAL(12,2) NOT NULL,

  -- Order counts
  total_lots INTEGER DEFAULT 0,
  total_items INTEGER DEFAULT 0,

  -- Status and payment
  order_status TEXT NOT NULL,
  payment_status TEXT,
  payment_method TEXT,
  payment_date TIMESTAMPTZ,

  -- Shipping details
  tracking_number TEXT,
  shipping_method TEXT,
  buyer_location TEXT,

  -- Notes
  order_note TEXT,
  seller_remarks TEXT,

  -- Raw API response for audit
  raw_response JSONB NOT NULL,

  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  UNIQUE(user_id, bricklink_order_id)
);

-- ============================================================================
-- BRICKLINK SYNC LOG TABLE (Tracking sync operations)
-- ============================================================================
CREATE TABLE bricklink_sync_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  sync_mode TEXT NOT NULL CHECK (sync_mode IN ('FULL', 'INCREMENTAL', 'HISTORICAL')),
  status TEXT NOT NULL CHECK (status IN ('RUNNING', 'COMPLETED', 'FAILED')),
  started_at TIMESTAMPTZ NOT NULL,
  completed_at TIMESTAMPTZ,
  orders_processed INTEGER DEFAULT 0,
  orders_created INTEGER DEFAULT 0,
  orders_updated INTEGER DEFAULT 0,
  orders_skipped INTEGER DEFAULT 0,
  from_date TIMESTAMPTZ,
  to_date TIMESTAMPTZ,
  last_sync_cursor TEXT,
  error_message TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

-- ============================================================================
-- BRICKLINK SYNC CONFIG TABLE (Sync settings and cursors)
-- ============================================================================
CREATE TABLE bricklink_sync_config (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,

  -- Auto-sync settings
  auto_sync_enabled BOOLEAN DEFAULT false NOT NULL,
  auto_sync_interval_hours INTEGER DEFAULT 24 NOT NULL,
  last_auto_sync_at TIMESTAMPTZ,
  next_auto_sync_at TIMESTAMPTZ,

  -- Sync cursor for incremental sync
  last_sync_date_cursor TIMESTAMPTZ,

  -- Historical import tracking
  historical_import_started_at TIMESTAMPTZ,
  historical_import_completed_at TIMESTAMPTZ,
  historical_import_from_date DATE,

  -- Include archived orders
  include_filed_orders BOOLEAN DEFAULT false NOT NULL,

  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  UNIQUE(user_id)
);

-- ============================================================================
-- INDEXES
-- ============================================================================
CREATE INDEX idx_bricklink_transactions_user ON bricklink_transactions(user_id);
CREATE INDEX idx_bricklink_transactions_date ON bricklink_transactions(user_id, order_date DESC);
CREATE INDEX idx_bricklink_transactions_status ON bricklink_transactions(user_id, order_status);
CREATE INDEX idx_bricklink_transactions_buyer ON bricklink_transactions(user_id, buyer_name);
CREATE INDEX idx_bricklink_transactions_order_id ON bricklink_transactions(bricklink_order_id);

CREATE INDEX idx_bricklink_sync_log_user ON bricklink_sync_log(user_id);
CREATE INDEX idx_bricklink_sync_log_started ON bricklink_sync_log(user_id, started_at DESC);
CREATE INDEX idx_bricklink_sync_log_status ON bricklink_sync_log(user_id, status);

CREATE INDEX idx_bricklink_sync_config_user ON bricklink_sync_config(user_id);
CREATE INDEX idx_bricklink_sync_config_next_sync ON bricklink_sync_config(next_auto_sync_at)
  WHERE auto_sync_enabled = true;

-- ============================================================================
-- UPDATED_AT TRIGGERS
-- ============================================================================
CREATE TRIGGER update_bricklink_transactions_updated_at
  BEFORE UPDATE ON bricklink_transactions
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_bricklink_sync_config_updated_at
  BEFORE UPDATE ON bricklink_sync_config
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- ============================================================================
-- ROW LEVEL SECURITY
-- ============================================================================
ALTER TABLE bricklink_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE bricklink_sync_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE bricklink_sync_config ENABLE ROW LEVEL SECURITY;

-- bricklink_transactions policies
CREATE POLICY "Users can view own BrickLink transactions"
  ON bricklink_transactions FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own BrickLink transactions"
  ON bricklink_transactions FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own BrickLink transactions"
  ON bricklink_transactions FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete own BrickLink transactions"
  ON bricklink_transactions FOR DELETE USING (auth.uid() = user_id);

-- bricklink_sync_log policies
CREATE POLICY "Users can view own BrickLink sync logs"
  ON bricklink_sync_log FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own BrickLink sync logs"
  ON bricklink_sync_log FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own BrickLink sync logs"
  ON bricklink_sync_log FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete own BrickLink sync logs"
  ON bricklink_sync_log FOR DELETE USING (auth.uid() = user_id);

-- bricklink_sync_config policies
CREATE POLICY "Users can view own BrickLink sync config"
  ON bricklink_sync_config FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own BrickLink sync config"
  ON bricklink_sync_config FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own BrickLink sync config"
  ON bricklink_sync_config FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete own BrickLink sync config"
  ON bricklink_sync_config FOR DELETE USING (auth.uid() = user_id);

-- ============================================================================
-- COMMENTS
-- ============================================================================
COMMENT ON TABLE bricklink_transactions IS 'BrickLink orders with full financial breakdown for transaction staging';
COMMENT ON COLUMN bricklink_transactions.add_charge_1 IS 'Additional charge 1 (e.g., handling fee)';
COMMENT ON COLUMN bricklink_transactions.add_charge_2 IS 'Additional charge 2 (e.g., packaging fee)';
COMMENT ON COLUMN bricklink_transactions.credit IS 'Store credit applied to order';
COMMENT ON COLUMN bricklink_transactions.coupon_credit IS 'Coupon discount applied to order';
COMMENT ON COLUMN bricklink_transactions.base_grand_total IS 'Final total in base currency after all adjustments';
COMMENT ON TABLE bricklink_sync_config IS 'Auto-sync configuration and cursor tracking for BrickLink transaction sync';
