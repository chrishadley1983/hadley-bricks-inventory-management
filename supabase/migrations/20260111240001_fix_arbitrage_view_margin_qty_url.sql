-- Fix arbitrage view: margin calculation, quantity source, and amazon URL
--
-- Issues fixed:
-- 1. Margin calculation: Use buy_box_price as fallback when your_price not available
-- 2. Quantity: Use tracked_asins.quantity instead of amazon_arbitrage_pricing.your_qty
-- 3. Amazon URL: Add computed amazon_url column

DROP VIEW IF EXISTS arbitrage_current_view;

CREATE OR REPLACE VIEW arbitrage_current_view AS
SELECT
  t.id,
  t.asin,
  t.user_id,
  t.name,
  t.image_url,
  t.sku,
  t.source,
  t.status,
  m.bricklink_set_number,
  m.match_confidence,

  -- Amazon latest
  ap.your_price,
  t.quantity as your_qty,  -- Use tracked_asins.quantity, not amazon_arbitrage_pricing.your_qty
  ap.buy_box_price,
  ap.buy_box_is_yours,
  ap.offer_count,
  ap.was_price_90d,
  ap.sales_rank,
  ap.sales_rank_category,
  ap.snapshot_date as amazon_snapshot_date,

  -- BrickLink latest (New, UK)
  bp.min_price as bl_min_price,
  bp.avg_price as bl_avg_price,
  bp.max_price as bl_max_price,
  bp.total_lots as bl_total_lots,
  bp.total_qty as bl_total_qty,
  bp.price_detail_json as bl_price_detail,
  bp.snapshot_date as bl_snapshot_date,

  -- Calculated margin: use your_price if available, otherwise buy_box_price
  CASE
    WHEN COALESCE(ap.your_price, ap.buy_box_price) > 0 AND bp.min_price > 0
    THEN ROUND(((COALESCE(ap.your_price, ap.buy_box_price) - bp.min_price) / COALESCE(ap.your_price, ap.buy_box_price)) * 100, 1)
    ELSE NULL
  END as margin_percent,

  CASE
    WHEN COALESCE(ap.your_price, ap.buy_box_price) > 0 AND bp.min_price > 0
    THEN ROUND(COALESCE(ap.your_price, ap.buy_box_price) - bp.min_price, 2)
    ELSE NULL
  END as margin_absolute,

  -- Amazon URL
  'https://www.amazon.co.uk/dp/' || t.asin as amazon_url

FROM tracked_asins t
LEFT JOIN asin_bricklink_mapping m ON t.asin = m.asin AND t.user_id = m.user_id
LEFT JOIN LATERAL (
  SELECT * FROM amazon_arbitrage_pricing
  WHERE asin = t.asin AND user_id = t.user_id
  ORDER BY snapshot_date DESC
  LIMIT 1
) ap ON true
LEFT JOIN LATERAL (
  SELECT * FROM bricklink_arbitrage_pricing
  WHERE bricklink_set_number = m.bricklink_set_number
    AND user_id = t.user_id
    AND condition = 'N'
    AND country_code = 'UK'  -- BrickLink uses "UK" not ISO "GB"
  ORDER BY snapshot_date DESC
  LIMIT 1
) bp ON true
WHERE t.status = 'active';

COMMENT ON VIEW arbitrage_current_view IS 'Denormalized view combining tracked ASINs with latest pricing from Amazon and BrickLink (UK sellers). Uses buy_box_price as fallback for margin calculation when your_price not available.';
