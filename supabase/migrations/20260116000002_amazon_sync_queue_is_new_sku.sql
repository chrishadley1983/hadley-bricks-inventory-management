-- Add is_new_sku flag to amazon_sync_queue table
-- This flag determines whether to use UPDATE (create new) or PATCH (update existing) operation
-- when submitting the JSON_LISTINGS_FEED to Amazon

ALTER TABLE amazon_sync_queue ADD COLUMN IF NOT EXISTS is_new_sku BOOLEAN DEFAULT false;

COMMENT ON COLUMN amazon_sync_queue.is_new_sku IS 'True if this SKU does not exist on Amazon yet and needs to be created with UPDATE operation';
