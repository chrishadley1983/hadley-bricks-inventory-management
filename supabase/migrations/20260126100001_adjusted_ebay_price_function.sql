-- Create function to calculate exclusion-adjusted eBay min price
-- This function calculates the minimum eBay price after removing user-excluded listings

CREATE OR REPLACE FUNCTION get_adjusted_ebay_stats(
  p_set_number VARCHAR,
  p_user_id UUID
)
RETURNS TABLE (
  adjusted_min_price NUMERIC,
  adjusted_avg_price NUMERIC,
  adjusted_max_price NUMERIC,
  adjusted_total_listings INTEGER
)
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  v_excluded_ids TEXT[];
  v_listings JSONB;
BEGIN
  -- Get the listings JSON for this set (latest snapshot, New condition, GB)
  SELECT ep.listings_json INTO v_listings
  FROM ebay_pricing ep
  WHERE ep.set_number = p_set_number
    AND UPPER(ep.condition) = 'NEW'
    AND ep.country_code = 'GB'
  ORDER BY ep.snapshot_date DESC
  LIMIT 1;

  -- If no listings found, return NULLs
  IF v_listings IS NULL OR jsonb_array_length(v_listings) = 0 THEN
    RETURN QUERY SELECT NULL::NUMERIC, NULL::NUMERIC, NULL::NUMERIC, 0;
    RETURN;
  END IF;

  -- Get excluded item IDs for this user and set
  SELECT array_agg(ebay_item_id) INTO v_excluded_ids
  FROM excluded_ebay_listings
  WHERE user_id = p_user_id
    AND set_number = p_set_number;

  -- If no exclusions, return original stats
  IF v_excluded_ids IS NULL THEN
    RETURN QUERY
    SELECT
      MIN((listing->>'totalPrice')::NUMERIC),
      AVG((listing->>'totalPrice')::NUMERIC),
      MAX((listing->>'totalPrice')::NUMERIC),
      COUNT(*)::INTEGER
    FROM jsonb_array_elements(v_listings) AS listing;
    RETURN;
  END IF;

  -- Calculate stats from non-excluded listings
  RETURN QUERY
  SELECT
    MIN((listing->>'totalPrice')::NUMERIC),
    AVG((listing->>'totalPrice')::NUMERIC),
    MAX((listing->>'totalPrice')::NUMERIC),
    COUNT(*)::INTEGER
  FROM jsonb_array_elements(v_listings) AS listing
  WHERE NOT ((listing->>'itemId')::TEXT = ANY(v_excluded_ids));
END;
$$;

COMMENT ON FUNCTION get_adjusted_ebay_stats IS 'Calculates eBay price statistics after removing user-excluded listings for a given set';

-- Create an index to speed up exclusion lookups
CREATE INDEX IF NOT EXISTS idx_excluded_ebay_listings_user_set
ON excluded_ebay_listings(user_id, set_number);
