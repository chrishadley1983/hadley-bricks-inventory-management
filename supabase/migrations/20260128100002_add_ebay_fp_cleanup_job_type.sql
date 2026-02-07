-- Migration: 20260128100001_add_ebay_fp_cleanup_job_type
-- Description: Add ebay_fp_cleanup to arbitrage_sync_status job_type constraint
-- Feature: ebay-arbitrage-cleanup

-- Drop the existing constraint
ALTER TABLE arbitrage_sync_status
  DROP CONSTRAINT IF EXISTS arbitrage_sync_status_job_type_check;

-- Add the updated constraint with ebay_fp_cleanup job type
ALTER TABLE arbitrage_sync_status
  ADD CONSTRAINT arbitrage_sync_status_job_type_check
  CHECK (job_type IN (
    'inventory_asins',
    'amazon_pricing',
    'bricklink_pricing',
    'asin_mapping',
    'ebay_pricing',
    'seeded_discovery',
    'pricing_sync',
    'ebay_scheduled_pricing',
    'bricklink_scheduled_pricing',
    'ebay_fp_cleanup'
  ));
