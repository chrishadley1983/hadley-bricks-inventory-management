-- Service API Keys for Machine-to-Machine Authentication
-- Migration: 20260203000001_service_api_keys
-- Purpose: Enable Peter (and other automated clients) to call service endpoints

-- ============================================================================
-- SERVICE API KEYS TABLE
-- ============================================================================
CREATE TABLE service_api_keys (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Key identification
  name TEXT NOT NULL,                         -- "peter-bot", "automation-1"
  key_hash TEXT NOT NULL UNIQUE,              -- SHA-256 hash of the actual key
  key_prefix TEXT NOT NULL,                   -- First 8 chars for identification (e.g., "hb_sk_ab")

  -- Permissions
  permissions JSONB DEFAULT '["read"]'::jsonb NOT NULL,  -- ["read", "write", "admin"]

  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  last_used_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ,                     -- NULL = never expires
  revoked_at TIMESTAMPTZ,                     -- Set when key is revoked

  -- Audit
  created_by UUID REFERENCES profiles(id) ON DELETE SET NULL
);

-- ============================================================================
-- INDEXES
-- ============================================================================
CREATE INDEX idx_service_api_keys_hash ON service_api_keys(key_hash);
CREATE INDEX idx_service_api_keys_prefix ON service_api_keys(key_prefix);
CREATE INDEX idx_service_api_keys_name ON service_api_keys(name);
CREATE INDEX idx_service_api_keys_created_by ON service_api_keys(created_by) WHERE created_by IS NOT NULL;

-- ============================================================================
-- ROW LEVEL SECURITY
-- ============================================================================
ALTER TABLE service_api_keys ENABLE ROW LEVEL SECURITY;

-- Only admins (via service role) can manage API keys
-- No user-level policies - all access is through service role client

-- ============================================================================
-- COMMENTS
-- ============================================================================
COMMENT ON TABLE service_api_keys IS 'API keys for machine-to-machine authentication (Peter, automations)';
COMMENT ON COLUMN service_api_keys.key_hash IS 'SHA-256 hash of the key - actual key is never stored';
COMMENT ON COLUMN service_api_keys.key_prefix IS 'First 8 chars of key for identification in logs';
COMMENT ON COLUMN service_api_keys.permissions IS 'Array of permission strings: read, write, admin';
COMMENT ON COLUMN service_api_keys.expires_at IS 'Optional expiration - NULL means never expires';
COMMENT ON COLUMN service_api_keys.revoked_at IS 'Set when key is manually revoked';
