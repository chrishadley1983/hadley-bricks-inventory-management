-- ============================================================================
-- eBay Listing Refresh Tables
--
-- Tracks listing refresh operations for ending old listings and recreating
-- them to boost eBay algorithm visibility.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Table: ebay_listing_refreshes
-- Tracks refresh operations (batches of listings being refreshed)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ebay_listing_refreshes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,

  -- Status tracking
  -- pending: job created but not started
  -- fetching: fetching full listing details
  -- ending: ending listings phase
  -- creating: creating new listings phase
  -- completed: all operations finished
  -- failed: job failed
  -- cancelled: job was cancelled
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'fetching', 'ending', 'creating', 'completed', 'failed', 'cancelled')),

  -- Progress tracking
  total_listings INTEGER NOT NULL DEFAULT 0,
  fetched_count INTEGER NOT NULL DEFAULT 0,
  ended_count INTEGER NOT NULL DEFAULT 0,
  created_count INTEGER NOT NULL DEFAULT 0,
  failed_count INTEGER NOT NULL DEFAULT 0,
  skipped_count INTEGER NOT NULL DEFAULT 0,

  -- Mode settings
  -- review_mode: true = user reviews items before ending, false = immediate processing
  review_mode BOOLEAN NOT NULL DEFAULT true,

  -- Timing
  started_at TIMESTAMPTZ,
  fetch_phase_completed_at TIMESTAMPTZ,
  end_phase_completed_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,

  -- Error summary (for job-level failures)
  error_message TEXT,

  -- Timestamps
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ----------------------------------------------------------------------------
-- Table: ebay_listing_refresh_items
-- Tracks individual listings within a refresh operation with full audit trail
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ebay_listing_refresh_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  refresh_id UUID NOT NULL REFERENCES ebay_listing_refreshes(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,

  -- Original listing data (captured before ending)
  original_item_id TEXT NOT NULL,
  original_title TEXT NOT NULL,
  original_price DECIMAL(10,2),
  original_quantity INTEGER,
  original_condition TEXT,
  original_condition_id INTEGER,
  original_category_id TEXT,
  original_category_name TEXT,
  original_store_category_id TEXT,
  original_store_category_name TEXT,
  original_listing_type TEXT,
  original_listing_start_date TIMESTAMPTZ,
  original_listing_end_date TIMESTAMPTZ,
  original_watchers INTEGER DEFAULT 0,
  original_views INTEGER,
  original_quantity_sold INTEGER DEFAULT 0,
  original_sku TEXT,
  original_gallery_url TEXT,
  original_view_item_url TEXT,
  original_best_offer_enabled BOOLEAN DEFAULT false,
  original_best_offer_auto_accept DECIMAL(10,2),
  original_minimum_best_offer DECIMAL(10,2),

  -- Full listing details fetched via GetItem (for recreation)
  original_description TEXT,
  original_image_urls TEXT[],
  original_shipping_policy_id TEXT,
  original_return_policy_id TEXT,
  original_payment_policy_id TEXT,

  -- Cached listing data for recreation (full JSON for flexibility)
  cached_listing_data JSONB,

  -- Modified values (user edits before recreation)
  modified_title TEXT,
  modified_price DECIMAL(10,2),
  modified_quantity INTEGER,

  -- New listing data (after recreation)
  new_item_id TEXT,
  new_listing_url TEXT,
  new_listing_start_date TIMESTAMPTZ,

  -- Status tracking
  -- pending: initial state
  -- pending_review: awaiting user review (review mode)
  -- approved: user approved for refresh
  -- fetching: fetching full details via GetItem
  -- fetched: full details retrieved
  -- ending: EndItem call in progress
  -- ended: listing ended successfully
  -- creating: AddFixedPriceItem call in progress
  -- created: new listing created successfully
  -- failed: operation failed (check error fields)
  -- skipped: user chose to skip this item
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'pending_review', 'approved', 'fetching', 'fetched',
                      'ending', 'ended', 'creating', 'created', 'failed', 'skipped')),

  -- Phase completion timestamps
  fetch_completed_at TIMESTAMPTZ,
  end_completed_at TIMESTAMPTZ,
  create_completed_at TIMESTAMPTZ,

  -- Error tracking
  error_phase TEXT CHECK (error_phase IN ('fetch', 'end', 'create')),
  error_code TEXT,
  error_message TEXT,

  -- Timestamps
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ----------------------------------------------------------------------------
-- Indexes
-- ----------------------------------------------------------------------------

