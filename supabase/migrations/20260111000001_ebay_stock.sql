-- eBay Stock Tables and Extensions
-- Migration: 20260111000001_ebay_stock
-- Extends platform_listing_imports for eBay-specific tracking

-- ============================================================================
-- EXTEND PLATFORM_LISTING_IMPORTS FOR EBAY
-- ============================================================================

-- Add eBay-specific columns to platform_listing_imports
ALTER TABLE platform_listing_imports
ADD COLUMN IF NOT EXISTS ebay_page_number INT,
ADD COLUMN IF NOT EXISTS ebay_total_pages INT,
ADD COLUMN IF NOT EXISTS ebay_total_entries INT;

-- ============================================================================
-- INDEXES FOR EBAY QUERIES
-- ============================================================================

-- Index for eBay platform SKU queries
CREATE INDEX IF NOT EXISTS idx_platform_listings_ebay_sku
ON platform_listings(user_id, platform_sku)
WHERE platform = 'ebay';

-- Index for eBay condition queries
CREATE INDEX IF NOT EXISTS idx_platform_listings_ebay_status
ON platform_listings(user_id, listing_status)
WHERE platform = 'ebay';

-- ============================================================================
-- VIEW FOR SKU VALIDATION (Empty and Duplicate SKUs)
-- ============================================================================

-- Drop view if exists to allow recreation
DROP VIEW IF EXISTS ebay_sku_issues;

-- Create view for eBay SKU validation issues
CREATE VIEW ebay_sku_issues AS
WITH sku_counts AS (
  SELECT
    user_id,
    platform_sku,
    COUNT(*) as sku_count
  FROM platform_listings
  WHERE platform = 'ebay'
  GROUP BY user_id, platform_sku
)
SELECT
  pl.id,
  pl.user_id,
  pl.platform_sku,
  pl.platform_item_id,
  pl.title,
  pl.quantity,
  pl.price,
  pl.listing_status,
  pl.ebay_data,
  sc.sku_count,
  CASE
    WHEN pl.platform_sku IS NULL OR pl.platform_sku = '' THEN 'empty'
    WHEN sc.sku_count > 1 THEN 'duplicate'
    ELSE 'ok'
  END as issue_type,
  pl.created_at
FROM platform_listings pl
LEFT JOIN sku_counts sc ON pl.user_id = sc.user_id
  AND COALESCE(pl.platform_sku, '') = COALESCE(sc.platform_sku, '')
WHERE pl.platform = 'ebay'
  AND (
    pl.platform_sku IS NULL
    OR pl.platform_sku = ''
    OR sc.sku_count > 1
  );

-- ============================================================================
-- RLS FOR VIEW (Inherits from platform_listings)
-- ============================================================================

-- Note: Views inherit RLS from their underlying tables.
-- The ebay_sku_issues view is based on platform_listings which already has RLS.

-- ============================================================================
-- COMMENTS
-- ============================================================================

COMMENT ON VIEW ebay_sku_issues IS 'View showing eBay listings with SKU issues (empty or duplicate SKUs) for resolution';
COMMENT ON COLUMN platform_listing_imports.ebay_page_number IS 'Current page number during eBay import pagination';
COMMENT ON COLUMN platform_listing_imports.ebay_total_pages IS 'Total pages available from eBay API';
COMMENT ON COLUMN platform_listing_imports.ebay_total_entries IS 'Total entries reported by eBay API';
