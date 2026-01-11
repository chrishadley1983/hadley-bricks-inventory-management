-- Fix tracked_asins table to support per-user tracking
-- Migration: 20260111210001_fix_tracked_asins_constraint

-- The original schema had asin as PRIMARY KEY, but we need (user_id, asin)
-- to be unique so different users can track the same ASIN

-- Step 1: Drop dependent foreign keys and constraints
ALTER TABLE amazon_arbitrage_pricing DROP CONSTRAINT IF EXISTS amazon_arbitrage_pricing_asin_fkey;
ALTER TABLE asin_bricklink_mapping DROP CONSTRAINT IF EXISTS asin_bricklink_mapping_asin_fkey;
ALTER TABLE asin_bricklink_mapping DROP CONSTRAINT IF EXISTS asin_bricklink_mapping_pkey;

-- Step 2: Drop primary key from tracked_asins and add new structure
ALTER TABLE tracked_asins DROP CONSTRAINT IF EXISTS tracked_asins_pkey;

-- Step 3: Add id column and make it primary key
ALTER TABLE tracked_asins ADD COLUMN IF NOT EXISTS id UUID DEFAULT gen_random_uuid();
ALTER TABLE tracked_asins ADD PRIMARY KEY (id);

-- Step 4: Add unique constraint on (user_id, asin)
ALTER TABLE tracked_asins ADD CONSTRAINT tracked_asins_user_asin_unique UNIQUE (user_id, asin);

-- Step 5: Update asin_bricklink_mapping to use composite key
ALTER TABLE asin_bricklink_mapping ADD PRIMARY KEY (user_id, asin);

-- Step 6: Re-add foreign key references (now referencing the unique constraint)
-- Note: We don't need explicit FK from amazon_arbitrage_pricing since it has user_id + asin
-- and we can reference the unique constraint implicitly through the application logic

-- Step 7: Drop and recreate the view with updated logic
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

  -- BrickLink latest (New, UK)
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
    AND country_code = 'UK'
  ORDER BY snapshot_date DESC
  LIMIT 1
) bp ON true
WHERE t.status = 'active';

COMMENT ON VIEW arbitrage_current_view IS 'Denormalized view combining tracked ASINs with latest pricing from Amazon and BrickLink';
