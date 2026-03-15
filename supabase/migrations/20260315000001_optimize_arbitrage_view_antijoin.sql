-- Optimize arbitrage_current_view: replace NOT IN with LEFT JOIN anti-join
-- The NOT IN subquery was causing a correlated sequential scan of tracked_asins
-- for every seeded_asins row (7,386 loops × 2,240 rows = ~16.5M row reads, ~5s).
-- LEFT JOIN ... WHERE IS NULL uses a hash anti-join instead (~10ms).

-- RPC function to fetch all excluded eBay listing IDs in a single query
-- Replaces 12+ paginated requests for 11k+ rows
CREATE OR REPLACE FUNCTION get_excluded_ebay_listing_ids(p_user_id uuid)
RETURNS TABLE(ebay_item_id text, set_number text)
LANGUAGE sql STABLE
AS $$
  SELECT ebay_item_id, set_number
  FROM excluded_ebay_listings
  WHERE user_id = p_user_id;
$$;

CREATE OR REPLACE VIEW arbitrage_current_view AS
-- Inventory items (tracked ASINs)
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
    m.min_bl_price_override,
    COALESCE(ap.your_price, t.price) AS your_price,
    COALESCE(ap.your_qty, t.quantity, 0) AS your_qty,
    ap.buy_box_price,
    ap.buy_box_is_yours,
    ap.offer_count,
    ap.was_price_90d,
    ap.sales_rank,
    ap.sales_rank_category,
    ap.snapshot_date AS amazon_snapshot_date,
    ap.lowest_offer_price,
    ap.price_is_lowest_offer,
    ap.lowest_offer_seller_id,
    ap.lowest_offer_is_fba,
    ap.lowest_offer_is_prime,
    ap.offers_json,
    ap.total_offer_count,
    ap.competitive_price,
    COALESCE(ap.buy_box_price, ap.was_price_90d) AS effective_amazon_price,
    bp.min_price AS bl_min_price,
    bp.avg_price AS bl_avg_price,
    bp.max_price AS bl_max_price,
    bp.total_lots AS bl_total_lots,
    bp.total_qty AS bl_total_qty,
    bp.price_detail_json AS bl_price_detail,
    bp.snapshot_date AS bl_snapshot_date,
    GREATEST(COALESCE(bp.min_price, 0::numeric), COALESCE(m.min_bl_price_override, 0::numeric)) AS effective_bl_price,
    ep.min_price AS ebay_min_price,
    ep.avg_price AS ebay_avg_price,
    ep.max_price AS ebay_max_price,
    ep.total_listings AS ebay_total_listings,
    ep.listings_json AS ebay_listings,
    ep.snapshot_date AS ebay_snapshot_date,
    CASE
        WHEN COALESCE(ap.buy_box_price, ap.was_price_90d) > 0 AND GREATEST(COALESCE(bp.min_price, 0::numeric), COALESCE(m.min_bl_price_override, 0::numeric)) > 0
        THEN round(GREATEST(COALESCE(bp.min_price, 0::numeric), COALESCE(m.min_bl_price_override, 0::numeric)) / COALESCE(ap.buy_box_price, ap.was_price_90d) * 100, 1)
        ELSE NULL
    END AS cog_percent,
    CASE
        WHEN COALESCE(ap.buy_box_price, ap.was_price_90d) > 0 AND bp.min_price > 0
        THEN round((COALESCE(ap.buy_box_price, ap.was_price_90d) - bp.min_price) / COALESCE(ap.buy_box_price, ap.was_price_90d) * 100, 1)
        ELSE NULL
    END AS margin_percent,
    CASE
        WHEN COALESCE(ap.buy_box_price, ap.was_price_90d) > 0 AND bp.min_price > 0
        THEN round(COALESCE(ap.buy_box_price, ap.was_price_90d) - bp.min_price, 2)
        ELSE NULL
    END AS margin_absolute,
    CASE
        WHEN COALESCE(ap.buy_box_price, ap.was_price_90d) > 0 AND ep.min_price > 0
        THEN round(ep.min_price / COALESCE(ap.buy_box_price, ap.was_price_90d) * 100, 1)
        ELSE NULL
    END AS ebay_cog_percent,
    CASE
        WHEN COALESCE(ap.buy_box_price, ap.was_price_90d) > 0 AND ep.min_price > 0
        THEN round((COALESCE(ap.buy_box_price, ap.was_price_90d) - ep.min_price) / COALESCE(ap.buy_box_price, ap.was_price_90d) * 100, 1)
        ELSE NULL
    END AS ebay_margin_percent,
    CASE
        WHEN COALESCE(ap.buy_box_price, ap.was_price_90d) > 0 AND ep.min_price > 0
        THEN round(COALESCE(ap.buy_box_price, ap.was_price_90d) - ep.min_price, 2)
        ELSE NULL
    END AS ebay_margin_absolute,
    concat('https://www.amazon.co.uk/dp/', t.asin) AS amazon_url,
    'inventory'::text AS item_type,
    NULL::uuid AS seeded_asin_id,
    NULL::uuid AS brickset_set_id,
    NULL::numeric(10,2) AS brickset_rrp,
    NULL::integer AS brickset_year,
    NULL::text AS brickset_theme,
    NULL::integer AS brickset_pieces,
    NULL::text AS seeded_match_method,
    NULL::integer AS seeded_match_confidence
