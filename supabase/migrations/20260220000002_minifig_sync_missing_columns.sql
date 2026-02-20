-- Add missing columns to minifig_sync_items
-- Migration: 20260220000002_minifig_sync_missing_columns
-- Fixes: CR-001 (columns used by code but not in original migration)

-- Best Offer thresholds (written by research.service.ts)
ALTER TABLE minifig_sync_items
  ADD COLUMN IF NOT EXISTS best_offer_auto_accept DECIMAL(10,2),
  ADD COLUMN IF NOT EXISTS best_offer_auto_decline DECIMAL(10,2);

-- eBay listing content (written by listing-staging.service.ts, listing-actions.service.ts)
ALTER TABLE minifig_sync_items
  ADD COLUMN IF NOT EXISTS ebay_title TEXT,
  ADD COLUMN IF NOT EXISTS ebay_description TEXT;
