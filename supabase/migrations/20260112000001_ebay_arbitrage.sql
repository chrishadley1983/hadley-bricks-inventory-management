-- eBay Arbitrage Tracker tables and view updates
-- Migration: 20260112000001_ebay_arbitrage

-- ============================================================================
-- EBAY PRICING TABLE
-- Historical pricing snapshots from eBay Browse API
-- ============================================================================
CREATE TABLE ebay_pricing (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  set_number VARCHAR(20) NOT NULL,
  snapshot_date DATE NOT NULL,

  -- Filters (same pattern as bricklink_arbitrage_pricing)
  country_code VARCHAR(5) NOT NULL DEFAULT 'GB',
  condition VARCHAR(10) NOT NULL DEFAULT 'NEW',

  -- Calculated aggregates from filtered listings
  min_price DECIMAL(10,2),
  avg_price DECIMAL(10,2),
  max_price DECIMAL(10,2),
  total_listings INTEGER DEFAULT 0,

  -- Raw listing data for detail view (top 20 listings)
  listings_json JSONB,

  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,

  UNIQUE(set_number, snapshot_date, country_code, condition)
);

COMMENT ON TABLE ebay_pricing IS 'Daily pricing snapshots from eBay Browse API for arbitrage tracking';
COMMENT ON COLUMN ebay_pricing.listings_json IS 'Array of {itemId, title, price, currency, shipping, totalPrice, seller, sellerFeedback, url} for top 20 listings';
COMMENT ON COLUMN ebay_pricing.country_code IS 'GB for UK listings - uses ISO country code (not eBay marketplace ID)';

-- Indexes
CREATE INDEX idx_ebay_pricing_set_date ON ebay_pricing(set_number, snapshot_date DESC);

-- ============================================================================
-- UPDATE ARBITRAGE SYNC STATUS TABLE
-- Add ebay_pricing job type to the check constraint
-- ============================================================================
ALTER TABLE arbitrage_sync_status
  DROP CONSTRAINT arbitrage_sync_status_job_type_check;

ALTER TABLE arbitrage_sync_status
  ADD CONSTRAINT arbitrage_sync_status_job_type_check
  CHECK (job_type IN (
    'inventory_asins',
    'amazon_pricing',
    'bricklink_pricing',
    'asin_mapping',
    'ebay_pricing'
  ));

-- ============================================================================
-- UPDATE ARBITRAGE CURRENT VIEW
-- Add eBay pricing columns and margin calculation
-- Must DROP and recreate because column structure changed
-- ============================================================================
DROP VIEW IF EXISTS arbitrage_current_view;

CREATE VIEW arbitrage_current_view AS
SELECT
  t.asin,
  t.user_id,
  t.name,
  t.image_url,
  t.sku,
  t.quantity,
  t.source,
  t.status,
  m.bricklink_set_number,
  m.match_confidence,

  -- Amazon latest
  ap.your_price,
  t.quantity as your_qty,
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

  -- eBay latest (New, GB)
  ep.min_price as ebay_min_price,
  ep.avg_price as ebay_avg_price,
  ep.max_price as ebay_max_price,
  ep.total_listings as ebay_total_listings,
  ep.listings_json as ebay_listings,
  ep.snapshot_date as ebay_snapshot_date,

  -- BrickLink margin (using buy_box_price as fallback if your_price is null)
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

  -- eBay margin (using buy_box_price as fallback if your_price is null)
  CASE
    WHEN COALESCE(ap.your_price, ap.buy_box_price) > 0 AND ep.min_price > 0
    THEN ROUND(((COALESCE(ap.your_price, ap.buy_box_price) - ep.min_price) / COALESCE(ap.your_price, ap.buy_box_price)) * 100, 1)
    ELSE NULL
  END as ebay_margin_percent,

  CASE
    WHEN COALESCE(ap.your_price, ap.buy_box_price) > 0 AND ep.min_price > 0
    THEN ROUND(COALESCE(ap.your_price, ap.buy_box_price) - ep.min_price, 2)
    ELSE NULL
  END as ebay_margin_absolute,

  -- Amazon URL
  'https://www.amazon.co.uk/dp/' || t.asin as amazon_url

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
    AND condition = 'NEW'
    AND country_code = 'GB'
  ORDER BY snapshot_date DESC
  LIMIT 1
) ep ON true
WHERE t.status = 'active';

COMMENT ON VIEW arbitrage_current_view IS 'Denormalized view combining tracked ASINs with latest pricing from Amazon, BrickLink, and eBay';

-- ============================================================================
-- ROW LEVEL SECURITY FOR EBAY_PRICING
-- Note: ebay_pricing is not user-scoped (shared data), but we add policies for consistency
-- ============================================================================
ALTER TABLE ebay_pricing ENABLE ROW LEVEL SECURITY;

-- Anyone authenticated can read ebay pricing (shared data)
CREATE POLICY "Authenticated users can view eBay pricing"
  ON ebay_pricing FOR SELECT
  TO authenticated
  USING (true);

-- Service role can manage all records (for sync jobs)
CREATE POLICY "Service role can manage eBay pricing"
  ON ebay_pricing FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);
