-- Fix Daily Activity Reporting - Use sales table for sold data
-- Migration: 20250113000001_fix_daily_activity_sold_data
-- Purpose: Update views to use sales table instead of inventory_items for sold data

-- ============================================================================
-- DROP EXISTING VIEWS (must drop in order due to dependencies)
-- ============================================================================
DROP VIEW IF EXISTS monthly_platform_summary;
DROP VIEW IF EXISTS daily_platform_activity;

-- ============================================================================
-- CREATE DAILY PLATFORM ACTIVITY VIEW
-- Change sold data source from inventory_items to sales table
-- The sales table contains proper sale records with sale_date and platform
-- Cast all dates to DATE type for consistency
-- ============================================================================
CREATE VIEW daily_platform_activity AS
WITH
-- Listing data from inventory_items (Amazon/eBay only)
inventory_listings AS (
  SELECT
    user_id,
    listing_date::DATE AS activity_date,
    LOWER(listing_platform) AS platform,
    COUNT(*)::INTEGER AS items_listed,
    COALESCE(SUM(listing_value), 0)::NUMERIC(12,2) AS listing_value
  FROM inventory_items
  WHERE listing_date IS NOT NULL
    AND listing_platform IS NOT NULL
    AND LOWER(listing_platform) IN ('amazon', 'ebay')
  GROUP BY user_id, listing_date::DATE, LOWER(listing_platform)
),
-- Listing data from bricklink_uploads (BrickLink only)
bricklink_listings AS (
  SELECT
    user_id,
    upload_date::DATE AS activity_date,
    'bricklink'::TEXT AS platform,
    COALESCE(SUM(total_quantity), 0)::INTEGER AS items_listed,
    COALESCE(SUM(selling_price), 0)::NUMERIC(12,2) AS listing_value
  FROM bricklink_uploads
  WHERE upload_date IS NOT NULL
  GROUP BY user_id, upload_date::DATE
),
-- Combine all listings
all_listings AS (
  SELECT * FROM inventory_listings
  UNION ALL
  SELECT * FROM bricklink_listings
),
-- Sales data from sales table (all platforms)
-- Using sale_date and platform, counting distinct sales, summing sale_amount
sold_data AS (
  SELECT
    user_id,
    sale_date AS activity_date,
    LOWER(platform) AS platform,
    COUNT(*)::INTEGER AS items_sold,
    COALESCE(SUM(sale_amount), 0)::NUMERIC(12,2) AS sold_value
  FROM sales
  WHERE sale_date IS NOT NULL
    AND platform IS NOT NULL
    AND LOWER(platform) IN ('amazon', 'ebay', 'bricklink')
  GROUP BY user_id, sale_date, LOWER(platform)
)
-- Final join with full outer join to capture all activity
SELECT
  COALESCE(l.user_id, s.user_id) AS user_id,
  COALESCE(l.activity_date, s.activity_date) AS activity_date,
  COALESCE(l.platform, s.platform) AS platform,
  COALESCE(l.items_listed, 0) AS items_listed,
  COALESCE(l.listing_value, 0) AS listing_value,
  COALESCE(s.items_sold, 0) AS items_sold,
  COALESCE(s.sold_value, 0) AS sold_value
FROM all_listings l
FULL OUTER JOIN sold_data s
  ON l.user_id = s.user_id
  AND l.activity_date = s.activity_date
  AND l.platform = s.platform;

-- Grant select on the view
GRANT SELECT ON daily_platform_activity TO authenticated;

-- ============================================================================
-- CREATE MONTHLY PLATFORM SUMMARY VIEW
-- ============================================================================
CREATE VIEW monthly_platform_summary AS
SELECT
  user_id,
  DATE_TRUNC('month', activity_date)::DATE AS month_start,
  TO_CHAR(activity_date, 'YYYY-MM') AS month,
  platform,
  SUM(items_listed)::INTEGER AS items_listed,
  SUM(listing_value)::NUMERIC(12,2) AS listing_value,
  SUM(items_sold)::INTEGER AS items_sold,
  SUM(sold_value)::NUMERIC(12,2) AS sold_value
FROM daily_platform_activity
GROUP BY user_id, DATE_TRUNC('month', activity_date), TO_CHAR(activity_date, 'YYYY-MM'), platform;

-- Grant select on the view
GRANT SELECT ON monthly_platform_summary TO authenticated;

-- ============================================================================
-- ADD INDEX FOR SALES TABLE ACTIVITY QUERIES
-- ============================================================================
CREATE INDEX IF NOT EXISTS idx_sales_date_platform
  ON sales(user_id, sale_date, platform)
  WHERE sale_date IS NOT NULL AND platform IS NOT NULL;

-- ============================================================================
-- UPDATE COMMENTS
-- ============================================================================
COMMENT ON VIEW daily_platform_activity IS 'Daily aggregated listing and sales activity per platform. Listings from inventory_items (Amazon/eBay) and bricklink_uploads (BrickLink). Sales from sales table.';
COMMENT ON VIEW monthly_platform_summary IS 'Monthly aggregated listing and sales activity per platform';