FROM tracked_asins t
LEFT JOIN asin_bricklink_mapping m ON t.asin = m.asin
LEFT JOIN LATERAL (
    SELECT * FROM amazon_arbitrage_pricing
    WHERE asin = t.asin
    ORDER BY snapshot_date DESC LIMIT 1
) ap ON true
LEFT JOIN LATERAL (
    SELECT * FROM bricklink_arbitrage_pricing
    WHERE bricklink_set_number = m.bricklink_set_number
      AND user_id = t.user_id
      AND condition = 'N' AND country_code = 'UK'
    ORDER BY snapshot_date DESC LIMIT 1
) bp ON true
LEFT JOIN LATERAL (
    SELECT * FROM ebay_pricing
    WHERE set_number = m.bricklink_set_number
      AND upper(condition) = 'NEW' AND country_code = 'GB'
    ORDER BY snapshot_date DESC LIMIT 1
) ep ON true
WHERE t.status = 'active'

UNION ALL

-- Seeded items (discovery ASINs not already tracked)
-- Uses LEFT JOIN anti-join instead of NOT IN for performance
SELECT
    sa.asin,
    tu.user_id,
    COALESCE(sa.amazon_title, bs.set_name::varchar) AS name,
    COALESCE(sa.amazon_image_url, bs.image_url::varchar) AS image_url,
    NULL::varchar AS sku,
    'seeded'::text AS source,
    'active'::text AS status,
    bs.set_number AS bricklink_set_number,
    CASE sa.match_method
        WHEN 'ean' THEN 'exact'::varchar
        WHEN 'title_exact' THEN 'probable'::varchar
        ELSE 'manual'::varchar
    END AS match_confidence,
    NULL::numeric(10,2) AS min_bl_price_override,
    COALESCE(ap.your_price, sa.amazon_price) AS your_price,
    COALESCE(ap.your_qty, 0) AS your_qty,
    ap.buy_box_price,
    ap.buy_box_is_yours,
    ap.offer_count,
    ap.was_price_90d,
    ap.sales_rank,
    ap.sales_rank_category,
    ap.snapshot_date AS amazon_snapshot_date,
    ap.lowest_offer_price,
    ap.price_is_lowest_offer,
    ap.lowest_offer_seller_id,
    ap.lowest_offer_is_fba,
    ap.lowest_offer_is_prime,
    ap.offers_json,
    ap.total_offer_count,
    ap.competitive_price,
    COALESCE(ap.buy_box_price, ap.was_price_90d) AS effective_amazon_price,
    bp.min_price AS bl_min_price,
    bp.avg_price AS bl_avg_price,
    bp.max_price AS bl_max_price,
    bp.total_lots AS bl_total_lots,
    bp.total_qty AS bl_total_qty,
    bp.price_detail_json AS bl_price_detail,
    bp.snapshot_date AS bl_snapshot_date,
    COALESCE(bp.min_price, 0::numeric) AS effective_bl_price,
    ep.min_price AS ebay_min_price,
    ep.avg_price AS ebay_avg_price,
    ep.max_price AS ebay_max_price,
    ep.total_listings AS ebay_total_listings,
    ep.listings_json AS ebay_listings,
    ep.snapshot_date AS ebay_snapshot_date,
    CASE
        WHEN COALESCE(ap.buy_box_price, ap.was_price_90d) > 0 AND bp.min_price > 0
        THEN round(bp.min_price / COALESCE(ap.buy_box_price, ap.was_price_90d) * 100, 1)
        ELSE NULL
    END AS cog_percent,
    CASE
        WHEN COALESCE(ap.buy_box_price, ap.was_price_90d) > 0 AND bp.min_price > 0
        THEN round((COALESCE(ap.buy_box_price, ap.was_price_90d) - bp.min_price) / COALESCE(ap.buy_box_price, ap.was_price_90d) * 100, 1)
        ELSE NULL
    END AS margin_percent,
    CASE
        WHEN COALESCE(ap.buy_box_price, ap.was_price_90d) > 0 AND bp.min_price > 0
        THEN round(COALESCE(ap.buy_box_price, ap.was_price_90d) - bp.min_price, 2)
        ELSE NULL
    END AS margin_absolute,
    CASE
        WHEN COALESCE(ap.buy_box_price, ap.was_price_90d) > 0 AND ep.min_price > 0
        THEN round(ep.min_price / COALESCE(ap.buy_box_price, ap.was_price_90d) * 100, 1)
        ELSE NULL
    END AS ebay_cog_percent,
    CASE
        WHEN COALESCE(ap.buy_box_price, ap.was_price_90d) > 0 AND ep.min_price > 0
        THEN round((COALESCE(ap.buy_box_price, ap.was_price_90d) - ep.min_price) / COALESCE(ap.buy_box_price, ap.was_price_90d) * 100, 1)
        ELSE NULL
    END AS ebay_margin_percent,
    CASE
        WHEN COALESCE(ap.buy_box_price, ap.was_price_90d) > 0 AND ep.min_price > 0
        THEN round(COALESCE(ap.buy_box_price, ap.was_price_90d) - ep.min_price, 2)
        ELSE NULL
    END AS ebay_margin_absolute,
    concat('https://www.amazon.co.uk/dp/', sa.asin) AS amazon_url,
    'seeded'::text AS item_type,
    sa.id AS seeded_asin_id,
    sa.brickset_set_id,
    bs.uk_retail_price AS brickset_rrp,
    bs.year_from AS brickset_year,
    bs.theme AS brickset_theme,
    bs.pieces AS brickset_pieces,
    sa.match_method::text AS seeded_match_method,
    sa.match_confidence AS seeded_match_confidence
