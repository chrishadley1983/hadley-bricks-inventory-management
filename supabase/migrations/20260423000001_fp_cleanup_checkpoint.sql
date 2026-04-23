-- eBay FP cleanup checkpoint support
--
-- The fp-cleanup job routinely exceeds Vercel's 300s wall because the recalc
-- aggregation phase scales with the count of sets that have previous
-- exclusions. Instead of trying to squeeze the whole thing into one
-- invocation, we make the job resumable: if we're approaching the wall,
-- we save a cursor and let the next cron run pick up where we left off.
--
-- `checkpoint_data` is written by the service on partial completion and
-- cleared on full completion. Shape:
--   { "phase": "recalc", "resume_after_set": "10355" }

ALTER TABLE arbitrage_sync_status
  ADD COLUMN IF NOT EXISTS checkpoint_data JSONB;

COMMENT ON COLUMN arbitrage_sync_status.checkpoint_data IS
  'Resume cursor for jobs that support partial completion across multiple cron runs.';
