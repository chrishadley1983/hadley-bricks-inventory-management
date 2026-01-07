-- Monzo Sheets Integration - Additional Fields
-- Migration: 20250106000004_monzo_sheets_fields
-- Purpose: Add fields from Google Sheets Monzo Transactions export

-- ============================================================================
-- ADD NEW COLUMNS TO monzo_transactions
-- ============================================================================

-- Transaction type (Faster payment, Card payment, etc.)
ALTER TABLE monzo_transactions
ADD COLUMN IF NOT EXISTS transaction_type TEXT;

-- Emoji from Monzo (visual category indicator)
ALTER TABLE monzo_transactions
ADD COLUMN IF NOT EXISTS emoji TEXT;

-- Local amount and currency (for foreign transactions)
ALTER TABLE monzo_transactions
ADD COLUMN IF NOT EXISTS local_amount INTEGER;

ALTER TABLE monzo_transactions
ADD COLUMN IF NOT EXISTS local_currency TEXT;

-- Address (merchant location)
ALTER TABLE monzo_transactions
ADD COLUMN IF NOT EXISTS address TEXT;

-- Time component (stored separately in sheets)
ALTER TABLE monzo_transactions
ADD COLUMN IF NOT EXISTS transaction_time TIME;

-- Source of data (api or sheets)
ALTER TABLE monzo_transactions
ADD COLUMN IF NOT EXISTS data_source TEXT DEFAULT 'api' CHECK (data_source IN ('api', 'sheets'));

-- Make some columns nullable that were NOT NULL for API but might be empty from sheets
ALTER TABLE monzo_transactions
ALTER COLUMN account_id DROP NOT NULL;

ALTER TABLE monzo_transactions
ALTER COLUMN raw_response DROP NOT NULL;

-- ============================================================================
-- UPDATE SYNC LOG FOR SHEETS SOURCE
-- ============================================================================

-- Add source type to sync log
ALTER TABLE monzo_sync_log
ADD COLUMN IF NOT EXISTS source TEXT DEFAULT 'api' CHECK (source IN ('api', 'sheets'));

-- ============================================================================
-- NEW INDEXES
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_monzo_transactions_type
ON monzo_transactions(user_id, transaction_type);

CREATE INDEX IF NOT EXISTS idx_monzo_transactions_source
ON monzo_transactions(user_id, data_source);

-- ============================================================================
-- COMMENTS
-- ============================================================================

COMMENT ON COLUMN monzo_transactions.transaction_type IS 'Type of transaction: Faster payment, Card payment, Direct Debit, etc.';
COMMENT ON COLUMN monzo_transactions.emoji IS 'Emoji associated with category in Monzo app';
COMMENT ON COLUMN monzo_transactions.local_amount IS 'Amount in original transaction currency (minor units)';
COMMENT ON COLUMN monzo_transactions.local_currency IS 'Original currency code for foreign transactions';
COMMENT ON COLUMN monzo_transactions.address IS 'Merchant address/location';
COMMENT ON COLUMN monzo_transactions.transaction_time IS 'Time portion of transaction (sheets stores separately)';
COMMENT ON COLUMN monzo_transactions.data_source IS 'Source of transaction data: api or sheets';
