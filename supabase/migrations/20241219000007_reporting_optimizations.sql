-- Reporting Optimizations
-- Migration: 20241219000007_reporting_optimizations
-- Adds indexes and helper views for efficient financial reporting

-- ============================================================================
-- ADDITIONAL INDEXES FOR REPORTING QUERIES
-- ============================================================================

-- Sales table reporting indexes
CREATE INDEX IF NOT EXISTS idx_sales_user_date ON sales(user_id, sale_date);
CREATE INDEX IF NOT EXISTS idx_sales_user_platform_date ON sales(user_id, platform, sale_date);

-- Inventory items reporting indexes
CREATE INDEX IF NOT EXISTS idx_inventory_user_status ON inventory_items(user_id, status);
CREATE INDEX IF NOT EXISTS idx_inventory_user_created ON inventory_items(user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_inventory_user_purchase_date ON inventory_items(user_id, purchase_date)
  WHERE purchase_date IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_inventory_user_condition_status ON inventory_items(user_id, condition, status);

-- Purchases reporting indexes
CREATE INDEX IF NOT EXISTS idx_purchases_user_date ON purchases(user_id, purchase_date);
CREATE INDEX IF NOT EXISTS idx_purchases_user_source ON purchases(user_id, source);

-- Platform orders for reporting
CREATE INDEX IF NOT EXISTS idx_orders_user_date_platform ON platform_orders(user_id, order_date, platform);

-- ============================================================================
-- ADD DAYS_IN_STOCK COMPUTED COLUMN TO INVENTORY_ITEMS
-- ============================================================================
-- We'll compute this dynamically in queries for now as PostgreSQL doesn't support
-- stored computed columns that reference CURRENT_DATE

-- ============================================================================
-- ADD MILEAGE TRACKING TO PURCHASES IF NOT EXISTS
-- ============================================================================
ALTER TABLE purchases
ADD COLUMN IF NOT EXISTS collection_location TEXT,
ADD COLUMN IF NOT EXISTS mileage DECIMAL(8,1);

-- Create index for mileage reporting
CREATE INDEX IF NOT EXISTS idx_purchases_user_mileage ON purchases(user_id, mileage)
  WHERE mileage IS NOT NULL;

-- ============================================================================
-- ADD REPORT SETTINGS TO USER_SETTINGS
-- ============================================================================
ALTER TABLE user_settings
ADD COLUMN IF NOT EXISTS report_settings JSONB DEFAULT '{
  "financialYearStartMonth": 4,
  "defaultCurrency": "GBP",
  "mileageRate": 0.45,
  "businessName": null,
  "businessAddress": null,
  "showPreviousPeriodComparison": true
}'::jsonb;

-- ============================================================================
-- CREATE HELPER FUNCTION FOR FINANCIAL YEAR CALCULATIONS
-- ============================================================================
CREATE OR REPLACE FUNCTION get_uk_financial_year(input_date DATE)
RETURNS INTEGER AS $$
BEGIN
  -- UK financial year runs April to March
  -- If month is January-March, financial year is previous year
  IF EXTRACT(MONTH FROM input_date) < 4 THEN
    RETURN EXTRACT(YEAR FROM input_date)::INTEGER - 1;
  ELSE
    RETURN EXTRACT(YEAR FROM input_date)::INTEGER;
  END IF;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- ============================================================================
-- CREATE HELPER FUNCTION FOR DAYS IN STOCK CALCULATION
-- ============================================================================
CREATE OR REPLACE FUNCTION calculate_days_in_stock(purchase_date DATE, created_at TIMESTAMPTZ)
RETURNS INTEGER AS $$
BEGIN
  -- Use purchase_date if available, otherwise fall back to created_at
  IF purchase_date IS NOT NULL THEN
    RETURN EXTRACT(DAY FROM (CURRENT_DATE - purchase_date))::INTEGER;
  ELSIF created_at IS NOT NULL THEN
    RETURN EXTRACT(DAY FROM (CURRENT_DATE - created_at::DATE))::INTEGER;
  ELSE
    RETURN 0;
  END IF;
END;
$$ LANGUAGE plpgsql STABLE;

