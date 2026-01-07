-- eBay Digital Signing Keys
-- Migration: 20250107000001_ebay_signing_keys
-- Purpose: Store keypairs for eBay Finances API digital signatures

-- Add signing key columns to ebay_credentials
-- The private_key is stored encrypted at the application level
-- The jwe is the x-ebay-signature-key header value from eBay Key Management API
ALTER TABLE ebay_credentials
  ADD COLUMN IF NOT EXISTS signing_key_id TEXT,
  ADD COLUMN IF NOT EXISTS private_key TEXT,
  ADD COLUMN IF NOT EXISTS public_key TEXT,
  ADD COLUMN IF NOT EXISTS jwe TEXT,
  ADD COLUMN IF NOT EXISTS signing_key_expires_at TIMESTAMPTZ;

-- Add sync mode columns to ebay_sync_config
ALTER TABLE ebay_sync_config
  ADD COLUMN IF NOT EXISTS from_date TEXT,
  ADD COLUMN IF NOT EXISTS to_date TEXT;

COMMENT ON COLUMN ebay_credentials.signing_key_id IS 'Key ID from eBay Key Management API';
COMMENT ON COLUMN ebay_credentials.private_key IS 'Encrypted private key for signing requests';
COMMENT ON COLUMN ebay_credentials.public_key IS 'Public key from eBay Key Management API';
COMMENT ON COLUMN ebay_credentials.jwe IS 'JWE token to use as x-ebay-signature-key header';
COMMENT ON COLUMN ebay_credentials.signing_key_expires_at IS 'Expiration time of the signing key';
