-- Migration: processed_purchase_emails table for email-based purchase import deduplication
-- This table tracks all emails processed by the automated purchase scanner

CREATE TABLE IF NOT EXISTS processed_purchase_emails (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email_id TEXT NOT NULL UNIQUE,  -- Gmail message ID (immutable identifier)
  source TEXT NOT NULL,           -- 'Vinted' or 'eBay'
  order_reference TEXT,           -- Order reference if extracted
  purchase_id UUID REFERENCES purchases(id) ON DELETE SET NULL,
  inventory_id UUID REFERENCES inventory_items(id) ON DELETE SET NULL,
  status TEXT NOT NULL CHECK (status IN ('imported', 'skipped', 'failed')),
  skip_reason TEXT,               -- Reason for skipping (no_set_number, invalid_set, manual_skip, etc.)
  error_message TEXT,             -- Error message if import failed
  email_subject TEXT,             -- Email subject for debugging
  email_date TIMESTAMPTZ,         -- Original email date
  item_name TEXT,                 -- Item name from email
  cost NUMERIC(10,2),             -- Purchase cost
  processed_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

-- Index for quick lookups
CREATE INDEX IF NOT EXISTS idx_processed_purchase_emails_email_id ON processed_purchase_emails(email_id);
CREATE INDEX IF NOT EXISTS idx_processed_purchase_emails_status ON processed_purchase_emails(status);
CREATE INDEX IF NOT EXISTS idx_processed_purchase_emails_source ON processed_purchase_emails(source);

-- RLS policies
ALTER TABLE processed_purchase_emails ENABLE ROW LEVEL SECURITY;

-- Service role can do everything
CREATE POLICY "service_role_full_access" ON processed_purchase_emails
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);
