-- Platform Stock Migration
-- Purpose: Store platform listings and support stock reconciliation between
-- external platform listings (Amazon, eBay, BrickLink) and internal inventory

-- ============================================================================
-- PLATFORM_LISTING_IMPORTS TABLE
-- Tracks import history and status (must be created first for FK reference)
-- ============================================================================

CREATE TABLE platform_listing_imports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,

  -- Import details
  platform TEXT NOT NULL, -- 'amazon', 'ebay', 'bricklink'
  import_type TEXT NOT NULL DEFAULT 'full', -- 'full', 'incremental'
  status TEXT NOT NULL DEFAULT 'pending', -- 'pending', 'processing', 'completed', 'failed'

  -- Progress tracking
  total_rows INTEGER,
  processed_rows INTEGER DEFAULT 0,
  error_count INTEGER DEFAULT 0,

  -- Amazon Report API specific
  amazon_report_id TEXT,
  amazon_report_document_id TEXT,
  amazon_report_type TEXT,

  -- Timing
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,

  -- Error details
  error_message TEXT,
  error_details JSONB,

  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

-- ============================================================================
-- PLATFORM_LISTINGS TABLE
-- Stores imported listing data from external platforms (Amazon, eBay, etc.)
-- ============================================================================

CREATE TABLE platform_listings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,

  -- Platform identification
  platform TEXT NOT NULL, -- 'amazon', 'ebay', 'bricklink'

  -- Common listing fields (normalized across platforms)
  platform_sku TEXT, -- SKU/seller SKU on the platform
  platform_item_id TEXT NOT NULL, -- ASIN for Amazon, Item ID for eBay, Lot ID for BrickLink
  title TEXT,
  quantity INTEGER DEFAULT 0,
  price DECIMAL(10,2),
  currency TEXT DEFAULT 'GBP',

  -- Listing status
  listing_status TEXT, -- 'Active', 'Inactive', 'Incomplete', etc.
  fulfillment_channel TEXT, -- 'FBA', 'FBM' for Amazon; 'Standard' for others

  -- Platform-specific fields (stored in JSONB for flexibility)
  amazon_data JSONB, -- fnsku, product_type, item_condition, open_date, etc.
  ebay_data JSONB, -- listing_type, format, category_id, etc.
  bricklink_data JSONB, -- lot_id, color_id, category_id, etc.

  -- Import tracking
  import_id UUID NOT NULL REFERENCES platform_listing_imports(id) ON DELETE CASCADE,
  raw_data JSONB NOT NULL, -- Original row from report/API

  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,

  -- Unique constraint per platform listing per import
  -- This allows us to keep historical snapshots if needed
  UNIQUE(user_id, platform, platform_item_id, import_id)
);

-- ============================================================================
-- INDEXES
-- ============================================================================

-- platform_listings indexes
CREATE INDEX idx_platform_listings_user ON platform_listings(user_id);
CREATE INDEX idx_platform_listings_platform ON platform_listings(user_id, platform);
CREATE INDEX idx_platform_listings_item_id ON platform_listings(user_id, platform, platform_item_id);
CREATE INDEX idx_platform_listings_import ON platform_listings(import_id);
CREATE INDEX idx_platform_listings_status ON platform_listings(user_id, platform, listing_status);
CREATE INDEX idx_platform_listings_sku ON platform_listings(user_id, platform, platform_sku);
CREATE INDEX idx_platform_listings_quantity ON platform_listings(user_id, platform, quantity) WHERE quantity > 0;

-- platform_listing_imports indexes
CREATE INDEX idx_platform_listing_imports_user ON platform_listing_imports(user_id);
CREATE INDEX idx_platform_listing_imports_platform ON platform_listing_imports(user_id, platform);
CREATE INDEX idx_platform_listing_imports_status ON platform_listing_imports(user_id, status);
CREATE INDEX idx_platform_listing_imports_latest ON platform_listing_imports(user_id, platform, created_at DESC);

-- ============================================================================
-- UPDATED_AT TRIGGER
-- ============================================================================

CREATE TRIGGER update_platform_listings_updated_at
  BEFORE UPDATE ON platform_listings
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- ============================================================================
-- ROW LEVEL SECURITY
-- ============================================================================

ALTER TABLE platform_listings ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_listing_imports ENABLE ROW LEVEL SECURITY;

-- platform_listings policies
CREATE POLICY "Users can view own platform listings"
  ON platform_listings FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own platform listings"
  ON platform_listings FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own platform listings"
  ON platform_listings FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own platform listings"
  ON platform_listings FOR DELETE
  USING (auth.uid() = user_id);

-- platform_listing_imports policies
CREATE POLICY "Users can view own platform listing imports"
  ON platform_listing_imports FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own platform listing imports"
  ON platform_listing_imports FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own platform listing imports"
  ON platform_listing_imports FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own platform listing imports"
  ON platform_listing_imports FOR DELETE
  USING (auth.uid() = user_id);

-- ============================================================================
-- COMMENTS
-- ============================================================================

COMMENT ON TABLE platform_listings IS 'Imported listing data from selling platforms for stock reconciliation';
COMMENT ON TABLE platform_listing_imports IS 'Import history and status tracking for platform listings';

COMMENT ON COLUMN platform_listings.platform_item_id IS 'Platform-specific identifier: ASIN for Amazon, Item ID for eBay, Lot ID for BrickLink';
COMMENT ON COLUMN platform_listings.amazon_data IS 'Amazon-specific fields: fnsku, product_type, item_condition, open_date, will_ship_internationally, expedited_shipping';
COMMENT ON COLUMN platform_listings.ebay_data IS 'eBay-specific fields: listing_type, format, category_id, store_category';
COMMENT ON COLUMN platform_listings.bricklink_data IS 'BrickLink-specific fields: lot_id, color_id, color_name, category_id, category_name';
COMMENT ON COLUMN platform_listings.raw_data IS 'Original row data from the platform report/API for debugging and future parsing';

COMMENT ON COLUMN platform_listing_imports.amazon_report_id IS 'Amazon SP-API report ID for tracking report generation';
COMMENT ON COLUMN platform_listing_imports.amazon_report_document_id IS 'Amazon SP-API document ID for downloading the report';
COMMENT ON COLUMN platform_listing_imports.amazon_report_type IS 'Amazon report type, e.g., GET_MERCHANT_LISTINGS_ALL_DATA';
