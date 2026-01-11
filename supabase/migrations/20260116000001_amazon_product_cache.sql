-- Amazon Product Cache for Catalog Items API responses
-- Caches product type and metadata for ASINs to avoid repeated API calls
-- TTL: 180 days (product types rarely change)

CREATE TABLE amazon_product_cache (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,

  -- ASIN identification
  asin TEXT NOT NULL,
  marketplace_id TEXT NOT NULL DEFAULT 'A1F83G8C2ARO7P',

  -- Cached product data
  product_type TEXT,                -- e.g., 'TOY', 'BUILDING_BLOCKS'
  title TEXT,                       -- Product title for display
  brand TEXT,                       -- Brand name

  -- Cache metadata
  fetched_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Full API response for debugging/future use
  raw_response JSONB,

  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,

  -- Unique per user/ASIN/marketplace combination
  UNIQUE(user_id, asin, marketplace_id)
);

-- Indexes
CREATE INDEX idx_amazon_product_cache_user ON amazon_product_cache(user_id);
CREATE INDEX idx_amazon_product_cache_asin ON amazon_product_cache(user_id, asin);
CREATE INDEX idx_amazon_product_cache_fetched ON amazon_product_cache(fetched_at);

-- RLS
ALTER TABLE amazon_product_cache ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own product cache"
  ON amazon_product_cache FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own product cache"
  ON amazon_product_cache FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own product cache"
  ON amazon_product_cache FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own product cache"
  ON amazon_product_cache FOR DELETE USING (auth.uid() = user_id);

-- Updated at trigger
CREATE TRIGGER update_amazon_product_cache_updated_at
  BEFORE UPDATE ON amazon_product_cache
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Add product_type column to existing amazon_sync_queue table
ALTER TABLE amazon_sync_queue ADD COLUMN IF NOT EXISTS product_type TEXT;
COMMENT ON COLUMN amazon_sync_queue.product_type IS 'Product type from Catalog API, cached at queue time';
