-- Amazon Transaction Integration Migration
-- Migration: 20250111000001_amazon_transaction_integration
-- Purpose: Add Amazon financial transaction tables for Finances API v2024-06-19

-- ============================================================================
-- AMAZON_TRANSACTIONS TABLE
-- Store financial transactions from Amazon Finances API
-- ============================================================================

CREATE TABLE amazon_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,

  -- Amazon identifiers
  amazon_transaction_id TEXT NOT NULL,
  amazon_order_id TEXT,
  seller_order_id TEXT,
  marketplace_id TEXT,

  -- Transaction metadata
  transaction_type TEXT NOT NULL,
  transaction_status TEXT,
  posted_date TIMESTAMPTZ NOT NULL,
  description TEXT,

  -- Financial data
  total_amount DECIMAL(12,2) NOT NULL,
  currency TEXT NOT NULL,

  -- Fee breakdown columns (extracted from breakdowns)
  referral_fee DECIMAL(12,2),
  fba_fulfillment_fee DECIMAL(12,2),
  fba_per_unit_fee DECIMAL(12,2),
  fba_weight_fee DECIMAL(12,2),
  fba_inventory_storage_fee DECIMAL(12,2),
  shipping_credit DECIMAL(12,2),
  shipping_credit_tax DECIMAL(12,2),
  promotional_rebate DECIMAL(12,2),
  sales_tax_collected DECIMAL(12,2),
  marketplace_facilitator_tax DECIMAL(12,2),
  gift_wrap_credit DECIMAL(12,2),
  other_fees DECIMAL(12,2),

  -- Calculated fields
  gross_sales_amount DECIMAL(12,2),
  net_amount DECIMAL(12,2),
  total_fees DECIMAL(12,2),

  -- Denormalized from order/context data
  item_title TEXT,
  asin TEXT,
  seller_sku TEXT,
  quantity INTEGER,
  fulfillment_channel TEXT,
  store_name TEXT,

  -- Buyer info (if available)
  buyer_name TEXT,
  buyer_email TEXT,

  -- Raw storage
  breakdowns JSONB,
  contexts JSONB,
  related_identifiers JSONB,
  raw_response JSONB NOT NULL,

  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,

  -- Unique constraint per user
  UNIQUE(user_id, amazon_transaction_id)
);

-- ============================================================================
-- AMAZON_SETTLEMENTS TABLE
-- Store settlement/payout records
-- ============================================================================

CREATE TABLE amazon_settlements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,

  -- Settlement identifiers
  financial_event_group_id TEXT NOT NULL,
  settlement_id TEXT,

  -- Settlement metadata
  fund_transfer_status TEXT,
  fund_transfer_date TIMESTAMPTZ,
  trace_id TEXT,
  account_tail TEXT,

  -- Settlement period
  processing_period_start TIMESTAMPTZ,
  processing_period_end TIMESTAMPTZ,

  -- Financial summary
  beginning_balance DECIMAL(12,2),
  total_amount DECIMAL(12,2) NOT NULL,
  currency TEXT NOT NULL,
  transaction_count INTEGER,

  -- Raw storage
  raw_response JSONB NOT NULL,

  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,

  -- Unique constraint per user
  UNIQUE(user_id, financial_event_group_id)
);

-- ============================================================================
-- AMAZON_SYNC_CONFIG TABLE
-- Store auto-sync settings and cursors per user
-- ============================================================================

CREATE TABLE amazon_sync_config (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,

  -- Auto-sync settings
  auto_sync_enabled BOOLEAN DEFAULT false NOT NULL,
  auto_sync_interval_hours INTEGER DEFAULT 24 NOT NULL,
  last_auto_sync_at TIMESTAMPTZ,
  next_auto_sync_at TIMESTAMPTZ,

  -- Sync cursors for incremental sync
  transactions_posted_cursor TIMESTAMPTZ,
  settlements_cursor TIMESTAMPTZ,

  -- Historical import tracking
  historical_import_started_at TIMESTAMPTZ,
  historical_import_completed_at TIMESTAMPTZ,
  historical_import_from_date DATE,

  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,

  UNIQUE(user_id)
);

-- ============================================================================
-- AMAZON_SYNC_LOG TABLE
-- Tracking sync operations
-- ============================================================================

CREATE TABLE amazon_sync_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  sync_type TEXT NOT NULL CHECK (sync_type IN ('TRANSACTIONS', 'SETTLEMENTS')),
  sync_mode TEXT DEFAULT 'INCREMENTAL' CHECK (sync_mode IN ('FULL', 'INCREMENTAL', 'HISTORICAL')),
  status TEXT NOT NULL CHECK (status IN ('RUNNING', 'COMPLETED', 'FAILED')),
  started_at TIMESTAMPTZ NOT NULL,
  completed_at TIMESTAMPTZ,
  records_processed INTEGER,
  records_created INTEGER,
  records_updated INTEGER,
  last_sync_cursor TEXT,
  from_date TIMESTAMPTZ,
  to_date TIMESTAMPTZ,
  error_message TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

-- ============================================================================
-- INDEXES
-- ============================================================================

