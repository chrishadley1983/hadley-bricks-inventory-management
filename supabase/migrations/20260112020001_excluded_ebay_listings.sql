-- Excluded eBay Listings table
-- Stores eBay item IDs that should be excluded from arbitrage calculations
-- Persists across sync refreshes

CREATE TABLE excluded_ebay_listings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  ebay_item_id VARCHAR(50) NOT NULL,
  set_number VARCHAR(20) NOT NULL,
  title TEXT,
  reason TEXT,
  excluded_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,

  UNIQUE(user_id, ebay_item_id)
);

-- Indexes
CREATE INDEX idx_excluded_ebay_listings_user ON excluded_ebay_listings(user_id);
CREATE INDEX idx_excluded_ebay_listings_set ON excluded_ebay_listings(set_number);

-- RLS
ALTER TABLE excluded_ebay_listings ENABLE ROW LEVEL SECURITY;

-- Users can only see their own excluded listings
CREATE POLICY "Users can view own excluded eBay listings"
  ON excluded_ebay_listings FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

-- Users can insert their own excluded listings
CREATE POLICY "Users can insert own excluded eBay listings"
  ON excluded_ebay_listings FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

-- Users can delete their own excluded listings
CREATE POLICY "Users can delete own excluded eBay listings"
  ON excluded_ebay_listings FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);

COMMENT ON TABLE excluded_ebay_listings IS 'eBay listings excluded from arbitrage tracking by user';
COMMENT ON COLUMN excluded_ebay_listings.ebay_item_id IS 'eBay item ID to exclude';
COMMENT ON COLUMN excluded_ebay_listings.set_number IS 'BrickLink set number this listing was associated with';
COMMENT ON COLUMN excluded_ebay_listings.title IS 'Listing title at time of exclusion (for reference)';
COMMENT ON COLUMN excluded_ebay_listings.reason IS 'Optional reason for exclusion';
