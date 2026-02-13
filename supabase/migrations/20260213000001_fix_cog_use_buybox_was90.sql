-- Fix COG% formula: use COALESCE(buy_box_price, was_price_90d) everywhere
-- Migration: 20260213000001_fix_cog_use_buybox_was90
--
-- Previously:
--   effective_amazon_price used COALESCE(buy_box, lowest_offer)
--   ebay_cog_percent used COALESCE(buy_box, your_price)
--   cog_percent used COALESCE(buy_box, lowest_offer)
--
-- Now all unified to COALESCE(buy_box_price, was_price_90d) — the 90-day
-- reference price is a better fallback than your own listing price or lowest offer.

DROP VIEW IF EXISTS arbitrage_current_view;

CREATE OR REPLACE VIEW arbitrage_current_view AS

-- ============================================================================
-- PART A: Tracked ASINs (existing inventory items)
-- ============================================================================
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

  -- Min BL Price Override
  m.min_bl_price_override,

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

  -- Lowest offer data
  ap.lowest_offer_price,
  ap.price_is_lowest_offer,
  ap.lowest_offer_seller_id,
  ap.lowest_offer_is_fba,
  ap.lowest_offer_is_prime,
  ap.offers_json,
  ap.total_offer_count,
  ap.competitive_price,

  -- Effective Amazon price: buy_box_price if available, else was_price_90d
  COALESCE(ap.buy_box_price, ap.was_price_90d) as effective_amazon_price,

  -- BrickLink latest (New, UK)
  bp.min_price as bl_min_price,
  bp.avg_price as bl_avg_price,
  bp.max_price as bl_max_price,
  bp.total_lots as bl_total_lots,
  bp.total_qty as bl_total_qty,
  bp.price_detail_json as bl_price_detail,
  bp.snapshot_date as bl_snapshot_date,

  -- Effective BL price: MAX(actual bl_min, override) when override is set
  GREATEST(COALESCE(bp.min_price, 0), COALESCE(m.min_bl_price_override, 0)) as effective_bl_price,

  -- eBay latest (New, GB)
  ep.min_price as ebay_min_price,
  ep.avg_price as ebay_avg_price,
  ep.max_price as ebay_max_price,
  ep.total_listings as ebay_total_listings,
  ep.listings_json as ebay_listings,
  ep.snapshot_date as ebay_snapshot_date,

  -- COG % calculation (BrickLink) - uses effective BL price with override
  CASE
    WHEN COALESCE(ap.buy_box_price, ap.was_price_90d) > 0
         AND GREATEST(COALESCE(bp.min_price, 0), COALESCE(m.min_bl_price_override, 0)) > 0
    THEN ROUND(
      (GREATEST(COALESCE(bp.min_price, 0), COALESCE(m.min_bl_price_override, 0)) / COALESCE(ap.buy_box_price, ap.was_price_90d)) * 100,
      1
    )
    ELSE NULL
  END as cog_percent,

  -- Legacy margin_percent
  CASE
    WHEN COALESCE(ap.buy_box_price, ap.was_price_90d) > 0 AND bp.min_price > 0
    THEN ROUND(((COALESCE(ap.buy_box_price, ap.was_price_90d) - bp.min_price) / COALESCE(ap.buy_box_price, ap.was_price_90d)) * 100, 1)
    ELSE NULL
  END as margin_percent,

  CASE
    WHEN COALESCE(ap.buy_box_price, ap.was_price_90d) > 0 AND bp.min_price > 0
    THEN ROUND(COALESCE(ap.buy_box_price, ap.was_price_90d) - bp.min_price, 2)
    ELSE NULL
  END as margin_absolute,

  -- eBay COG %
  CASE
    WHEN COALESCE(ap.buy_box_price, ap.was_price_90d) > 0 AND ep.min_price > 0
    THEN ROUND(
      (ep.min_price / COALESCE(ap.buy_box_price, ap.was_price_90d)) * 100,
      1
    )
    ELSE NULL
  END as ebay_cog_percent,

  -- eBay margin
  CASE
    WHEN COALESCE(ap.buy_box_price, ap.was_price_90d) > 0 AND ep.min_price > 0
    THEN ROUND(((COALESCE(ap.buy_box_price, ap.was_price_90d) - ep.min_price) / COALESCE(ap.buy_box_price, ap.was_price_90d)) * 100, 1)
    ELSE NULL
  END as ebay_margin_percent,

  CASE
    WHEN COALESCE(ap.buy_box_price, ap.was_price_90d) > 0 AND ep.min_price > 0
    THEN ROUND(COALESCE(ap.buy_box_price, ap.was_price_90d) - ep.min_price, 2)
    ELSE NULL
  END as ebay_margin_absolute,

  -- Amazon URL
  CONCAT('https://www.amazon.co.uk/dp/', t.asin) as amazon_url,

  -- Item type discriminator
  'inventory'::text as item_type,

  -- Seeded-specific columns (NULL for tracked items)
  NULL::uuid as seeded_asin_id,
  NULL::uuid as brickset_set_id,
  NULL::decimal(10,2) as brickset_rrp,
  NULL::integer as brickset_year,
  NULL::text as brickset_theme,
  NULL::integer as brickset_pieces,
  NULL::text as seeded_match_method,
  NULL::integer as seeded_match_confidence

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
WHERE t.status = 'active'

