-- BrickOwl Transaction Staging Tables
-- Migration: 20250110000001_brickowl_transaction_staging
-- Purpose: Store BrickOwl orders with full financial breakdown for transaction staging

-- ============================================================================
-- BRICKOWL TRANSACTIONS TABLE (All orders with full financial breakdown)
-- ============================================================================
CREATE TABLE brickowl_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  brickowl_order_id TEXT NOT NULL,

  -- Order metadata
  order_date TIMESTAMPTZ NOT NULL,
  status_changed_date TIMESTAMPTZ,
  buyer_name TEXT NOT NULL,
  buyer_email TEXT,
  buyer_username TEXT,
  base_currency TEXT NOT NULL DEFAULT 'GBP',

  -- Financial breakdown (simplified for BrickOwl API fields)
  order_total DECIMAL(12,2) NOT NULL,          -- sub_total from API
  shipping DECIMAL(12,2) DEFAULT 0,            -- total_shipping from API
  tax DECIMAL(12,2) DEFAULT 0,                 -- total_tax from API
  coupon_discount DECIMAL(12,2) DEFAULT 0,     -- coupon_discount from API
  combined_shipping_discount DECIMAL(12,2) DEFAULT 0, -- combined_shipping_discount from API
  base_grand_total DECIMAL(12,2) NOT NULL,     -- order_total from API (final total)

  -- Order counts
  total_lots INTEGER DEFAULT 0,
  total_items INTEGER DEFAULT 0,

  -- Status and payment
  order_status TEXT NOT NULL,
  payment_status TEXT,
  payment_method TEXT,

  -- Shipping details
  tracking_number TEXT,
  shipping_method TEXT,
  buyer_location TEXT,

  -- Notes
  buyer_note TEXT,
  seller_note TEXT,
  public_note TEXT,

  -- Raw API response for audit
  raw_response JSONB NOT NULL,

  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  UNIQUE(user_id, brickowl_order_id)
);

-- ============================================================================
-- BRICKOWL SYNC LOG TABLE (Tracking sync operations)
-- ============================================================================
CREATE TABLE brickowl_sync_log (
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
-- BRICKOWL SYNC CONFIG TABLE (Sync settings and cursors)
-- ============================================================================
CREATE TABLE brickowl_sync_config (
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

  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  UNIQUE(user_id)
);

-- ============================================================================
-- INDEXES
-- ============================================================================
CREATE INDEX idx_brickowl_transactions_user ON brickowl_transactions(user_id);
CREATE INDEX idx_brickowl_transactions_date ON brickowl_transactions(user_id, order_date DESC);
CREATE INDEX idx_brickowl_transactions_status ON brickowl_transactions(user_id, order_status);
CREATE INDEX idx_brickowl_transactions_buyer ON brickowl_transactions(user_id, buyer_name);
CREATE INDEX idx_brickowl_transactions_order_id ON brickowl_transactions(brickowl_order_id);

CREATE INDEX idx_brickowl_sync_log_user ON brickowl_sync_log(user_id);
CREATE INDEX idx_brickowl_sync_log_started ON brickowl_sync_log(user_id, started_at DESC);
CREATE INDEX idx_brickowl_sync_log_status ON brickowl_sync_log(user_id, status);

CREATE INDEX idx_brickowl_sync_config_user ON brickowl_sync_config(user_id);
CREATE INDEX idx_brickowl_sync_config_next_sync ON brickowl_sync_config(next_auto_sync_at)
  WHERE auto_sync_enabled = true;

-- ============================================================================
-- UPDATED_AT TRIGGERS
-- ============================================================================
CREATE TRIGGER update_brickowl_transactions_updated_at
  BEFORE UPDATE ON brickowl_transactions
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_brickowl_sync_config_updated_at
  BEFORE UPDATE ON brickowl_sync_config
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- ============================================================================
-- ROW LEVEL SECURITY
-- ============================================================================
ALTER TABLE brickowl_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE brickowl_sync_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE brickowl_sync_config ENABLE ROW LEVEL SECURITY;

-- brickowl_transactions policies
CREATE POLICY "Users can view own BrickOwl transactions"
  ON brickowl_transactions FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own BrickOwl transactions"
  ON brickowl_transactions FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own BrickOwl transactions"
  ON brickowl_transactions FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete own BrickOwl transactions"
  ON brickowl_transactions FOR DELETE USING (auth.uid() = user_id);

-- brickowl_sync_log policies
CREATE POLICY "Users can view own BrickOwl sync logs"
  ON brickowl_sync_log FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own BrickOwl sync logs"
  ON brickowl_sync_log FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own BrickOwl sync logs"
  ON brickowl_sync_log FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete own BrickOwl sync logs"
  ON brickowl_sync_log FOR DELETE USING (auth.uid() = user_id);

-- brickowl_sync_config policies
CREATE POLICY "Users can view own BrickOwl sync config"
  ON brickowl_sync_config FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own BrickOwl sync config"
  ON brickowl_sync_config FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own BrickOwl sync config"
  ON brickowl_sync_config FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete own BrickOwl sync config"
  ON brickowl_sync_config FOR DELETE USING (auth.uid() = user_id);

-- ============================================================================
-- COMMENTS
-- ============================================================================
COMMENT ON TABLE brickowl_transactions IS 'BrickOwl orders with full financial breakdown for transaction staging';
COMMENT ON COLUMN brickowl_transactions.order_total IS 'Subtotal before shipping/fees (sub_total from API)';
COMMENT ON COLUMN brickowl_transactions.shipping IS 'Shipping cost (total_shipping from API)';
COMMENT ON COLUMN brickowl_transactions.tax IS 'Tax/VAT amount (total_tax from API)';
COMMENT ON COLUMN brickowl_transactions.coupon_discount IS 'Coupon discount applied (coupon_discount from API)';
COMMENT ON COLUMN brickowl_transactions.combined_shipping_discount IS 'Multi-order shipping discount (combined_shipping_discount from API)';
COMMENT ON COLUMN brickowl_transactions.base_grand_total IS 'Final total after all adjustments (order_total from API)';
COMMENT ON TABLE brickowl_sync_config IS 'Auto-sync configuration and cursor tracking for BrickOwl transaction sync';
