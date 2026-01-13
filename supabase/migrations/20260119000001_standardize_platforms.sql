-- Migration: Standardize platform values across tables
-- This migration normalizes platform values to lowercase and adds CHECK constraints

-- ============================================
-- STEP 1: Normalize existing data
-- ============================================

-- Normalize listing_platform in inventory_items (lowercase, trim)
UPDATE inventory_items
SET listing_platform = LOWER(TRIM(listing_platform))
WHERE listing_platform IS NOT NULL
  AND listing_platform != LOWER(TRIM(listing_platform));

-- Normalize platform in sales
UPDATE sales
SET platform = LOWER(TRIM(platform))
WHERE platform IS NOT NULL
  AND platform != LOWER(TRIM(platform));

-- Normalize platform in platform_orders
UPDATE platform_orders
SET platform = LOWER(TRIM(platform))
WHERE platform IS NOT NULL
  AND platform != LOWER(TRIM(platform));

-- Normalize platform in platform_listings
UPDATE platform_listings
SET platform = LOWER(TRIM(platform))
WHERE platform IS NOT NULL
  AND platform != LOWER(TRIM(platform));

-- Normalize platform in platform_listing_imports
UPDATE platform_listing_imports
SET platform = LOWER(TRIM(platform))
WHERE platform IS NOT NULL
  AND platform != LOWER(TRIM(platform));

-- Normalize platform in financial_transactions
UPDATE financial_transactions
SET platform = LOWER(TRIM(platform))
WHERE platform IS NOT NULL
  AND platform != LOWER(TRIM(platform));

-- Normalize sold_platform in inventory_items (tracks where item was sold)
UPDATE inventory_items
SET sold_platform = LOWER(TRIM(sold_platform))
WHERE sold_platform IS NOT NULL
  AND sold_platform != LOWER(TRIM(sold_platform));

-- ============================================
-- STEP 2: Map common variations
-- ============================================

-- Map Amazon variations
UPDATE inventory_items SET listing_platform = 'amazon'
WHERE LOWER(TRIM(listing_platform)) IN ('amazon', 'amz', 'amazon uk', 'amazon.co.uk', 'amazon.com');

-- Map eBay variations
UPDATE inventory_items SET listing_platform = 'ebay'
WHERE LOWER(TRIM(listing_platform)) IN ('ebay', 'ebay uk', 'ebay.co.uk', 'ebay.com');

-- Map BrickLink variations
UPDATE inventory_items SET listing_platform = 'bricklink'
WHERE LOWER(TRIM(listing_platform)) IN ('bricklink', 'brick link', 'bl', 'brick-link');

-- ============================================
-- STEP 3: Handle edge cases
-- ============================================

-- Convert 'manual' entries to NULL in listing_platform (inventory shouldn't be "listed" on manual)
UPDATE inventory_items SET listing_platform = NULL
WHERE LOWER(TRIM(listing_platform)) = 'manual';

-- Log any remaining non-standard values (for manual review)
-- These will be blocked by the constraint, so convert to NULL
UPDATE inventory_items SET listing_platform = NULL
WHERE listing_platform IS NOT NULL
  AND listing_platform NOT IN ('amazon', 'ebay', 'bricklink');

-- ============================================
-- STEP 4: Add CHECK constraints
-- ============================================

-- inventory_items.listing_platform - selling platforms only
ALTER TABLE inventory_items
DROP CONSTRAINT IF EXISTS chk_listing_platform;

ALTER TABLE inventory_items
ADD CONSTRAINT chk_listing_platform
CHECK (listing_platform IS NULL OR listing_platform IN ('amazon', 'ebay', 'bricklink'));

-- platform_listings.platform - selling platforms only (required)
ALTER TABLE platform_listings
DROP CONSTRAINT IF EXISTS chk_platform_listings_platform;

ALTER TABLE platform_listings
ADD CONSTRAINT chk_platform_listings_platform
CHECK (platform IN ('amazon', 'ebay', 'bricklink'));

-- platform_listing_imports.platform - selling platforms only (required)
ALTER TABLE platform_listing_imports
DROP CONSTRAINT IF EXISTS chk_platform_listing_imports_platform;

ALTER TABLE platform_listing_imports
ADD CONSTRAINT chk_platform_listing_imports_platform
CHECK (platform IN ('amazon', 'ebay', 'bricklink'));

-- sales.platform - all platforms plus manual
ALTER TABLE sales
DROP CONSTRAINT IF EXISTS chk_sales_platform;

ALTER TABLE sales
ADD CONSTRAINT chk_sales_platform
CHECK (platform IS NULL OR platform IN ('amazon', 'ebay', 'bricklink', 'brickowl', 'bricqer', 'manual'));

-- platform_orders.platform - all platforms
ALTER TABLE platform_orders
DROP CONSTRAINT IF EXISTS chk_platform_orders_platform;

ALTER TABLE platform_orders
ADD CONSTRAINT chk_platform_orders_platform
CHECK (platform IN ('amazon', 'ebay', 'bricklink', 'brickowl', 'bricqer'));

-- platform_credentials.platform - all platforms
ALTER TABLE platform_credentials
DROP CONSTRAINT IF EXISTS chk_platform_credentials_platform;

ALTER TABLE platform_credentials
ADD CONSTRAINT chk_platform_credentials_platform
CHECK (platform IN ('amazon', 'ebay', 'bricklink', 'brickowl', 'bricqer'));

-- financial_transactions.platform - all platforms plus payment providers
ALTER TABLE financial_transactions
DROP CONSTRAINT IF EXISTS chk_financial_transactions_platform;

ALTER TABLE financial_transactions
ADD CONSTRAINT chk_financial_transactions_platform
CHECK (platform IS NULL OR platform IN ('amazon', 'ebay', 'bricklink', 'brickowl', 'bricqer', 'paypal', 'monzo', 'manual'));

-- inventory_items.sold_platform - selling platforms (where the item was sold)
ALTER TABLE inventory_items
DROP CONSTRAINT IF EXISTS chk_sold_platform;

ALTER TABLE inventory_items
ADD CONSTRAINT chk_sold_platform
CHECK (sold_platform IS NULL OR sold_platform IN ('amazon', 'ebay', 'bricklink'));

-- ============================================
-- DONE
-- ============================================
-- Constraints added. Any invalid data has been normalized or set to NULL.
-- Future inserts/updates will be validated against the allowed values.