UNION ALL

-- ============================================================================
-- PART B: Seeded ASINs (discovered from Brickset, not in tracked_asins)
-- ============================================================================
SELECT
  sa.asin,
  tu.user_id,
  COALESCE(sa.amazon_title, bs.set_name) as name,
  COALESCE(sa.amazon_image_url, bs.image_url) as image_url,
  NULL::varchar as sku,
  'seeded'::text as source,
  'active'::text as status,
  bs.set_number as bricklink_set_number,
  CASE sa.match_method
    WHEN 'ean' THEN 'exact'::varchar
    WHEN 'title_exact' THEN 'probable'::varchar
    ELSE 'manual'::varchar
  END as match_confidence,

  -- No BL price override for seeded
  NULL::decimal(10,2) as min_bl_price_override,

  -- Amazon latest: use seeded amazon_price as fallback
  COALESCE(ap.your_price, sa.amazon_price) as your_price,
  COALESCE(ap.your_qty, 0) as your_qty,
  ap.buy_box_price,
  ap.buy_box_is_yours,
  ap.offer_count,
  ap.was_price_90d,
  ap.sales_rank,
  ap.sales_rank_category,
  ap.snapshot_date as amazon_snapshot_date,

  -- Lowest offer data
  ap.lowest_offer_price,
  ap.price_is_lowest_offer,
  ap.lowest_offer_seller_id,
  ap.lowest_offer_is_fba,
  ap.lowest_offer_is_prime,
  ap.offers_json,
  ap.total_offer_count,
  ap.competitive_price,

  -- Effective Amazon price
  COALESCE(ap.buy_box_price, ap.was_price_90d) as effective_amazon_price,

  -- BrickLink latest (New, UK) - uses brickset set_number directly
  bp.min_price as bl_min_price,
  bp.avg_price as bl_avg_price,
  bp.max_price as bl_max_price,
  bp.total_lots as bl_total_lots,
  bp.total_qty as bl_total_qty,
  bp.price_detail_json as bl_price_detail,
  bp.snapshot_date as bl_snapshot_date,

  -- Effective BL price (no override for seeded)
  COALESCE(bp.min_price, 0)::numeric as effective_bl_price,

  -- eBay latest (New, GB)
  ep.min_price as ebay_min_price,
  ep.avg_price as ebay_avg_price,
  ep.max_price as ebay_max_price,
  ep.total_listings as ebay_total_listings,
  ep.listings_json as ebay_listings,
  ep.snapshot_date as ebay_snapshot_date,

  -- COG % (BrickLink) - no override for seeded
  CASE
    WHEN COALESCE(ap.buy_box_price, ap.was_price_90d) > 0
         AND bp.min_price > 0
    THEN ROUND(
      (bp.min_price / COALESCE(ap.buy_box_price, ap.was_price_90d)) * 100,
      1
    )
    ELSE NULL
  END as cog_percent,

  -- Margin percent
  CASE
    WHEN COALESCE(ap.buy_box_price, ap.was_price_90d) > 0 AND bp.min_price > 0
    THEN ROUND(((COALESCE(ap.buy_box_price, ap.was_price_90d) - bp.min_price) / COALESCE(ap.buy_box_price, ap.was_price_90d)) * 100, 1)
    ELSE NULL
  END as margin_percent,

  CASE
    WHEN COALESCE(ap.buy_box_price, ap.was_price_90d) > 0 AND bp.min_price > 0
    THEN ROUND(COALESCE(ap.buy_box_price, ap.was_price_90d) - bp.min_price, 2)
    ELSE NULL
  END as margin_absolute,

  -- eBay COG %
  CASE
    WHEN COALESCE(ap.buy_box_price, ap.was_price_90d) > 0 AND ep.min_price > 0
    THEN ROUND(
      (ep.min_price / COALESCE(ap.buy_box_price, ap.was_price_90d)) * 100,
      1
    )
    ELSE NULL
  END as ebay_cog_percent,

  -- eBay margin
  CASE
    WHEN COALESCE(ap.buy_box_price, ap.was_price_90d) > 0 AND ep.min_price > 0
    THEN ROUND(((COALESCE(ap.buy_box_price, ap.was_price_90d) - ep.min_price) / COALESCE(ap.buy_box_price, ap.was_price_90d)) * 100, 1)
    ELSE NULL
  END as ebay_margin_percent,

  CASE
    WHEN COALESCE(ap.buy_box_price, ap.was_price_90d) > 0 AND ep.min_price > 0
    THEN ROUND(COALESCE(ap.buy_box_price, ap.was_price_90d) - ep.min_price, 2)
    ELSE NULL
  END as ebay_margin_absolute,

  -- Amazon URL
  CONCAT('https://www.amazon.co.uk/dp/', sa.asin) as amazon_url,

  -- Item type discriminator
  'seeded'::text as item_type,

  -- Seeded-specific columns
  sa.id as seeded_asin_id,
  sa.brickset_set_id,
  bs.uk_retail_price as brickset_rrp,
  bs.year_from as brickset_year,
  bs.theme as brickset_theme,
  bs.pieces as brickset_pieces,
  sa.match_method::text as seeded_match_method,
  sa.match_confidence as seeded_match_confidence

