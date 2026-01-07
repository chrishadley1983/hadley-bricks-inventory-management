-- PayPal Integration Tables
-- Migration: 20250108000001_paypal_integration
-- Purpose: Store PayPal API credentials, fee transactions, and sync state

-- ============================================================================
-- PAYPAL CREDENTIALS TABLE (OAuth client credentials for PayPal API access)
-- ============================================================================
CREATE TABLE paypal_credentials (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  client_id TEXT NOT NULL,
  client_secret TEXT NOT NULL,
  access_token TEXT,
  access_token_expires_at TIMESTAMPTZ,
  sandbox BOOLEAN DEFAULT false NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  UNIQUE(user_id)
);

-- ============================================================================
-- PAYPAL TRANSACTIONS TABLE (Fee transactions from Transaction Search API)
-- Only stores transactions where fee != 0
-- ============================================================================
CREATE TABLE paypal_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  paypal_transaction_id TEXT NOT NULL,

  -- Transaction details
  transaction_date TIMESTAMPTZ NOT NULL,
  transaction_updated_date TIMESTAMPTZ,
  time_zone TEXT,
  transaction_type TEXT,
  transaction_event_code TEXT,
  transaction_status TEXT,

  -- Amounts
  gross_amount DECIMAL(12,2) NOT NULL,
  fee_amount DECIMAL(12,2) NOT NULL,
  net_amount DECIMAL(12,2) NOT NULL,
  balance_amount DECIMAL(12,2),
  currency TEXT NOT NULL DEFAULT 'GBP',

  -- Description and identification
  description TEXT,
  from_email TEXT,
  payer_name TEXT,
  bank_name TEXT,
  bank_account TEXT,

  -- Commerce fields
  postage_amount DECIMAL(12,2),
  vat_amount DECIMAL(12,2),
  invoice_id TEXT,
  reference_txn_id TEXT,

  -- Raw API response for audit
  raw_response JSONB NOT NULL,

  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  UNIQUE(user_id, paypal_transaction_id)
);

-- ============================================================================
-- PAYPAL SYNC LOG TABLE (Tracking sync operations)
-- ============================================================================
CREATE TABLE paypal_sync_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  sync_mode TEXT NOT NULL CHECK (sync_mode IN ('FULL', 'INCREMENTAL', 'HISTORICAL')),
  status TEXT NOT NULL CHECK (status IN ('RUNNING', 'COMPLETED', 'FAILED')),
  started_at TIMESTAMPTZ NOT NULL,
  completed_at TIMESTAMPTZ,
  transactions_processed INTEGER DEFAULT 0,
  transactions_created INTEGER DEFAULT 0,
  transactions_updated INTEGER DEFAULT 0,
  transactions_skipped INTEGER DEFAULT 0,
  from_date TIMESTAMPTZ,
  to_date TIMESTAMPTZ,
  last_sync_cursor TEXT,
  error_message TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

-- ============================================================================
-- PAYPAL SYNC CONFIG TABLE (Sync settings and cursors)
-- ============================================================================
CREATE TABLE paypal_sync_config (
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
-- paypal_credentials
CREATE INDEX idx_paypal_credentials_user ON paypal_credentials(user_id);

-- paypal_transactions
CREATE INDEX idx_paypal_transactions_user ON paypal_transactions(user_id);
CREATE INDEX idx_paypal_transactions_date ON paypal_transactions(user_id, transaction_date DESC);
CREATE INDEX idx_paypal_transactions_type ON paypal_transactions(user_id, transaction_type);
CREATE INDEX idx_paypal_transactions_fee ON paypal_transactions(user_id, fee_amount);
CREATE INDEX idx_paypal_transactions_invoice ON paypal_transactions(invoice_id) WHERE invoice_id IS NOT NULL;
CREATE INDEX idx_paypal_transactions_reference ON paypal_transactions(reference_txn_id) WHERE reference_txn_id IS NOT NULL;
CREATE INDEX idx_paypal_transactions_email ON paypal_transactions(user_id, from_email);

-- paypal_sync_log
CREATE INDEX idx_paypal_sync_log_user ON paypal_sync_log(user_id);
CREATE INDEX idx_paypal_sync_log_started ON paypal_sync_log(user_id, started_at DESC);
CREATE INDEX idx_paypal_sync_log_status ON paypal_sync_log(user_id, status);

-- paypal_sync_config
CREATE INDEX idx_paypal_sync_config_user ON paypal_sync_config(user_id);
CREATE INDEX idx_paypal_sync_config_next_sync ON paypal_sync_config(next_auto_sync_at) WHERE auto_sync_enabled = true;

-- ============================================================================
-- UPDATED_AT TRIGGERS
-- ============================================================================
CREATE TRIGGER update_paypal_credentials_updated_at
  BEFORE UPDATE ON paypal_credentials
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_paypal_transactions_updated_at
  BEFORE UPDATE ON paypal_transactions
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_paypal_sync_config_updated_at
  BEFORE UPDATE ON paypal_sync_config
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- ============================================================================
-- ROW LEVEL SECURITY
-- ============================================================================
ALTER TABLE paypal_credentials ENABLE ROW LEVEL SECURITY;
ALTER TABLE paypal_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE paypal_sync_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE paypal_sync_config ENABLE ROW LEVEL SECURITY;

-- paypal_credentials policies
CREATE POLICY "Users can view own PayPal credentials"
  ON paypal_credentials FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own PayPal credentials"
  ON paypal_credentials FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own PayPal credentials"
  ON paypal_credentials FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own PayPal credentials"
  ON paypal_credentials FOR DELETE
  USING (auth.uid() = user_id);

-- paypal_transactions policies
CREATE POLICY "Users can view own PayPal transactions"
  ON paypal_transactions FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own PayPal transactions"
  ON paypal_transactions FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own PayPal transactions"
  ON paypal_transactions FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own PayPal transactions"
  ON paypal_transactions FOR DELETE
  USING (auth.uid() = user_id);

-- paypal_sync_log policies
CREATE POLICY "Users can view own PayPal sync logs"
  ON paypal_sync_log FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own PayPal sync logs"
  ON paypal_sync_log FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own PayPal sync logs"
  ON paypal_sync_log FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own PayPal sync logs"
  ON paypal_sync_log FOR DELETE
  USING (auth.uid() = user_id);

-- paypal_sync_config policies
CREATE POLICY "Users can view own PayPal sync config"
  ON paypal_sync_config FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own PayPal sync config"
  ON paypal_sync_config FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own PayPal sync config"
  ON paypal_sync_config FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own PayPal sync config"
  ON paypal_sync_config FOR DELETE
  USING (auth.uid() = user_id);

-- ============================================================================
-- COMMENTS
-- ============================================================================
COMMENT ON TABLE paypal_credentials IS 'PayPal API client credentials for Transaction Search API access';
COMMENT ON TABLE paypal_transactions IS 'PayPal fee transactions from Transaction Search API - only stores records where fee != 0';
COMMENT ON COLUMN paypal_transactions.fee_amount IS 'PayPal fee amount - records are only stored when this is non-zero';
COMMENT ON COLUMN paypal_transactions.reference_txn_id IS 'Links refunds to original transactions';
COMMENT ON COLUMN paypal_transactions.transaction_event_code IS 'PayPal transaction event code (e.g., T0006 for payment received)';
COMMENT ON TABLE paypal_sync_config IS 'Auto-sync configuration and cursor tracking for PayPal integration';
COMMENT ON COLUMN paypal_sync_config.last_sync_date_cursor IS 'Last transaction date for incremental transaction sync';
