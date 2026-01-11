-- Fix BrickLink country code in arbitrage view
-- BrickLink uses ISO 3166-1 alpha-2 codes - "GB" for United Kingdom, not "UK"

-- First, update existing data to use 'GB' instead of 'UK'
UPDATE bricklink_arbitrage_pricing
SET country_code = 'GB'
WHERE country_code = 'UK';

-- Update the default value for the column
ALTER TABLE bricklink_arbitrage_pricing
ALTER COLUMN country_code SET DEFAULT 'GB';

-- Drop and recreate the view with correct country code
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
  ap.your_qty,
  ap.buy_box_price,
  ap.buy_box_is_yours,
  ap.offer_count,
  ap.was_price_90d,
  ap.sales_rank,
  ap.sales_rank_category,
  ap.snapshot_date as amazon_snapshot_date,

  -- BrickLink latest (New, GB)
  bp.min_price as bl_min_price,
  bp.avg_price as bl_avg_price,
  bp.max_price as bl_max_price,
  bp.total_lots as bl_total_lots,
  bp.total_qty as bl_total_qty,
  bp.price_detail_json as bl_price_detail,
  bp.snapshot_date as bl_snapshot_date,

  -- Calculated margin
  CASE
    WHEN ap.your_price > 0 AND bp.min_price > 0
    THEN ROUND(((ap.your_price - bp.min_price) / ap.your_price) * 100, 1)
    ELSE NULL
  END as margin_percent,

  CASE
    WHEN ap.your_price > 0 AND bp.min_price > 0
    THEN ROUND(ap.your_price - bp.min_price, 2)
    ELSE NULL
  END as margin_absolute

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
    AND country_code = 'GB'  -- ISO 3166-1 alpha-2 for United Kingdom
  ORDER BY snapshot_date DESC
  LIMIT 1
) bp ON true
WHERE t.status = 'active';

COMMENT ON VIEW arbitrage_current_view IS 'Denormalized view combining tracked ASINs with latest pricing from Amazon and BrickLink (GB sellers)';