-- ============================================================================
-- CREATE VIEW FOR INVENTORY WITH COMPUTED DAYS IN STOCK
-- ============================================================================
CREATE OR REPLACE VIEW inventory_items_with_age AS
SELECT
  i.*,
  calculate_days_in_stock(i.purchase_date, i.created_at) AS days_in_stock,
  CASE
    WHEN calculate_days_in_stock(i.purchase_date, i.created_at) <= 30 THEN '0-30 days'
    WHEN calculate_days_in_stock(i.purchase_date, i.created_at) <= 60 THEN '31-60 days'
    WHEN calculate_days_in_stock(i.purchase_date, i.created_at) <= 90 THEN '61-90 days'
    WHEN calculate_days_in_stock(i.purchase_date, i.created_at) <= 180 THEN '91-180 days'
    ELSE '180+ days'
  END AS age_bracket
FROM inventory_items i;

-- Grant select on the view (inherits RLS from underlying table)
GRANT SELECT ON inventory_items_with_age TO authenticated;

-- ============================================================================
-- CREATE MATERIALIZED VIEW FOR MONTHLY SALES SUMMARY (REFRESHED PERIODICALLY)
-- Note: This is optional and can be refreshed via a scheduled job
-- ============================================================================
-- Commenting out materialized views for now as they require REFRESH permissions
-- and add complexity. The reporting service will compute these on-the-fly with
-- proper indexing for good performance.

-- CREATE MATERIALIZED VIEW IF NOT EXISTS monthly_sales_summary AS
-- SELECT
--   user_id,
--   DATE_TRUNC('month', sale_date)::DATE AS month,
--   EXTRACT(YEAR FROM sale_date)::INTEGER AS year,
--   EXTRACT(MONTH FROM sale_date)::INTEGER AS month_num,
--   COUNT(*)::INTEGER AS sale_count,
--   COALESCE(SUM(sale_amount), 0) AS total_revenue,
--   COALESCE(SUM(gross_profit), 0) AS total_profit,
--   COALESCE(SUM(platform_fees), 0) AS total_fees,
--   COALESCE(SUM(shipping_cost), 0) AS total_shipping_cost,
--   COALESCE(SUM(cost_of_goods), 0) AS total_cogs
-- FROM sales
-- GROUP BY user_id, DATE_TRUNC('month', sale_date), EXTRACT(YEAR FROM sale_date), EXTRACT(MONTH FROM sale_date);

-- CREATE UNIQUE INDEX ON monthly_sales_summary(user_id, month);
-- CREATE INDEX ON monthly_sales_summary(user_id, year);

-- ============================================================================
-- CREATE VIEW FOR PLATFORM PERFORMANCE METRICS
-- ============================================================================
CREATE OR REPLACE VIEW platform_performance_view AS
SELECT
  s.user_id,
  s.platform,
  DATE_TRUNC('month', s.sale_date)::DATE AS month,
  COUNT(*)::INTEGER AS order_count,
  COALESCE(SUM(s.sale_amount + COALESCE(s.shipping_charged, 0)), 0) AS total_revenue,
  COALESCE(SUM(s.platform_fees), 0) AS total_fees,
  COALESCE(SUM(s.gross_profit), 0) AS total_profit,
  COALESCE(AVG(s.sale_amount + COALESCE(s.shipping_charged, 0)), 0) AS avg_order_value
FROM sales s
GROUP BY s.user_id, s.platform, DATE_TRUNC('month', s.sale_date);

-- Grant select on the view
GRANT SELECT ON platform_performance_view TO authenticated;

-- ============================================================================
-- CREATE VIEW FOR PURCHASE ROI TRACKING
-- ============================================================================
CREATE OR REPLACE VIEW purchase_roi_view AS
SELECT
  p.id AS purchase_id,
  p.user_id,
  p.purchase_date,
  p.short_description,
  p.cost AS purchase_cost,
  p.source,
  p.mileage,
  COALESCE(p.mileage * 0.45, 0) AS mileage_cost, -- HMRC rate
  COUNT(DISTINCT i.id) AS items_count,
  COUNT(DISTINCT CASE WHEN i.status = 'SOLD' THEN i.id END) AS items_sold,
  COALESCE(SUM(CASE WHEN i.status = 'SOLD' THEN i.listing_value ELSE 0 END), 0) AS revenue_from_sold,
  COALESCE(SUM(i.cost), 0) AS total_item_cost
FROM purchases p
LEFT JOIN inventory_items i ON i.source = p.short_description
  AND i.user_id = p.user_id
  AND i.purchase_date = p.purchase_date
GROUP BY p.id, p.user_id, p.purchase_date, p.short_description, p.cost, p.source, p.mileage;

-- Grant select on the view
GRANT SELECT ON purchase_roi_view TO authenticated;
