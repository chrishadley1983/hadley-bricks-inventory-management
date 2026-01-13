-- Add lowest offer data and offers JSON to amazon_arbitrage_pricing
-- Migration: 20260112100001_amazon_offers_data

-- ============================================================================
-- ADD NEW COLUMNS TO amazon_arbitrage_pricing
-- ============================================================================

-- Lowest offer price (fallback when no buy box)
ALTER TABLE amazon_arbitrage_pricing
ADD COLUMN IF NOT EXISTS lowest_offer_price DECIMAL(10,2);

-- Whether the displayed price is from lowest offer (vs buy box)
ALTER TABLE amazon_arbitrage_pricing
ADD COLUMN IF NOT EXISTS price_is_lowest_offer BOOLEAN DEFAULT FALSE;

-- Lowest offer seller info
ALTER TABLE amazon_arbitrage_pricing
ADD COLUMN IF NOT EXISTS lowest_offer_seller_id VARCHAR(50);

ALTER TABLE amazon_arbitrage_pricing
ADD COLUMN IF NOT EXISTS lowest_offer_is_fba BOOLEAN;

ALTER TABLE amazon_arbitrage_pricing
ADD COLUMN IF NOT EXISTS lowest_offer_is_prime BOOLEAN;

-- All offers as JSON (up to 20 offers from API)
ALTER TABLE amazon_arbitrage_pricing
ADD COLUMN IF NOT EXISTS offers_json JSONB;

-- Total number of offers available
ALTER TABLE amazon_arbitrage_pricing
ADD COLUMN IF NOT EXISTS total_offer_count INTEGER;

-- Competitive price from external retailers
ALTER TABLE amazon_arbitrage_pricing
ADD COLUMN IF NOT EXISTS competitive_price DECIMAL(10,2);

-- Add comments
COMMENT ON COLUMN amazon_arbitrage_pricing.lowest_offer_price IS 'Lowest offer total price (listing + shipping) when no buy box';
COMMENT ON COLUMN amazon_arbitrage_pricing.price_is_lowest_offer IS 'True if displayed price is from lowest offer (no buy box winner)';
COMMENT ON COLUMN amazon_arbitrage_pricing.lowest_offer_seller_id IS 'Seller ID of the lowest offer';
COMMENT ON COLUMN amazon_arbitrage_pricing.lowest_offer_is_fba IS 'Whether lowest offer is fulfilled by Amazon';
COMMENT ON COLUMN amazon_arbitrage_pricing.lowest_offer_is_prime IS 'Whether lowest offer has Prime shipping';
COMMENT ON COLUMN amazon_arbitrage_pricing.offers_json IS 'JSON array of all offers (up to 20) for the ASIN';
COMMENT ON COLUMN amazon_arbitrage_pricing.total_offer_count IS 'Total number of offers available for the ASIN';
COMMENT ON COLUMN amazon_arbitrage_pricing.competitive_price IS 'External competitive price from other retailers';

-- ============================================================================
-- UPDATE VIEW TO INCLUDE NEW COLUMNS AND FALLBACK LOGIC
-- ============================================================================

-- Drop and recreate view to add new columns
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

  -- Calculated margin using effective Amazon price (eBay)
  CASE
    WHEN COALESCE(ap.buy_box_price, ap.lowest_offer_price) > 0 AND ep.min_price > 0
    THEN ROUND(((COALESCE(ap.buy_box_price, ap.lowest_offer_price) - ep.min_price) / COALESCE(ap.buy_box_price, ap.lowest_offer_price)) * 100, 1)
    ELSE NULL
  END as ebay_margin_percent,

  CASE
    WHEN COALESCE(ap.buy_box_price, ap.lowest_offer_price) > 0 AND ep.min_price > 0
    THEN ROUND(COALESCE(ap.buy_box_price, ap.lowest_offer_price) - ep.min_price, 2)
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
    AND condition = 'New'
    AND country_code = 'GB'
  ORDER BY snapshot_date DESC
  LIMIT 1
) ep ON true
WHERE t.status = 'active';

COMMENT ON VIEW arbitrage_current_view IS 'Denormalized view combining tracked ASINs with latest pricing from Amazon, BrickLink, and eBay. Uses buy_box_price when available, falls back to lowest_offer_price.';
