-- Daily Activity Reporting
-- Migration: 20250108000002_daily_activity_reporting
-- Purpose: Create infrastructure for daily/monthly listing and sales tracking per platform

-- ============================================================================
-- PLATFORM STORE STATUS TABLE
-- Manual input for daily store status (O=Open, C=Closed, H=Holiday)
-- ============================================================================
CREATE TABLE platform_store_status (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  date DATE NOT NULL,
  platform TEXT NOT NULL CHECK (platform IN ('amazon', 'ebay', 'bricklink')),
  status CHAR(1) NOT NULL CHECK (status IN ('O', 'C', 'H')),
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  UNIQUE(user_id, date, platform)
);

-- Indexes for efficient querying
CREATE INDEX idx_store_status_user_date ON platform_store_status(user_id, date DESC);
CREATE INDEX idx_store_status_user_date_platform ON platform_store_status(user_id, date, platform);

-- Updated_at trigger
CREATE TRIGGER update_store_status_updated_at
  BEFORE UPDATE ON platform_store_status
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- Enable RLS
ALTER TABLE platform_store_status ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY "Users can view own store status"
  ON platform_store_status FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own store status"
  ON platform_store_status FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own store status"
  ON platform_store_status FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own store status"
  ON platform_store_status FOR DELETE
  USING (auth.uid() = user_id);

-- ============================================================================
-- DAILY PLATFORM ACTIVITY VIEW
-- Aggregates listing and sold data from multiple sources:
-- - Amazon/eBay listings: from inventory_items
-- - BrickLink listings: from bricklink_uploads
-- - All sales: from inventory_items
-- ============================================================================
CREATE OR REPLACE VIEW daily_platform_activity AS
WITH
-- Listing data from inventory_items (Amazon/eBay only)
inventory_listings AS (
  SELECT
    user_id,
    listing_date AS activity_date,
    LOWER(listing_platform) AS platform,
    COUNT(*)::INTEGER AS items_listed,
    COALESCE(SUM(listing_value), 0)::NUMERIC(12,2) AS listing_value
  FROM inventory_items
  WHERE listing_date IS NOT NULL
    AND listing_platform IS NOT NULL
    AND LOWER(listing_platform) IN ('amazon', 'ebay')
  GROUP BY user_id, listing_date, LOWER(listing_platform)
),
-- Listing data from bricklink_uploads (BrickLink only)
bricklink_listings AS (
  SELECT
    user_id,
    upload_date AS activity_date,
    'bricklink'::TEXT AS platform,
    COALESCE(SUM(total_quantity), 0)::INTEGER AS items_listed,
    COALESCE(SUM(selling_price), 0)::NUMERIC(12,2) AS listing_value
  FROM bricklink_uploads
  WHERE upload_date IS NOT NULL
  GROUP BY user_id, upload_date
),
-- Combine all listings
all_listings AS (
  SELECT * FROM inventory_listings
  UNION ALL
  SELECT * FROM bricklink_listings
),
-- Sales data from inventory_items (all platforms)
sold_data AS (
  SELECT
    user_id,
    sold_date AS activity_date,
    LOWER(sold_platform) AS platform,
    COUNT(*)::INTEGER AS items_sold,
    COALESCE(SUM(sold_price), 0)::NUMERIC(12,2) AS sold_value
  FROM inventory_items
  WHERE sold_date IS NOT NULL
    AND sold_platform IS NOT NULL
    AND LOWER(sold_platform) IN ('amazon', 'ebay', 'bricklink')
  GROUP BY user_id, sold_date, LOWER(sold_platform)
)
-- Final join with full outer join to capture all activity
SELECT
  COALESCE(l.user_id, s.user_id) AS user_id,
  COALESCE(l.activity_date, s.activity_date) AS activity_date,
  COALESCE(l.platform, s.platform) AS platform,
  COALESCE(l.items_listed, 0) AS items_listed,
  COALESCE(l.listing_value, 0) AS listing_value,
  COALESCE(s.items_sold, 0) AS items_sold,
  COALESCE(s.sold_value, 0) AS sold_value
FROM all_listings l
FULL OUTER JOIN sold_data s
  ON l.user_id = s.user_id
  AND l.activity_date = s.activity_date
  AND l.platform = s.platform;

-- Grant select on the view
GRANT SELECT ON daily_platform_activity TO authenticated;

-- ============================================================================
-- MONTHLY PLATFORM SUMMARY VIEW
-- Aggregates daily activity by month for monthly view
-- ============================================================================
CREATE OR REPLACE VIEW monthly_platform_summary AS
SELECT
  user_id,
  DATE_TRUNC('month', activity_date)::DATE AS month_start,
  TO_CHAR(activity_date, 'YYYY-MM') AS month,
  platform,
  SUM(items_listed)::INTEGER AS items_listed,
  SUM(listing_value)::NUMERIC(12,2) AS listing_value,
  SUM(items_sold)::INTEGER AS items_sold,
  SUM(sold_value)::NUMERIC(12,2) AS sold_value
FROM daily_platform_activity
GROUP BY user_id, DATE_TRUNC('month', activity_date), TO_CHAR(activity_date, 'YYYY-MM'), platform;

-- Grant select on the view
GRANT SELECT ON monthly_platform_summary TO authenticated;

-- ============================================================================
-- ADDITIONAL INDEXES FOR PERFORMANCE
-- Optimize queries on inventory_items for activity reporting
-- ============================================================================
CREATE INDEX IF NOT EXISTS idx_inventory_listing_date_platform
  ON inventory_items(user_id, listing_date, listing_platform)
  WHERE listing_date IS NOT NULL AND listing_platform IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_inventory_sold_date_platform
  ON inventory_items(user_id, sold_date, sold_platform)
  WHERE sold_date IS NOT NULL AND sold_platform IS NOT NULL;

-- Index for bricklink_uploads activity queries
CREATE INDEX IF NOT EXISTS idx_bricklink_uploads_date_activity
  ON bricklink_uploads(user_id, upload_date)
  WHERE upload_date IS NOT NULL;

-- ============================================================================
-- COMMENTS
-- ============================================================================
COMMENT ON TABLE platform_store_status IS 'Manual daily store status (Open/Closed/Holiday) per platform';
COMMENT ON COLUMN platform_store_status.status IS 'O=Open, C=Closed, H=Holiday';
COMMENT ON VIEW daily_platform_activity IS 'Daily aggregated listing and sales activity per platform. Listings from inventory_items (Amazon/eBay) and bricklink_uploads (BrickLink). Sales from inventory_items.';
COMMENT ON VIEW monthly_platform_summary IS 'Monthly aggregated listing and sales activity per platform';
