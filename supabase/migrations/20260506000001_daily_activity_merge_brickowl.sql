-- Merge BrickOwl sales into the BrickLink bucket of the daily activity report.
--
-- Background: PR #376 dual-writes Brick Owl orders into platform_orders with
-- platform = 'brickowl'. The previous view filtered the BrickLink sales CTE on
-- LOWER(platform) = 'bricklink' (excluding brickowl) and read BO from
-- brickowl_transactions with order_status IN ('Shipped','Received'). Result:
-- recent BO orders sitting at 'Payment Received' never appeared in the report.
--
-- Fix: source BL+BO sales from a single CTE on platform_orders for both
-- platforms, with the same not-cancelled filter BL already uses. Drop the
-- brickowl_transactions CTE; the dual-write + a one-off backfill of historical
-- BO rows make platform_orders the single source of truth for BO sales.

DROP VIEW IF EXISTS monthly_platform_summary;
DROP VIEW IF EXISTS daily_platform_activity;

CREATE VIEW daily_platform_activity AS
WITH
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

all_listings AS (
  SELECT * FROM inventory_listings
  UNION ALL
  SELECT * FROM bricklink_listings
),

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

-- Combined BL + BO sales from platform_orders.
-- BO is dual-written to platform_orders by PR #376 (and the historical rows
-- have been backfilled), so this is now the single source of truth for both
-- platforms. They share the BrickLink column in the report.
bricklink_sold AS (
  SELECT
    user_id,
    order_date::DATE AS activity_date,
    'bricklink'::TEXT AS platform,
    COUNT(*)::INTEGER AS items_sold,
    COALESCE(SUM(total), 0)::NUMERIC(12,2) AS sold_value
  FROM platform_orders
  WHERE order_date IS NOT NULL
    AND LOWER(platform) IN ('bricklink', 'brickowl')
    AND (internal_status IS NULL OR internal_status != 'Cancelled')
    AND (status IS NULL OR status NOT ILIKE '%cancel%')
  GROUP BY user_id, order_date::DATE
),

all_sold AS (
  SELECT * FROM amazon_sold
  UNION ALL
  SELECT * FROM ebay_sold
  UNION ALL
  SELECT * FROM bricklink_sold
),

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

GRANT SELECT ON daily_platform_activity TO authenticated;

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

GRANT SELECT ON monthly_platform_summary TO authenticated;

-- Re-apply security_invoker (set in 20260422100001 — DROP/CREATE clears it).
ALTER VIEW public.daily_platform_activity SET (security_invoker = true);
ALTER VIEW public.monthly_platform_summary SET (security_invoker = true);

COMMENT ON VIEW daily_platform_activity IS 'Daily aggregated listing and sales activity per platform. Listings from inventory_items (Amazon/eBay) and bricklink_uploads (BrickLink). Sales from platform_orders for all platforms — BrickLink and Brick Owl are aggregated together under the bricklink column. Brick Owl rows in platform_orders carry platform = ''brickowl'' (dual-written by the BO sync).';
COMMENT ON VIEW monthly_platform_summary IS 'Monthly aggregated listing and sales activity per platform';
