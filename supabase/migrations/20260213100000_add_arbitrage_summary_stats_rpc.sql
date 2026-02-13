-- RPC function for arbitrage summary stats
-- Replaces 3 separate COUNT(*) queries that timeout on the complex view
-- Single pass aggregation is much faster

CREATE OR REPLACE FUNCTION get_arbitrage_summary_stats(
  p_user_id UUID,
  p_min_margin NUMERIC DEFAULT 30,
  p_ebay_min_margin NUMERIC DEFAULT 50
)
RETURNS JSON
LANGUAGE sql
STABLE
SECURITY DEFINER
SET statement_timeout = '30s'
AS $$
  SELECT json_build_object(
    'total_items', count(*),
    'bl_opportunities', count(*) FILTER (WHERE margin_percent >= p_min_margin),
    'ebay_opportunities', count(*) FILTER (WHERE ebay_margin_percent >= p_ebay_min_margin)
  )
  FROM arbitrage_current_view
  WHERE user_id = p_user_id;
$$;

-- Grant execute to authenticated users
GRANT EXECUTE ON FUNCTION get_arbitrage_summary_stats(UUID, NUMERIC, NUMERIC) TO authenticated;
