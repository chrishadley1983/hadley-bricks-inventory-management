-- Persist group-add and reactivation counts in the Shopify batch sync log.
-- These summary fields existed in code (BatchSyncSummary) but were never
-- written, so ~110 items/run being re-added to groups was invisible in the log.
ALTER TABLE shopify_sync_log
  ADD COLUMN IF NOT EXISTS items_added_to_group integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS items_reactivated integer NOT NULL DEFAULT 0;