FROM seeded_asins sa
CROSS JOIN (SELECT DISTINCT user_id FROM tracked_asins LIMIT 1) tu
JOIN brickset_sets bs ON sa.brickset_set_id = bs.id
-- Anti-join: exclude seeded ASINs that are already tracked (replaces NOT IN)
LEFT JOIN tracked_asins ta_excl
    ON ta_excl.asin = sa.asin
    AND ta_excl.status = 'active'
    AND ta_excl.user_id = tu.user_id
LEFT JOIN user_seeded_asin_preferences usp
    ON usp.seeded_asin_id = sa.id AND usp.user_id = tu.user_id
LEFT JOIN LATERAL (
    SELECT * FROM amazon_arbitrage_pricing
    WHERE asin = sa.asin
    ORDER BY snapshot_date DESC LIMIT 1
) ap ON true
LEFT JOIN LATERAL (
    SELECT * FROM bricklink_arbitrage_pricing
    WHERE bricklink_set_number = bs.set_number
      AND user_id = tu.user_id
      AND condition = 'N' AND country_code = 'UK'
    ORDER BY snapshot_date DESC LIMIT 1
) bp ON true
LEFT JOIN LATERAL (
    SELECT * FROM ebay_pricing
    WHERE set_number = bs.set_number
      AND upper(condition) = 'NEW' AND country_code = 'GB'
    ORDER BY snapshot_date DESC LIMIT 1
) ep ON true
WHERE sa.discovery_status = 'found'
  AND sa.asin IS NOT NULL
  AND ta_excl.asin IS NULL  -- anti-join: no matching tracked ASIN
  AND (usp.user_status IS NULL OR usp.user_status <> 'excluded');
