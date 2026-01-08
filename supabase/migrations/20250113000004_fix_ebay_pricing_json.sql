-- Fix eBay pricing_summary JSON extraction
-- Migration: 20250113000004_fix_ebay_pricing_json
--
-- Issue: pricing_summary->>'total' returns {"value": "66.63", "currency": "GBP"}
-- Need to extract: pricing_summary->'total'->>'value'

-- ============================================================================
-- DROP EXISTING VIEWS (must drop in order due to dependencies)
-- ============================================================================
DROP VIEW IF EXISTS monthly_platform_summary;
DROP VIEW IF EXISTS daily_platform_activity;

-- ============================================================================
-- CREATE DAILY PLATFORM ACTIVITY VIEW
-- ============================================================================
CREATE VIEW daily_platform_activity AS
WITH
-- ============================================================================
-- LISTING DATA SOURCES
-- ============================================================================

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

-- ============================================================================
-- SOLD DATA SOURCES
-- ============================================================================

-- Amazon sold: from platform_orders where platform = 'amazon'
amazon_sold AS (
  SELECT
    user_id,
    order_date::DATE AS activity_date,
    'amazon'::TEXT AS platform,
    COUNT(*)::INTEGER AS items_sold,
    COALESCE(SUM(total), 0)::NUMERIC(12,2) AS sold_value
  FROM platform_orders
  WHERE order_date IS NOT NULL
    AND LOWER(platform) = 'amazon'
    AND (
      internal_status IN ('Shipped', 'Completed')
      OR status ILIKE '%shipped%'
      OR status ILIKE '%completed%'
      OR status ILIKE '%delivered%'
    )
  GROUP BY user_id, order_date::DATE
),

-- eBay sold: from ebay_orders
-- Fixed: pricing_summary is JSONB with structure {total: {value: "66.63", currency: "GBP"}}
ebay_sold AS (
  SELECT
    user_id,
    creation_date::DATE AS activity_date,
    'ebay'::TEXT AS platform,
    COUNT(*)::INTEGER AS items_sold,
    COALESCE(SUM((pricing_summary->'total'->>'value')::NUMERIC), 0)::NUMERIC(12,2) AS sold_value
  FROM ebay_orders
  WHERE creation_date IS NOT NULL
    AND order_fulfilment_status = 'FULFILLED'
  GROUP BY user_id, creation_date::DATE
),

-- BrickLink sold: from bricklink_transactions
bricklink_sold AS (
  SELECT
    user_id,
    order_date::DATE AS activity_date,
    'bricklink'::TEXT AS platform,
    COUNT(*)::INTEGER AS items_sold,
    COALESCE(SUM(base_grand_total), 0)::NUMERIC(12,2) AS sold_value
  FROM bricklink_transactions
  WHERE order_date IS NOT NULL
    AND order_status IN ('SHIPPED', 'RECEIVED', 'COMPLETED')
  GROUP BY user_id, order_date::DATE
),

-- BrickOwl sold: from brickowl_transactions (combined with BrickLink)
brickowl_sold AS (
  SELECT
    user_id,
    order_date::DATE AS activity_date,
    'bricklink'::TEXT AS platform,
    COUNT(*)::INTEGER AS items_sold,
    COALESCE(SUM(base_grand_total), 0)::NUMERIC(12,2) AS sold_value
  FROM brickowl_transactions
  WHERE order_date IS NOT NULL
    AND order_status IN ('Shipped', 'Received')
  GROUP BY user_id, order_date::DATE
),

-- Combine all sold data
all_sold AS (
  SELECT * FROM amazon_sold
  UNION ALL
  SELECT * FROM ebay_sold
  UNION ALL
  SELECT * FROM bricklink_sold
  UNION ALL
  SELECT * FROM brickowl_sold
),

-- Aggregate sold data by user/date/platform
sold_data AS (
  SELECT
    user_id,
    activity_date,
    platform,
    SUM(items_sold)::INTEGER AS items_sold,
    SUM(sold_value)::NUMERIC(12,2) AS sold_value
  FROM all_sold
  GROUP BY user_id, activity_date, platform
)

-- ============================================================================
-- FINAL OUTPUT
-- ============================================================================
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
-- COMMENTS
-- ============================================================================
COMMENT ON VIEW daily_platform_activity IS 'Daily aggregated listing and sales activity per platform. Listings from inventory_items (Amazon/eBay) and bricklink_uploads (BrickLink). Sales from platform_orders (Amazon), ebay_orders (eBay), bricklink_transactions + brickowl_transactions (BrickLink).';
COMMENT ON VIEW monthly_platform_summary IS 'Monthly aggregated listing and sales activity per platform';
