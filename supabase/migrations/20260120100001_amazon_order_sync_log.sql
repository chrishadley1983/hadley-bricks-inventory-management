-- Allow ORDERS sync type in amazon_sync_log
-- This enables tracking of Amazon order sync operations

-- Alter the sync_type constraint to allow ORDERS
ALTER TABLE amazon_sync_log DROP CONSTRAINT IF EXISTS amazon_sync_log_sync_type_check;
ALTER TABLE amazon_sync_log ADD CONSTRAINT amazon_sync_log_sync_type_check
  CHECK (sync_type IN ('TRANSACTIONS', 'SETTLEMENTS', 'ORDERS'));
