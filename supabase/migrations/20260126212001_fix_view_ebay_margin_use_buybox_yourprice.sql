-- Fix: Update arbitrage_current_view to use COALESCE(buy_box_price, your_price) for eBay margin calculations
-- Previously it used effective_amazon_price which falls back to lowest_offer_price
-- User wants buy_box_price first, then your_price (their listing price)

DROP VIEW IF EXISTS arbitrage_current_view;

CREATE OR REPLACE VIEW arbitrage_current_view AS
SELECT
  t.asin,
  t.user_id,
  t.name,
  t.image_url,
  t.sku,
  t.source,
  t.status,
  m.bricklink_set_number,
  m.match_confidence,

  -- Amazon latest: use tracked_asins.price as fallback for your_price
  COALESCE(ap.your_price, t.price) as your_price,
  COALESCE(ap.your_qty, t.quantity, 0) as your_qty,
  ap.buy_box_price,
  ap.buy_box_is_yours,
  ap.offer_count,
  ap.was_price_90d,
  ap.sales_rank,
  ap.sales_rank_category,
  ap.snapshot_date as amazon_snapshot_date,

  -- New: Lowest offer data
  ap.lowest_offer_price,
  ap.price_is_lowest_offer,
  ap.lowest_offer_seller_id,
  ap.lowest_offer_is_fba,
  ap.lowest_offer_is_prime,
  ap.offers_json,
  ap.total_offer_count,
  ap.competitive_price,

  -- Effective Amazon price: buy_box_price if available, else lowest_offer_price
  COALESCE(ap.buy_box_price, ap.lowest_offer_price) as effective_amazon_price,

  -- BrickLink latest (New, UK)
  bp.min_price as bl_min_price,
  bp.avg_price as bl_avg_price,
  bp.max_price as bl_max_price,
  bp.total_lots as bl_total_lots,
  bp.total_qty as bl_total_qty,
  bp.price_detail_json as bl_price_detail,
  bp.snapshot_date as bl_snapshot_date,

  -- eBay latest (New, GB)
  ep.min_price as ebay_min_price,
  ep.avg_price as ebay_avg_price,
  ep.max_price as ebay_max_price,
  ep.total_listings as ebay_total_listings,
  ep.listings_json as ebay_listings,
  ep.snapshot_date as ebay_snapshot_date,

  -- Calculated margin using effective Amazon price (BrickLink)
  CASE
    WHEN COALESCE(ap.buy_box_price, ap.lowest_offer_price) > 0 AND bp.min_price > 0
    THEN ROUND(((COALESCE(ap.buy_box_price, ap.lowest_offer_price) - bp.min_price) / COALESCE(ap.buy_box_price, ap.lowest_offer_price)) * 100, 1)
    ELSE NULL
  END as margin_percent,

  CASE
    WHEN COALESCE(ap.buy_box_price, ap.lowest_offer_price) > 0 AND bp.min_price > 0
    THEN ROUND(COALESCE(ap.buy_box_price, ap.lowest_offer_price) - bp.min_price, 2)
    ELSE NULL
  END as margin_absolute,

  -- Calculated margin using BUY_BOX_PRICE first, then YOUR_PRICE (eBay)
  -- Changed from effective_amazon_price to COALESCE(buy_box_price, your_price)
  CASE
    WHEN COALESCE(ap.buy_box_price, COALESCE(ap.your_price, t.price)) > 0 AND ep.min_price > 0
    THEN ROUND(((COALESCE(ap.buy_box_price, COALESCE(ap.your_price, t.price)) - ep.min_price) / COALESCE(ap.buy_box_price, COALESCE(ap.your_price, t.price))) * 100, 1)
    ELSE NULL
  END as ebay_margin_percent,

  CASE
    WHEN COALESCE(ap.buy_box_price, COALESCE(ap.your_price, t.price)) > 0 AND ep.min_price > 0
    THEN ROUND(COALESCE(ap.buy_box_price, COALESCE(ap.your_price, t.price)) - ep.min_price, 2)
    ELSE NULL
  END as ebay_margin_absolute,

  -- Amazon URL
  CONCAT('https://www.amazon.co.uk/dp/', t.asin) as amazon_url

FROM tracked_asins t
LEFT JOIN asin_bricklink_mapping m ON t.asin = m.asin
LEFT JOIN LATERAL (
  SELECT * FROM amazon_arbitrage_pricing
  WHERE asin = t.asin
  ORDER BY snapshot_date DESC
  LIMIT 1
) ap ON true
LEFT JOIN LATERAL (
  SELECT * FROM bricklink_arbitrage_pricing
  WHERE bricklink_set_number = m.bricklink_set_number
    AND user_id = t.user_id
    AND condition = 'N'
    AND country_code = 'UK'
  ORDER BY snapshot_date DESC
  LIMIT 1
) bp ON true
LEFT JOIN LATERAL (
  SELECT * FROM ebay_pricing
  WHERE set_number = m.bricklink_set_number
    AND UPPER(condition) = 'NEW'
    AND country_code = 'GB'
  ORDER BY snapshot_date DESC
  LIMIT 1
) ep ON true
WHERE t.status = 'active';

COMMENT ON VIEW arbitrage_current_view IS 'Denormalized view combining tracked ASINs with latest pricing. eBay margin uses COALESCE(buy_box_price, your_price) for sell price.';