-- ebay_listing_refreshes indexes
CREATE INDEX IF NOT EXISTS idx_ebay_listing_refreshes_user
  ON ebay_listing_refreshes(user_id);
CREATE INDEX IF NOT EXISTS idx_ebay_listing_refreshes_status
  ON ebay_listing_refreshes(user_id, status);
CREATE INDEX IF NOT EXISTS idx_ebay_listing_refreshes_created
  ON ebay_listing_refreshes(user_id, created_at DESC);

-- ebay_listing_refresh_items indexes
CREATE INDEX IF NOT EXISTS idx_ebay_listing_refresh_items_refresh
  ON ebay_listing_refresh_items(refresh_id);
CREATE INDEX IF NOT EXISTS idx_ebay_listing_refresh_items_user
  ON ebay_listing_refresh_items(user_id);
CREATE INDEX IF NOT EXISTS idx_ebay_listing_refresh_items_status
  ON ebay_listing_refresh_items(refresh_id, status);
CREATE INDEX IF NOT EXISTS idx_ebay_listing_refresh_items_original
  ON ebay_listing_refresh_items(original_item_id);
CREATE INDEX IF NOT EXISTS idx_ebay_listing_refresh_items_new
  ON ebay_listing_refresh_items(new_item_id);

-- ----------------------------------------------------------------------------
-- Row Level Security
-- ----------------------------------------------------------------------------

ALTER TABLE ebay_listing_refreshes ENABLE ROW LEVEL SECURITY;
ALTER TABLE ebay_listing_refresh_items ENABLE ROW LEVEL SECURITY;

-- Policies for ebay_listing_refreshes
CREATE POLICY "Users can view their own refresh jobs"
  ON ebay_listing_refreshes FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "Users can create their own refresh jobs"
  ON ebay_listing_refreshes FOR INSERT
  TO authenticated
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "Users can update their own refresh jobs"
  ON ebay_listing_refreshes FOR UPDATE
  TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "Users can delete their own refresh jobs"
  ON ebay_listing_refreshes FOR DELETE
  TO authenticated
  USING (user_id = auth.uid());

-- Policies for ebay_listing_refresh_items
CREATE POLICY "Users can view their own refresh items"
  ON ebay_listing_refresh_items FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "Users can create their own refresh items"
  ON ebay_listing_refresh_items FOR INSERT
  TO authenticated
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "Users can update their own refresh items"
  ON ebay_listing_refresh_items FOR UPDATE
  TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "Users can delete their own refresh items"
  ON ebay_listing_refresh_items FOR DELETE
  TO authenticated
  USING (user_id = auth.uid());

-- ----------------------------------------------------------------------------
-- Updated_at trigger
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION update_ebay_listing_refresh_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_ebay_listing_refreshes_updated_at
  BEFORE UPDATE ON ebay_listing_refreshes
  FOR EACH ROW
  EXECUTE FUNCTION update_ebay_listing_refresh_updated_at();

CREATE TRIGGER trigger_ebay_listing_refresh_items_updated_at
  BEFORE UPDATE ON ebay_listing_refresh_items
  FOR EACH ROW
  EXECUTE FUNCTION update_ebay_listing_refresh_updated_at();

-- ----------------------------------------------------------------------------
-- Comments
-- ----------------------------------------------------------------------------

COMMENT ON TABLE ebay_listing_refreshes IS 'Tracks eBay listing refresh operations (batch jobs)';
COMMENT ON TABLE ebay_listing_refresh_items IS 'Individual listings within a refresh operation with full audit trail';
COMMENT ON COLUMN ebay_listing_refreshes.review_mode IS 'true = user reviews items before ending, false = immediate processing';
COMMENT ON COLUMN ebay_listing_refresh_items.cached_listing_data IS 'Full listing JSON from GetItem for recreation';
