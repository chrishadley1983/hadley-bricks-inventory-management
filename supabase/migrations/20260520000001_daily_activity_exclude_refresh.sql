-- Exclude refreshed listings from the daily_platform_activity view.
--
-- inventory_items.is_refresh is set to true when an item is created by the
-- eBay 90-day listing-refresh cron (see 20260318000001_add_is_refresh_to_inventory.sql).
-- These rows reset listing_date to the refresh day, which causes the Daily Activity
-- Report to spike with hundreds of "new" eBay listings every refresh batch (e.g. 491
-- on 03/05/2026, 370 on 14/05/2026).
--
-- The weekly targets metric was patched to filter is_refresh=false back in PR #305
-- (commit 903dfdb), but the daily_platform_activity view was missed. This migration
-- recreates the view (and the dependent monthly_platform_summary) with the same
-- filter applied to the inventory_listings CTE.
--
-- Amazon listings have no refresh flow today, so is_refresh is always false for
-- amazon rows — applying the filter to both platforms matches the workflow/metrics
-- behaviour and is a no-op for Amazon.
--
-- Sales CTEs and BrickLink/BrickOwl logic are unchanged from 20260506000002.

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
    AND COALESCE(is_refresh, false) = false
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

-- Amazon: count Paid + Shipped + Completed (not just shipped+).
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
      internal_status IN ('Paid', 'Shipped', 'Completed')
      OR status ILIKE 'Paid'
      OR status ILIKE '%shipped%'
      OR status ILIKE '%completed%'
      OR status ILIKE '%delivered%'
    )
    AND (status IS NULL OR (status NOT ILIKE '%cancel%' AND status NOT ILIKE '%refund%'))
  GROUP BY user_id, order_date::DATE
),

-- eBay: count once payment is captured. Refunded states are filtered by the
-- payment_status='PAID' equality; cancel_status guards a paid-then-cancelled.
ebay_sold AS (
  SELECT
    user_id,
    creation_date::DATE AS activity_date,
    'ebay'::TEXT AS platform,
    COUNT(*)::INTEGER AS items_sold,
    COALESCE(SUM((pricing_summary->'total'->>'value')::NUMERIC), 0)::NUMERIC(12,2) AS sold_value
  FROM ebay_orders
  WHERE creation_date IS NOT NULL
    AND order_payment_status = 'PAID'
    AND (cancel_status IS NULL OR cancel_status->>'cancelState' IS DISTINCT FROM 'CANCELED')
  GROUP BY user_id, creation_date::DATE
),

-- BrickLink + BrickOwl: single source of truth in platform_orders.
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

ALTER VIEW public.daily_platform_activity SET (security_invoker = true);
ALTER VIEW public.monthly_platform_summary SET (security_invoker = true);

COMMENT ON VIEW daily_platform_activity IS 'Daily aggregated listing and sales activity per platform. Listings from inventory_items (Amazon/eBay, excluding is_refresh=true) and bricklink_uploads (BrickLink). Sales: paid+ for all platforms — Amazon counts Paid/Shipped/Completed via platform_orders; eBay counts payment_status=PAID minus cancellations from ebay_orders; BrickLink + Brick Owl share the bricklink column and count any not-cancelled platform_orders row.';
COMMENT ON VIEW monthly_platform_summary IS 'Monthly aggregated listing and sales activity per platform';
