-- ============================================================================
-- Transaction Summary Aggregation Functions
-- ============================================================================
-- These functions perform server-side aggregation for transaction summaries,
-- replacing the need for client-side loops that fetch all data.
-- ============================================================================

-- ============================================================================
-- eBay Transaction Summary Function
-- ============================================================================
-- Calculates total sales, fees, and refunds for eBay transactions.
-- Mirrors the client-side logic that was:
--   - SALE: gross = amount + abs(total_fee_amount), fees = abs(total_fee_amount)
--   - REFUND: refund = abs(amount)
--   - NON_SALE_CHARGE: fees += abs(amount)
-- ============================================================================
CREATE OR REPLACE FUNCTION calculate_ebay_transaction_summary(
  p_user_id UUID,
  p_transaction_type TEXT DEFAULT NULL,
  p_from_date TIMESTAMPTZ DEFAULT NULL,
  p_to_date TIMESTAMPTZ DEFAULT NULL,
  p_search TEXT DEFAULT NULL
)
RETURNS TABLE(
  total_sales NUMERIC,
  total_fees NUMERIC,
  total_refunds NUMERIC,
  transaction_count BIGINT
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    -- Sales = net amount + fees deducted (gross sales)
    COALESCE(SUM(
      CASE
        WHEN et.transaction_type = 'SALE'
        THEN COALESCE(et.amount, 0) + ABS(COALESCE(et.total_fee_amount, 0))
        ELSE 0
      END
    ), 0)::NUMERIC as total_sales,

    -- Fees = fees from sales + standalone fee transactions
    COALESCE(SUM(
      CASE
        WHEN et.transaction_type = 'SALE'
        THEN ABS(COALESCE(et.total_fee_amount, 0))
        WHEN et.transaction_type = 'NON_SALE_CHARGE'
        THEN ABS(COALESCE(et.amount, 0))
        ELSE 0
      END
    ), 0)::NUMERIC as total_fees,

    -- Refunds
    COALESCE(SUM(
      CASE
        WHEN et.transaction_type = 'REFUND'
        THEN ABS(COALESCE(et.amount, 0))
        ELSE 0
      END
    ), 0)::NUMERIC as total_refunds,

    COUNT(*)::BIGINT as transaction_count

  FROM ebay_transactions et
  WHERE et.user_id = p_user_id
    AND (p_transaction_type IS NULL OR et.transaction_type = p_transaction_type)
    AND (p_from_date IS NULL OR et.transaction_date >= p_from_date)
    AND (p_to_date IS NULL OR et.transaction_date <= p_to_date)
    AND (p_search IS NULL OR (
      et.item_title ILIKE '%' || p_search || '%' OR
      et.custom_label ILIKE '%' || p_search || '%' OR
      et.ebay_order_id ILIKE '%' || p_search || '%' OR
      et.buyer_username ILIKE '%' || p_search || '%'
    ));
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;

-- Grant execute permission to authenticated users
GRANT EXECUTE ON FUNCTION calculate_ebay_transaction_summary TO authenticated;

-- ============================================================================
-- Monzo Transaction Summary Function
-- ============================================================================
-- Calculates total income and expenses for Monzo transactions.
-- Income = positive amounts, Expenses = absolute value of negative amounts
-- ============================================================================
CREATE OR REPLACE FUNCTION calculate_monzo_transaction_summary(
  p_user_id UUID,
  p_category TEXT DEFAULT NULL,
  p_local_category TEXT DEFAULT NULL,
  p_start_date TIMESTAMPTZ DEFAULT NULL,
  p_end_date TIMESTAMPTZ DEFAULT NULL,
  p_search TEXT DEFAULT NULL
)
RETURNS TABLE(
  total_income NUMERIC,
  total_expenses NUMERIC,
  transaction_count BIGINT
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    -- Income = sum of positive amounts
    COALESCE(SUM(
      CASE
        WHEN mt.amount > 0 THEN mt.amount
        ELSE 0
      END
    ), 0)::NUMERIC as total_income,

    -- Expenses = sum of absolute negative amounts
    COALESCE(SUM(
      CASE
        WHEN mt.amount < 0 THEN ABS(mt.amount)
        ELSE 0
      END
    ), 0)::NUMERIC as total_expenses,

    COUNT(*)::BIGINT as transaction_count

  FROM monzo_transactions mt
  WHERE mt.user_id = p_user_id
    AND (p_category IS NULL OR mt.category = p_category)
    AND (p_local_category IS NULL OR mt.local_category = p_local_category)
    AND (p_start_date IS NULL OR mt.created >= p_start_date)
    AND (p_end_date IS NULL OR mt.created <= p_end_date)
    AND (p_search IS NULL OR (
      mt.description ILIKE '%' || p_search || '%' OR
      mt.merchant_name ILIKE '%' || p_search || '%'
    ));
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;

-- Grant execute permission to authenticated users
GRANT EXECUTE ON FUNCTION calculate_monzo_transaction_summary TO authenticated;

-- ============================================================================
-- Monzo Categories Function
-- ============================================================================
-- Returns distinct local_category values for a user's Monzo transactions.
-- Uses DISTINCT to efficiently get unique values at the database level.
-- ============================================================================
CREATE OR REPLACE FUNCTION get_monzo_local_categories(
  p_user_id UUID
)
RETURNS TABLE(
  local_category TEXT
) AS $$
BEGIN
  RETURN QUERY
  SELECT DISTINCT mt.local_category
  FROM monzo_transactions mt
  WHERE mt.user_id = p_user_id
    AND mt.local_category IS NOT NULL
    AND mt.local_category != ''
  ORDER BY mt.local_category;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;

-- Grant execute permission to authenticated users
GRANT EXECUTE ON FUNCTION get_monzo_local_categories TO authenticated;

-- ============================================================================
-- Add indexes to support the aggregation queries
-- ============================================================================

-- Index for eBay transaction summary queries
CREATE INDEX IF NOT EXISTS idx_ebay_transactions_summary
ON ebay_transactions (user_id, transaction_type, transaction_date);

-- Index for Monzo transaction summary queries
CREATE INDEX IF NOT EXISTS idx_monzo_transactions_summary
ON monzo_transactions (user_id, category, local_category, created);

-- Partial index for Monzo categories (non-null, non-empty only)
CREATE INDEX IF NOT EXISTS idx_monzo_transactions_local_category
ON monzo_transactions (user_id, local_category)
WHERE local_category IS NOT NULL AND local_category != '';
