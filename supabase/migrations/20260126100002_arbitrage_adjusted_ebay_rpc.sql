-- Create RPC function for fetching arbitrage data with adjusted eBay sorting
-- This function handles the complex query with exclusion-adjusted eBay prices

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
  -- COG% = 100 - margin%, so maxCog filter uses: margin >= (100 - maxCog)
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
      -- Get adjusted eBay min price using our function
      COALESCE(adj.adjusted_min_price, v.ebay_min_price) as adjusted_ebay_min_price,
      -- Calculate adjusted COG%: (adjusted_min_price / sell_price) * 100
      CASE
        WHEN COALESCE(v.your_price, v.buy_box_price) > 0
          AND COALESCE(adj.adjusted_min_price, v.ebay_min_price) > 0
        THEN ROUND((COALESCE(adj.adjusted_min_price, v.ebay_min_price) / COALESCE(v.your_price, v.buy_box_price)) * 100, 1)
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
    -- For ebay_opportunities, filter by adjusted COG
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

COMMENT ON FUNCTION get_arbitrage_with_adjusted_ebay IS 'Fetches arbitrage data with exclusion-adjusted eBay prices for proper sorting';

-- Create a simpler count function
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
      -- Calculate adjusted COG%
      CASE
        WHEN COALESCE(v.your_price, v.buy_box_price) > 0
          AND COALESCE(adj.adjusted_min_price, v.ebay_min_price) > 0
        THEN ROUND((COALESCE(adj.adjusted_min_price, v.ebay_min_price) / COALESCE(v.your_price, v.buy_box_price)) * 100, 1)
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

COMMENT ON FUNCTION get_arbitrage_adjusted_count IS 'Counts arbitrage items with exclusion-adjusted eBay filtering';