FROM seeded_asins sa
CROSS JOIN (SELECT DISTINCT user_id FROM tracked_asins LIMIT 1) tu
JOIN brickset_sets bs ON sa.brickset_set_id = bs.id
LEFT JOIN user_seeded_asin_preferences usp
  ON usp.seeded_asin_id = sa.id AND usp.user_id = tu.user_id
LEFT JOIN LATERAL (
  SELECT * FROM amazon_arbitrage_pricing
  WHERE asin = sa.asin
  ORDER BY snapshot_date DESC
  LIMIT 1
) ap ON true
LEFT JOIN LATERAL (
  SELECT * FROM bricklink_arbitrage_pricing
  WHERE bricklink_set_number = bs.set_number
    AND user_id = tu.user_id
    AND condition = 'N'
    AND country_code = 'UK'
  ORDER BY snapshot_date DESC
  LIMIT 1
) bp ON true
LEFT JOIN LATERAL (
  SELECT * FROM ebay_pricing
  WHERE set_number = bs.set_number
    AND UPPER(condition) = 'NEW'
    AND country_code = 'GB'
  ORDER BY snapshot_date DESC
  LIMIT 1
) ep ON true
WHERE sa.discovery_status = 'found'
  AND sa.asin IS NOT NULL
  AND sa.asin NOT IN (SELECT asin FROM tracked_asins WHERE status = 'active' AND user_id = tu.user_id)
  AND (usp.user_status IS NULL OR usp.user_status != 'excluded');

COMMENT ON VIEW arbitrage_current_view IS 'Denormalized view combining tracked ASINs AND seeded ASINs with latest pricing. Uses COALESCE(buy_box_price, was_price_90d) for all COG% calculations.';

-- ============================================================================
-- UPDATE RPC FUNCTIONS — adjusted_cog_percent also uses was_price_90d
-- ============================================================================

DROP FUNCTION IF EXISTS get_arbitrage_with_adjusted_ebay(UUID, TEXT, NUMERIC, NUMERIC, TEXT, TEXT, TEXT, INTEGER, INTEGER);
DROP FUNCTION IF EXISTS get_arbitrage_adjusted_count(UUID, TEXT, NUMERIC, NUMERIC, TEXT);

