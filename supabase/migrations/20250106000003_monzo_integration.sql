-- Monzo Integration Tables
-- Migration: 20250106000001_monzo_integration
-- Purpose: Store Monzo OAuth credentials, transactions, and sync state

-- ============================================================================
-- MONZO CREDENTIALS TABLE (OAuth tokens for Monzo API access)
-- ============================================================================
CREATE TABLE monzo_credentials (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  monzo_user_id TEXT,
  access_token TEXT NOT NULL,
  refresh_token TEXT,  -- Optional, may not be provided
  access_token_expires_at TIMESTAMPTZ NOT NULL,
  account_id TEXT NOT NULL,  -- Required for transactions API
  account_type TEXT,  -- uk_retail, uk_retail_joint, etc.
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  UNIQUE(user_id)
);

-- ============================================================================
-- MONZO TRANSACTIONS TABLE (Raw transactions from Monzo API)
-- ============================================================================
CREATE TABLE monzo_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  monzo_transaction_id TEXT NOT NULL,  -- tx_xxx format from Monzo
  account_id TEXT NOT NULL,
  amount INTEGER NOT NULL,  -- In minor units (pence), negative=spending
  currency TEXT NOT NULL DEFAULT 'GBP',
  description TEXT,
  merchant JSONB,  -- Full merchant object from Monzo
  merchant_name TEXT,  -- Extracted for easy querying
  category TEXT,  -- Monzo's category
  local_category TEXT,  -- User's local category assignment
  user_notes TEXT,  -- User's custom notes
  tags TEXT[] DEFAULT '{}',  -- User-defined tags for business categorization
  is_load BOOLEAN DEFAULT FALSE,  -- Top-up transaction
  settled TIMESTAMPTZ,  -- When transaction was settled
  created TIMESTAMPTZ NOT NULL,  -- When transaction occurred (from Monzo)
  decline_reason TEXT,  -- If transaction was declined
  metadata JSONB,  -- Monzo metadata
  raw_response JSONB NOT NULL,  -- Full API response for debugging
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  UNIQUE(user_id, monzo_transaction_id)
);

-- ============================================================================
-- MONZO SYNC LOG TABLE (Tracking sync operations)
-- ============================================================================
CREATE TABLE monzo_sync_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  sync_type TEXT NOT NULL CHECK (sync_type IN ('FULL', 'INCREMENTAL')),
  status TEXT NOT NULL CHECK (status IN ('RUNNING', 'COMPLETED', 'FAILED')),
  started_at TIMESTAMPTZ NOT NULL,
  completed_at TIMESTAMPTZ,
  transactions_processed INTEGER DEFAULT 0,
  transactions_created INTEGER DEFAULT 0,
  transactions_updated INTEGER DEFAULT 0,
  last_transaction_id TEXT,  -- Store last transaction ID for incremental sync cursor
  error_message TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

-- ============================================================================
-- TRANSACTION TAGS TABLE (User-defined tags for categorization)
-- ============================================================================
CREATE TABLE transaction_tags (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  color TEXT,  -- Hex color for UI display
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  UNIQUE(user_id, name)
);

-- ============================================================================
-- INDEXES
-- ============================================================================
-- monzo_credentials
CREATE INDEX idx_monzo_credentials_user ON monzo_credentials(user_id);

-- monzo_transactions
CREATE INDEX idx_monzo_transactions_user ON monzo_transactions(user_id);
CREATE INDEX idx_monzo_transactions_created ON monzo_transactions(user_id, created DESC);
CREATE INDEX idx_monzo_transactions_category ON monzo_transactions(user_id, category);
CREATE INDEX idx_monzo_transactions_local_category ON monzo_transactions(user_id, local_category);
CREATE INDEX idx_monzo_transactions_merchant ON monzo_transactions(user_id, merchant_name);
CREATE INDEX idx_monzo_transactions_settled ON monzo_transactions(user_id, settled DESC);
CREATE INDEX idx_monzo_transactions_amount ON monzo_transactions(user_id, amount);

-- monzo_sync_log
CREATE INDEX idx_monzo_sync_log_user ON monzo_sync_log(user_id);
CREATE INDEX idx_monzo_sync_log_started ON monzo_sync_log(user_id, started_at DESC);
CREATE INDEX idx_monzo_sync_log_status ON monzo_sync_log(user_id, status);

-- transaction_tags
CREATE INDEX idx_transaction_tags_user ON transaction_tags(user_id);

-- ============================================================================
-- UPDATED_AT TRIGGERS
-- ============================================================================
CREATE TRIGGER update_monzo_credentials_updated_at
  BEFORE UPDATE ON monzo_credentials
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_monzo_transactions_updated_at
  BEFORE UPDATE ON monzo_transactions
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- ============================================================================
-- ROW LEVEL SECURITY
-- ============================================================================
ALTER TABLE monzo_credentials ENABLE ROW LEVEL SECURITY;
ALTER TABLE monzo_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE monzo_sync_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE transaction_tags ENABLE ROW LEVEL SECURITY;

-- monzo_credentials policies
CREATE POLICY "Users can view own Monzo credentials"
  ON monzo_credentials FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own Monzo credentials"
  ON monzo_credentials FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own Monzo credentials"
  ON monzo_credentials FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own Monzo credentials"
  ON monzo_credentials FOR DELETE
  USING (auth.uid() = user_id);

-- monzo_transactions policies
CREATE POLICY "Users can view own Monzo transactions"
  ON monzo_transactions FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own Monzo transactions"
  ON monzo_transactions FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own Monzo transactions"
  ON monzo_transactions FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own Monzo transactions"
  ON monzo_transactions FOR DELETE
  USING (auth.uid() = user_id);

-- monzo_sync_log policies
CREATE POLICY "Users can view own Monzo sync logs"
  ON monzo_sync_log FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own Monzo sync logs"
  ON monzo_sync_log FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own Monzo sync logs"
  ON monzo_sync_log FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own Monzo sync logs"
  ON monzo_sync_log FOR DELETE
  USING (auth.uid() = user_id);

-- transaction_tags policies
CREATE POLICY "Users can view own transaction tags"
  ON transaction_tags FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own transaction tags"
  ON transaction_tags FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own transaction tags"
  ON transaction_tags FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own transaction tags"
  ON transaction_tags FOR DELETE
  USING (auth.uid() = user_id);
