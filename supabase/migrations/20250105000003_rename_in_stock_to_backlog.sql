-- ============================================================================
-- MIGRATION: Rename 'IN STOCK' status to 'BACKLOG'
-- ============================================================================
-- This migration updates all inventory items with status 'IN STOCK' to 'BACKLOG'
-- to better reflect that these items are in the backlog waiting to be listed.
-- ============================================================================

-- Update existing records
UPDATE inventory_items
SET status = 'BACKLOG'
WHERE status = 'IN STOCK';

-- Update the default value for new records
ALTER TABLE inventory_items
ALTER COLUMN status SET DEFAULT 'NOT YET RECEIVED';
