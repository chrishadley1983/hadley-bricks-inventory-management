-- Update Monzo summary RPC to support archive filter and search across user overrides.
--
-- The default UI hides archived transactions, so the totals in the header cards
-- must match what's on screen. We add p_include_archived (default false) and
-- broaden the search to cover user_merchant_name / user_description so a row
-- the user has retitled stays findable.

-- Drop the previous overload so the new signature replaces it cleanly.
DROP FUNCTION IF EXISTS calculate_monzo_transaction_summary(UUID, TEXT, TEXT, TIMESTAMPTZ, TIMESTAMPTZ, TEXT);

CREATE OR REPLACE FUNCTION calculate_monzo_transaction_summary(
  p_user_id UUID,
  p_category TEXT DEFAULT NULL,
  p_local_category TEXT DEFAULT NULL,
  p_start_date TIMESTAMPTZ DEFAULT NULL,
  p_end_date TIMESTAMPTZ DEFAULT NULL,
  p_search TEXT DEFAULT NULL,
  p_include_archived BOOLEAN DEFAULT false
)
RETURNS TABLE(
  total_income NUMERIC,
  total_expenses NUMERIC,
  transaction_count BIGINT
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    COALESCE(SUM(CASE WHEN mt.amount > 0 THEN mt.amount ELSE 0 END), 0)::NUMERIC as total_income,
    COALESCE(SUM(CASE WHEN mt.amount < 0 THEN ABS(mt.amount) ELSE 0 END), 0)::NUMERIC as total_expenses,
    COUNT(*)::BIGINT as transaction_count
  FROM monzo_transactions mt
  WHERE mt.user_id = p_user_id
    AND (p_include_archived OR mt.is_archived = false)
    AND (p_category IS NULL OR mt.category = p_category)
    AND (p_local_category IS NULL OR mt.local_category = p_local_category)
    AND (p_start_date IS NULL OR mt.created >= p_start_date)
    AND (p_end_date IS NULL OR mt.created <= p_end_date)
    AND (p_search IS NULL OR (
      mt.description ILIKE '%' || p_search || '%' OR
      mt.merchant_name ILIKE '%' || p_search || '%' OR
      mt.user_merchant_name ILIKE '%' || p_search || '%' OR
      mt.user_description ILIKE '%' || p_search || '%'
    ));
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION calculate_monzo_transaction_summary TO authenticated;
