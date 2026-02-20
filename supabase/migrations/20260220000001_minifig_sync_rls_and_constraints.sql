-- Fix RLS policies and add constraints for minifig sync tables
-- Migration: 20260220000001_minifig_sync_rls_and_constraints
-- Fixes: M5 (config write access), M6 (price_cache DELETE), M7 (duplicate removal prevention)

-- ============================================================================
-- M5: Restrict config table INSERT/UPDATE to service role only
-- Config should be read-only for regular authenticated users.
-- Service role (cron jobs) bypasses RLS, so removing INSERT/UPDATE
-- policies effectively blocks direct user writes while still allowing
-- service-level writes.
-- ============================================================================

DROP POLICY IF EXISTS "Authenticated users can update config" ON minifig_sync_config;
DROP POLICY IF EXISTS "Authenticated users can insert config" ON minifig_sync_config;

-- ============================================================================
-- M6: Add DELETE policy on price_cache
-- Without this, expired cache entries cannot be cleaned up by authenticated users.
-- ============================================================================

CREATE POLICY "Authenticated users can delete price cache"
  ON minifig_price_cache FOR DELETE
  USING (auth.role() = 'authenticated');

-- ============================================================================
-- M7: Prevent duplicate removal queue entries
-- Add unique constraint on (minifig_sync_id, order_id) to prevent the same
-- sale from creating multiple removal entries on re-poll.
-- ============================================================================

CREATE UNIQUE INDEX IF NOT EXISTS idx_removal_queue_unique_sale
  ON minifig_removal_queue (minifig_sync_id, order_id)
  WHERE order_id IS NOT NULL;

-- Add user_id index on minifig_sync_items for faster user-scoped queries
CREATE INDEX IF NOT EXISTS idx_minifig_sync_user ON minifig_sync_items(user_id);

-- Add user_id index on removal_queue for faster user-scoped queries
CREATE INDEX IF NOT EXISTS idx_removal_queue_user ON minifig_removal_queue(user_id);

-- Add user_id index on sync_jobs for faster user-scoped queries
CREATE INDEX IF NOT EXISTS idx_sync_jobs_user ON minifig_sync_jobs(user_id);