-- amazon_transactions indexes
CREATE INDEX idx_amazon_transactions_user ON amazon_transactions(user_id);
CREATE INDEX idx_amazon_transactions_posted_date ON amazon_transactions(user_id, posted_date DESC);
CREATE INDEX idx_amazon_transactions_type ON amazon_transactions(user_id, transaction_type);
CREATE INDEX idx_amazon_transactions_order ON amazon_transactions(amazon_order_id) WHERE amazon_order_id IS NOT NULL;
CREATE INDEX idx_amazon_transactions_marketplace ON amazon_transactions(user_id, marketplace_id) WHERE marketplace_id IS NOT NULL;
CREATE INDEX idx_amazon_transactions_asin ON amazon_transactions(asin) WHERE asin IS NOT NULL;
CREATE INDEX idx_amazon_transactions_sku ON amazon_transactions(seller_sku) WHERE seller_sku IS NOT NULL;
CREATE INDEX idx_amazon_transactions_item_title ON amazon_transactions USING gin(to_tsvector('english', item_title)) WHERE item_title IS NOT NULL;

-- amazon_settlements indexes
CREATE INDEX idx_amazon_settlements_user ON amazon_settlements(user_id);
CREATE INDEX idx_amazon_settlements_fund_transfer_date ON amazon_settlements(user_id, fund_transfer_date DESC);
CREATE INDEX idx_amazon_settlements_status ON amazon_settlements(user_id, fund_transfer_status);

-- amazon_sync_config indexes
CREATE INDEX idx_amazon_sync_config_user ON amazon_sync_config(user_id);
CREATE INDEX idx_amazon_sync_config_next_sync ON amazon_sync_config(next_auto_sync_at) WHERE auto_sync_enabled = true;

-- amazon_sync_log indexes
CREATE INDEX idx_amazon_sync_log_user ON amazon_sync_log(user_id);
CREATE INDEX idx_amazon_sync_log_type ON amazon_sync_log(user_id, sync_type);
CREATE INDEX idx_amazon_sync_log_started ON amazon_sync_log(user_id, started_at DESC);

-- ============================================================================
-- UPDATED_AT TRIGGERS
-- ============================================================================

CREATE TRIGGER update_amazon_transactions_updated_at
  BEFORE UPDATE ON amazon_transactions
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_amazon_settlements_updated_at
  BEFORE UPDATE ON amazon_settlements
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_amazon_sync_config_updated_at
  BEFORE UPDATE ON amazon_sync_config
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- ============================================================================
-- ROW LEVEL SECURITY
-- ============================================================================

ALTER TABLE amazon_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE amazon_settlements ENABLE ROW LEVEL SECURITY;
ALTER TABLE amazon_sync_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE amazon_sync_log ENABLE ROW LEVEL SECURITY;

-- amazon_transactions policies
CREATE POLICY "Users can view own Amazon transactions"
  ON amazon_transactions FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own Amazon transactions"
  ON amazon_transactions FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own Amazon transactions"
  ON amazon_transactions FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own Amazon transactions"
  ON amazon_transactions FOR DELETE
  USING (auth.uid() = user_id);

-- amazon_settlements policies
CREATE POLICY "Users can view own Amazon settlements"
  ON amazon_settlements FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own Amazon settlements"
  ON amazon_settlements FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own Amazon settlements"
  ON amazon_settlements FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own Amazon settlements"
  ON amazon_settlements FOR DELETE
  USING (auth.uid() = user_id);

-- amazon_sync_config policies
CREATE POLICY "Users can view own Amazon sync config"
  ON amazon_sync_config FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own Amazon sync config"
  ON amazon_sync_config FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own Amazon sync config"
  ON amazon_sync_config FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own Amazon sync config"
  ON amazon_sync_config FOR DELETE
  USING (auth.uid() = user_id);

-- amazon_sync_log policies
CREATE POLICY "Users can view own Amazon sync logs"
  ON amazon_sync_log FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own Amazon sync logs"
  ON amazon_sync_log FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own Amazon sync logs"
  ON amazon_sync_log FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own Amazon sync logs"
  ON amazon_sync_log FOR DELETE
  USING (auth.uid() = user_id);

-- ============================================================================
-- COMMENTS
-- ============================================================================

COMMENT ON TABLE amazon_transactions IS 'Financial transactions from Amazon Finances API v2024-06-19';
COMMENT ON COLUMN amazon_transactions.amazon_transaction_id IS 'Unique transaction ID from Amazon (derived from relatedIdentifiers)';
COMMENT ON COLUMN amazon_transactions.transaction_type IS 'Transaction type: Shipment, Refund, ServiceFee, Adjustment, etc.';
COMMENT ON COLUMN amazon_transactions.transaction_status IS 'Status: RELEASED, DEFERRED, DEFERRED_RELEASED';
COMMENT ON COLUMN amazon_transactions.breakdowns IS 'Full hierarchical fee breakdown from API response';
COMMENT ON COLUMN amazon_transactions.gross_sales_amount IS 'Calculated: total_amount before fees (what buyer paid)';
COMMENT ON COLUMN amazon_transactions.total_fees IS 'Calculated: sum of all fee columns';

COMMENT ON TABLE amazon_settlements IS 'Settlement/payout records from Amazon';
COMMENT ON COLUMN amazon_settlements.financial_event_group_id IS 'Amazon financial event group ID';
COMMENT ON COLUMN amazon_settlements.trace_id IS 'Bank transfer trace/reference number';

COMMENT ON TABLE amazon_sync_config IS 'Auto-sync configuration and cursor tracking for Amazon integration';
COMMENT ON COLUMN amazon_sync_config.transactions_posted_cursor IS 'Last transaction postedDate for incremental sync';
COMMENT ON COLUMN amazon_sync_config.settlements_cursor IS 'Last settlement date for incremental sync';

COMMENT ON TABLE amazon_sync_log IS 'Audit log of Amazon sync operations';
