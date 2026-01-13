-- Repricing Cache Table
-- Stores cached Amazon pricing data for repricing feature
-- Cache invalidates after 3 hours or on manual sync

CREATE TABLE IF NOT EXISTS repricing_pricing_cache (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  asin TEXT NOT NULL,

  -- Competitive pricing data
  buy_box_price NUMERIC,
  buy_box_is_yours BOOLEAN DEFAULT FALSE,
  new_offer_count INTEGER,
  sales_rank INTEGER,
  sales_rank_category TEXT,

  -- Competitive summary data
  was_price NUMERIC,
  lowest_offer_price NUMERIC,
  lowest_offer_shipping NUMERIC,
  lowest_offer_condition TEXT,

  -- Metadata
  fetched_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Unique constraint per user per ASIN
  CONSTRAINT repricing_cache_user_asin_unique UNIQUE (user_id, asin)
);

-- Index for efficient lookups
CREATE INDEX idx_repricing_cache_user_id ON repricing_pricing_cache(user_id);
CREATE INDEX idx_repricing_cache_fetched_at ON repricing_pricing_cache(fetched_at);
CREATE INDEX idx_repricing_cache_user_asin ON repricing_pricing_cache(user_id, asin);

-- Enable RLS
ALTER TABLE repricing_pricing_cache ENABLE ROW LEVEL SECURITY;

-- RLS policies - users can only access their own cache data
CREATE POLICY "Users can view their own pricing cache"
  ON repricing_pricing_cache
  FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own pricing cache"
  ON repricing_pricing_cache
  FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own pricing cache"
  ON repricing_pricing_cache
  FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own pricing cache"
  ON repricing_pricing_cache
  FOR DELETE
  USING (auth.uid() = user_id);

-- Updated_at trigger
CREATE OR REPLACE FUNCTION update_repricing_cache_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_repricing_cache_updated_at
  BEFORE UPDATE ON repricing_pricing_cache
  FOR EACH ROW
  EXECUTE FUNCTION update_repricing_cache_updated_at();

-- Comment on table
COMMENT ON TABLE repricing_pricing_cache IS 'Cached Amazon pricing data for repricing feature. Cache duration: 3 hours.';
