-- Fix: Change unique constraint from global (user_id, ebay_item_id) to per-set (user_id, ebay_item_id, set_number)
-- This allows the same eBay listing to be excluded under multiple set numbers independently.
-- Previously, a minifig listing excluded under set 2019-1 (because "2019" was in the title)
-- would prevent it from being excluded under set 71043-1 where it actually appeared.

-- Step 1: Drop the old global unique constraint
ALTER TABLE excluded_ebay_listings DROP CONSTRAINT IF EXISTS excluded_ebay_listings_user_id_ebay_item_id_key;

-- Step 2: Add the new per-set unique constraint
ALTER TABLE excluded_ebay_listings ADD CONSTRAINT excluded_ebay_listings_user_id_ebay_item_id_set_number_key
  UNIQUE(user_id, ebay_item_id, set_number);

-- Step 3: Purge all existing exclusion records (stale legacy data + cross-set collisions)
-- The FP detector will re-run immediately after this migration to repopulate correctly.
DELETE FROM excluded_ebay_listings;
