-- Add seller_username column to processed_purchase_emails for review queue
ALTER TABLE processed_purchase_emails ADD COLUMN IF NOT EXISTS seller_username TEXT;

-- Add 'manual_skip' as valid status for dismissed review items
ALTER TABLE processed_purchase_emails DROP CONSTRAINT IF EXISTS processed_purchase_emails_status_check;
ALTER TABLE processed_purchase_emails ADD CONSTRAINT processed_purchase_emails_status_check
  CHECK (status IN ('imported', 'skipped', 'failed', 'manual_skip'));

-- Add RLS policy for authenticated users to read their own data via the review queue
CREATE POLICY "authenticated_read_access" ON processed_purchase_emails
  FOR SELECT
  TO authenticated
  USING (true);