CREATE OR REPLACE FUNCTION get_arbitrage_with_adjusted_ebay(
  p_user_id UUID,
  p_show TEXT DEFAULT 'all',
  p_max_cog NUMERIC DEFAULT 50,
  p_min_margin NUMERIC DEFAULT 30,
  p_search TEXT DEFAULT NULL,
  p_sort_field TEXT DEFAULT 'ebay_margin',
  p_sort_direction TEXT DEFAULT 'asc',
  p_page_size INTEGER DEFAULT 50,
  p_offset INTEGER DEFAULT 0
)
RETURNS TABLE (
  asin TEXT,
  user_id UUID,
  name TEXT,
  image_url TEXT,
  sku TEXT,
  source TEXT,
  status TEXT,
  bricklink_set_number TEXT,
  match_confidence TEXT,
  your_price NUMERIC,
  your_qty INTEGER,
  buy_box_price NUMERIC,
  buy_box_is_yours BOOLEAN,
  offer_count INTEGER,
  was_price_90d NUMERIC,
  sales_rank INTEGER,
  sales_rank_category TEXT,
  amazon_snapshot_date DATE,
  lowest_offer_price NUMERIC,
  price_is_lowest_offer BOOLEAN,
  lowest_offer_seller_id TEXT,
  lowest_offer_is_fba BOOLEAN,
  lowest_offer_is_prime BOOLEAN,
  offers_json JSONB,
  total_offer_count INTEGER,
  competitive_price NUMERIC,
  effective_amazon_price NUMERIC,
  bl_min_price NUMERIC,
  bl_avg_price NUMERIC,
  bl_max_price NUMERIC,
  bl_total_lots INTEGER,
  bl_total_qty INTEGER,
  bl_price_detail JSONB,
  bl_snapshot_date DATE,
  ebay_min_price NUMERIC,
  ebay_avg_price NUMERIC,
  ebay_max_price NUMERIC,
  ebay_total_listings INTEGER,
  ebay_listings JSONB,
  ebay_snapshot_date DATE,
  margin_percent NUMERIC,
  margin_absolute NUMERIC,
  ebay_margin_percent NUMERIC,
  ebay_margin_absolute NUMERIC,
  amazon_url TEXT,
  item_type TEXT,
  adjusted_ebay_min_price NUMERIC,
  adjusted_cog_percent NUMERIC
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
AS $$
DECLARE
  v_min_margin_from_cog NUMERIC;
BEGIN
  v_min_margin_from_cog := 100 - p_max_cog;

  RETURN QUERY
  WITH base_data AS (
    SELECT
      v.asin::TEXT,
      v.user_id,
      v.name::TEXT,
      v.image_url::TEXT,
      v.sku::TEXT,
      v.source::TEXT,
      v.status::TEXT,
      v.bricklink_set_number::TEXT,
      v.match_confidence::TEXT,
      v.your_price,
      v.your_qty::INTEGER,
      v.buy_box_price,
      v.buy_box_is_yours,
      v.offer_count,
      v.was_price_90d,
      v.sales_rank,
      v.sales_rank_category::TEXT,
      v.amazon_snapshot_date,
      v.lowest_offer_price,
      v.price_is_lowest_offer,
      v.lowest_offer_seller_id::TEXT,
      v.lowest_offer_is_fba,
      v.lowest_offer_is_prime,
      v.offers_json,
      v.total_offer_count,
      v.competitive_price,
      v.effective_amazon_price,
      v.bl_min_price,
      v.bl_avg_price,
      v.bl_max_price,
      v.bl_total_lots,
      v.bl_total_qty,
      v.bl_price_detail,
      v.bl_snapshot_date,
      v.ebay_min_price,
      v.ebay_avg_price,
      v.ebay_max_price,
      v.ebay_total_listings,
      v.ebay_listings,
      v.ebay_snapshot_date,
      v.margin_percent,
      v.margin_absolute,
      v.ebay_margin_percent,
      v.ebay_margin_absolute,
      v.amazon_url::TEXT,
      v.item_type::TEXT,
      -- Get adjusted eBay min price using our function
      COALESCE(adj.adjusted_min_price, v.ebay_min_price) as adjusted_ebay_min_price,
      -- Calculate adjusted COG% using buy_box → was_price_90d
      CASE
        WHEN COALESCE(v.buy_box_price, v.was_price_90d) > 0
          AND COALESCE(adj.adjusted_min_price, v.ebay_min_price) > 0
        THEN ROUND((COALESCE(adj.adjusted_min_price, v.ebay_min_price) / COALESCE(v.buy_box_price, v.was_price_90d)) * 100, 1)
        ELSE NULL
      END as adjusted_cog_percent
    FROM arbitrage_current_view v
    LEFT JOIN LATERAL get_adjusted_ebay_stats(v.bricklink_set_number, p_user_id) adj ON true
    WHERE v.user_id = p_user_id
      -- Apply show filter
      AND (
        CASE p_show
          WHEN 'opportunities' THEN v.margin_percent >= p_min_margin
          WHEN 'ebay_opportunities' THEN v.ebay_min_price IS NOT NULL
          WHEN 'with_ebay_data' THEN v.ebay_min_price IS NOT NULL
          WHEN 'no_ebay_data' THEN v.ebay_min_price IS NULL
          WHEN 'in_stock' THEN v.your_qty > 0
          WHEN 'zero_qty' THEN v.your_qty = 0
          WHEN 'pending_review' THEN v.status = 'pending_review'
          WHEN 'inventory' THEN v.item_type = 'inventory'
          WHEN 'seeded' THEN v.item_type = 'seeded'
          ELSE TRUE -- 'all'
        END
      )
      -- Apply search filter
      AND (
        p_search IS NULL
        OR v.name ILIKE '%' || p_search || '%'
        OR v.asin ILIKE '%' || p_search || '%'
        OR v.bricklink_set_number ILIKE '%' || p_search || '%'
      )
  )
  SELECT *
  FROM base_data bd
  WHERE (
    CASE WHEN p_show = 'ebay_opportunities'
      THEN bd.adjusted_cog_percent IS NOT NULL AND bd.adjusted_cog_percent <= p_max_cog
      ELSE TRUE
    END
  )
  ORDER BY
    CASE
      WHEN p_sort_field = 'ebay_margin' AND p_sort_direction = 'asc' THEN bd.adjusted_cog_percent
    END ASC NULLS LAST,
    CASE
      WHEN p_sort_field = 'ebay_margin' AND p_sort_direction = 'desc' THEN bd.adjusted_cog_percent
    END DESC NULLS LAST,
    CASE
      WHEN p_sort_field = 'ebay_price' AND p_sort_direction = 'asc' THEN bd.adjusted_ebay_min_price
    END ASC NULLS LAST,
    CASE
      WHEN p_sort_field = 'ebay_price' AND p_sort_direction = 'desc' THEN bd.adjusted_ebay_min_price
    END DESC NULLS LAST
  LIMIT p_page_size
  OFFSET p_offset;
END;
$$;

COMMENT ON FUNCTION get_arbitrage_with_adjusted_ebay IS 'Fetches arbitrage data with exclusion-adjusted eBay prices. Uses COALESCE(buy_box, was_price_90d) for COG%.';

-- Update count function
CREATE OR REPLACE FUNCTION get_arbitrage_adjusted_count(
  p_user_id UUID,
  p_show TEXT DEFAULT 'all',
  p_max_cog NUMERIC DEFAULT 50,
  p_min_margin NUMERIC DEFAULT 30,
  p_search TEXT DEFAULT NULL
)
RETURNS INTEGER
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
AS $$
DECLARE
  v_count INTEGER;
BEGIN
  WITH base_data AS (
    SELECT
      v.asin,
      CASE
        WHEN COALESCE(v.buy_box_price, v.was_price_90d) > 0
          AND COALESCE(adj.adjusted_min_price, v.ebay_min_price) > 0
        THEN ROUND((COALESCE(adj.adjusted_min_price, v.ebay_min_price) / COALESCE(v.buy_box_price, v.was_price_90d)) * 100, 1)
        ELSE NULL
      END as adjusted_cog_percent
    FROM arbitrage_current_view v
    LEFT JOIN LATERAL get_adjusted_ebay_stats(v.bricklink_set_number, p_user_id) adj ON true
    WHERE v.user_id = p_user_id
      AND (
        CASE p_show
          WHEN 'opportunities' THEN v.margin_percent >= p_min_margin
          WHEN 'ebay_opportunities' THEN v.ebay_min_price IS NOT NULL
          WHEN 'with_ebay_data' THEN v.ebay_min_price IS NOT NULL
          WHEN 'no_ebay_data' THEN v.ebay_min_price IS NULL
          WHEN 'in_stock' THEN v.your_qty > 0
          WHEN 'zero_qty' THEN v.your_qty = 0
          WHEN 'pending_review' THEN v.status = 'pending_review'
          WHEN 'inventory' THEN v.item_type = 'inventory'
          WHEN 'seeded' THEN v.item_type = 'seeded'
          ELSE TRUE
        END
      )
      AND (
        p_search IS NULL
        OR v.name ILIKE '%' || p_search || '%'
        OR v.asin ILIKE '%' || p_search || '%'
        OR v.bricklink_set_number ILIKE '%' || p_search || '%'
      )
  )
  SELECT COUNT(*) INTO v_count
  FROM base_data bd
  WHERE (
    CASE WHEN p_show = 'ebay_opportunities'
      THEN bd.adjusted_cog_percent IS NOT NULL AND bd.adjusted_cog_percent <= p_max_cog
      ELSE TRUE
    END
  );

  RETURN v_count;
END;
$$;

COMMENT ON FUNCTION get_arbitrage_adjusted_count IS 'Counts arbitrage items with exclusion-adjusted eBay filtering. Uses COALESCE(buy_box, was_price_90d) for COG%.';
