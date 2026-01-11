-- Amazon Feed Sync tables for managing price/quantity updates to Amazon
-- Migration: 20260115000001_amazon_feed_sync

-- ============================================================================
-- AMAZON SYNC QUEUE TABLE
-- Items pending sync to Amazon
-- ============================================================================
CREATE TABLE amazon_sync_queue (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,

  -- Source inventory reference
  inventory_item_id UUID NOT NULL REFERENCES inventory_items(id) ON DELETE CASCADE,

  -- Cached data at queue time (what user wants to sync)
  sku TEXT NOT NULL,                           -- Local SKU from inventory
  asin TEXT NOT NULL,                          -- Amazon ASIN
  local_price DECIMAL(10,2) NOT NULL,          -- Price from inventory listing_value
  local_quantity INTEGER NOT NULL DEFAULT 1,   -- Always 1 per inventory item

  -- Last known Amazon values (from platform_listings import)
  amazon_sku TEXT,                             -- Seller SKU from Amazon
  amazon_price DECIMAL(10,2),
  amazon_quantity INTEGER,

  -- Queue metadata
  added_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,

  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,

  -- Prevent duplicate queue entries per inventory item
  UNIQUE(user_id, inventory_item_id)
);

-- Indexes
CREATE INDEX idx_amazon_sync_queue_user ON amazon_sync_queue(user_id);
CREATE INDEX idx_amazon_sync_queue_added ON amazon_sync_queue(user_id, added_at DESC);
CREATE INDEX idx_amazon_sync_queue_asin ON amazon_sync_queue(user_id, asin);

-- ============================================================================
-- AMAZON SYNC FEEDS TABLE
-- Feed submission tracking
-- ============================================================================
CREATE TABLE amazon_sync_feeds (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,

  -- Amazon feed info
  amazon_feed_id TEXT,                         -- Feed ID returned by Amazon
  amazon_feed_document_id TEXT,                -- Feed document ID for upload
  amazon_result_document_id TEXT,              -- Result document ID after processing

  -- Submission details
  feed_type TEXT NOT NULL DEFAULT 'JSON_LISTINGS_FEED',
  is_dry_run BOOLEAN NOT NULL DEFAULT false,
  marketplace_id TEXT NOT NULL DEFAULT 'A1F83G8C2ARO7P',

  -- Status tracking
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN (
    'pending',              -- Not yet submitted
    'submitted',            -- Submitted to Amazon, awaiting processing
    'processing',           -- Amazon is processing
    'done',                 -- Amazon completed processing
    'cancelled',            -- Cancelled by Amazon
    'fatal',                -- Amazon returned fatal error
    'error',                -- Client-side error
    'processing_timeout'    -- Polling timed out after 15 minutes
  )),

  -- Counts
  total_items INTEGER NOT NULL DEFAULT 0,      -- Total unique ASINs submitted
  success_count INTEGER DEFAULT 0,
  warning_count INTEGER DEFAULT 0,
  error_count INTEGER DEFAULT 0,

  -- Timing
  submitted_at TIMESTAMPTZ,
  last_poll_at TIMESTAMPTZ,
  poll_count INTEGER DEFAULT 0,
  completed_at TIMESTAMPTZ,

  -- Error info
  error_message TEXT,
  error_details JSONB,

  -- Raw payloads for debugging
  request_payload JSONB,
  response_payload JSONB,
  result_payload JSONB,

  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

-- Indexes
CREATE INDEX idx_amazon_sync_feeds_user ON amazon_sync_feeds(user_id);
CREATE INDEX idx_amazon_sync_feeds_status ON amazon_sync_feeds(user_id, status);
CREATE INDEX idx_amazon_sync_feeds_created ON amazon_sync_feeds(user_id, created_at DESC);
CREATE INDEX idx_amazon_sync_feeds_amazon_feed_id ON amazon_sync_feeds(amazon_feed_id);

-- ============================================================================
-- AMAZON SYNC FEED ITEMS TABLE
-- Per-ASIN results for each feed
-- ============================================================================
CREATE TABLE amazon_sync_feed_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  feed_id UUID NOT NULL REFERENCES amazon_sync_feeds(id) ON DELETE CASCADE,

  -- Item identification
  asin TEXT NOT NULL,
  amazon_sku TEXT NOT NULL,                    -- Seller SKU used in feed

  -- What was submitted
  submitted_price DECIMAL(10,2) NOT NULL,
  submitted_quantity INTEGER NOT NULL,

  -- Which inventory items this ASIN represents (aggregated)
  inventory_item_ids UUID[] NOT NULL DEFAULT '{}',

  -- Result
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN (
    'pending',     -- Awaiting result
    'success',     -- Successfully updated
    'warning',     -- Updated with warnings
    'error'        -- Failed to update
  )),

  -- Amazon response details
  amazon_status TEXT,                          -- Amazon's status code
  amazon_result_code TEXT,                     -- ACCEPTED, WARNING, ERROR
  error_code TEXT,
  error_message TEXT,
  warnings JSONB,                              -- Array of warning messages
  error_details JSONB,

  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

-- Indexes
CREATE INDEX idx_amazon_sync_feed_items_feed ON amazon_sync_feed_items(feed_id);
CREATE INDEX idx_amazon_sync_feed_items_asin ON amazon_sync_feed_items(asin);
CREATE INDEX idx_amazon_sync_feed_items_status ON amazon_sync_feed_items(feed_id, status);

-- ============================================================================
-- ROW LEVEL SECURITY
-- ============================================================================
ALTER TABLE amazon_sync_queue ENABLE ROW LEVEL SECURITY;
ALTER TABLE amazon_sync_feeds ENABLE ROW LEVEL SECURITY;
ALTER TABLE amazon_sync_feed_items ENABLE ROW LEVEL SECURITY;

-- amazon_sync_queue policies
CREATE POLICY "Users can view own sync queue"
  ON amazon_sync_queue FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert to own sync queue"
  ON amazon_sync_queue FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own sync queue"
  ON amazon_sync_queue FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete from own sync queue"
  ON amazon_sync_queue FOR DELETE
  USING (auth.uid() = user_id);

-- amazon_sync_feeds policies
CREATE POLICY "Users can view own sync feeds"
  ON amazon_sync_feeds FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own sync feeds"
  ON amazon_sync_feeds FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own sync feeds"
  ON amazon_sync_feeds FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own sync feeds"
  ON amazon_sync_feeds FOR DELETE
  USING (auth.uid() = user_id);

-- amazon_sync_feed_items policies
CREATE POLICY "Users can view own feed items"
  ON amazon_sync_feed_items FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own feed items"
  ON amazon_sync_feed_items FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own feed items"
  ON amazon_sync_feed_items FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own feed items"
  ON amazon_sync_feed_items FOR DELETE
  USING (auth.uid() = user_id);

-- ============================================================================
-- UPDATED_AT TRIGGERS
-- ============================================================================
CREATE TRIGGER update_amazon_sync_queue_updated_at
  BEFORE UPDATE ON amazon_sync_queue
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_amazon_sync_feeds_updated_at
  BEFORE UPDATE ON amazon_sync_feeds
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_amazon_sync_feed_items_updated_at
  BEFORE UPDATE ON amazon_sync_feed_items
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();
