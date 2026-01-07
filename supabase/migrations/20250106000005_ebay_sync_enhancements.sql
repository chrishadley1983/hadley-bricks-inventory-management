-- eBay Sync Enhancements Migration
-- Migration: 20250106000005_ebay_sync_enhancements
-- Purpose: Add fee breakdown columns to ebay_transactions and create sync config table

-- ============================================================================
-- ENHANCE EBAY_TRANSACTIONS TABLE
-- Add detailed fee breakdown columns and denormalized fields for reporting
-- ============================================================================

-- Fee breakdown columns (extracted from orderLineItems[].marketplaceFees[])
ALTER TABLE ebay_transactions
  ADD COLUMN IF NOT EXISTS final_value_fee_fixed DECIMAL(12,2),
  ADD COLUMN IF NOT EXISTS final_value_fee_variable DECIMAL(12,2),
  ADD COLUMN IF NOT EXISTS regulatory_operating_fee DECIMAL(12,2),
  ADD COLUMN IF NOT EXISTS international_fee DECIMAL(12,2),
  ADD COLUMN IF NOT EXISTS ad_fee DECIMAL(12,2),
  ADD COLUMN IF NOT EXISTS insertion_fee DECIMAL(12,2),
  ADD COLUMN IF NOT EXISTS gross_transaction_amount DECIMAL(12,2);

-- Denormalized fields from order data for quick access in reports
ALTER TABLE ebay_transactions
  ADD COLUMN IF NOT EXISTS sales_record_reference TEXT,
  ADD COLUMN IF NOT EXISTS item_title TEXT,
  ADD COLUMN IF NOT EXISTS custom_label TEXT,
  ADD COLUMN IF NOT EXISTS quantity INTEGER,
  ADD COLUMN IF NOT EXISTS item_location_country TEXT,
  ADD COLUMN IF NOT EXISTS postage_and_packaging DECIMAL(12,2),
  ADD COLUMN IF NOT EXISTS total_price DECIMAL(12,2);

-- ============================================================================
-- ENHANCE EBAY_PAYOUTS TABLE
-- Add additional detail columns
-- ============================================================================

ALTER TABLE ebay_payouts
  ADD COLUMN IF NOT EXISTS payout_memo TEXT,
  ADD COLUMN IF NOT EXISTS bank_reference TEXT,
  ADD COLUMN IF NOT EXISTS last_attempted_payout_date TIMESTAMPTZ;

-- ============================================================================
-- EBAY SYNC CONFIG TABLE
-- Store auto-sync settings and cursors per user
-- ============================================================================

CREATE TABLE IF NOT EXISTS ebay_sync_config (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,

  -- Auto-sync settings
  auto_sync_enabled BOOLEAN DEFAULT false NOT NULL,
  auto_sync_interval_hours INTEGER DEFAULT 24 NOT NULL,
  last_auto_sync_at TIMESTAMPTZ,
  next_auto_sync_at TIMESTAMPTZ,

  -- Sync cursors for incremental sync
  orders_last_modified_cursor TIMESTAMPTZ,
  transactions_date_cursor TIMESTAMPTZ,
  payouts_date_cursor TIMESTAMPTZ,

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
-- INDEXES FOR NEW COLUMNS
-- ============================================================================

-- ebay_transactions new columns
CREATE INDEX IF NOT EXISTS idx_ebay_transactions_sales_record
  ON ebay_transactions(sales_record_reference)
  WHERE sales_record_reference IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_ebay_transactions_custom_label
  ON ebay_transactions(custom_label)
  WHERE custom_label IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_ebay_transactions_item_title
  ON ebay_transactions USING gin(to_tsvector('english', item_title))
  WHERE item_title IS NOT NULL;

-- ebay_sync_config
CREATE INDEX IF NOT EXISTS idx_ebay_sync_config_user
  ON ebay_sync_config(user_id);

CREATE INDEX IF NOT EXISTS idx_ebay_sync_config_next_sync
  ON ebay_sync_config(next_auto_sync_at)
  WHERE auto_sync_enabled = true;

-- ============================================================================
-- UPDATED_AT TRIGGER
-- ============================================================================

CREATE TRIGGER update_ebay_sync_config_updated_at
  BEFORE UPDATE ON ebay_sync_config
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- ============================================================================
-- ROW LEVEL SECURITY
-- ============================================================================

ALTER TABLE ebay_sync_config ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own eBay sync config"
  ON ebay_sync_config FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own eBay sync config"
  ON ebay_sync_config FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own eBay sync config"
  ON ebay_sync_config FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own eBay sync config"
  ON ebay_sync_config FOR DELETE
  USING (auth.uid() = user_id);

-- ============================================================================
-- ADD SYNC_MODE TO EBAY_SYNC_LOG
-- Distinguish between FULL, INCREMENTAL, and HISTORICAL syncs
-- ============================================================================

ALTER TABLE ebay_sync_log
  ADD COLUMN IF NOT EXISTS sync_mode TEXT DEFAULT 'INCREMENTAL'
    CHECK (sync_mode IN ('FULL', 'INCREMENTAL', 'HISTORICAL'));

-- Add from_date and to_date for historical imports
ALTER TABLE ebay_sync_log
  ADD COLUMN IF NOT EXISTS from_date TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS to_date TIMESTAMPTZ;

-- ============================================================================
-- COMMENTS
-- ============================================================================

COMMENT ON TABLE ebay_sync_config IS 'Auto-sync configuration and cursor tracking for eBay integration';
COMMENT ON COLUMN ebay_sync_config.orders_last_modified_cursor IS 'Last order lastModifiedDate for incremental order sync';
COMMENT ON COLUMN ebay_sync_config.transactions_date_cursor IS 'Last transaction date for incremental transaction sync';
COMMENT ON COLUMN ebay_sync_config.payouts_date_cursor IS 'Last payout date for incremental payout sync';

COMMENT ON COLUMN ebay_transactions.final_value_fee_fixed IS 'eBay fixed final value fee extracted from marketplaceFees';
COMMENT ON COLUMN ebay_transactions.final_value_fee_variable IS 'eBay variable final value fee (percentage) extracted from marketplaceFees';
COMMENT ON COLUMN ebay_transactions.regulatory_operating_fee IS 'UK Digital Services Tax fee';
COMMENT ON COLUMN ebay_transactions.gross_transaction_amount IS 'Calculated: amount + all fees (what buyer paid)';
