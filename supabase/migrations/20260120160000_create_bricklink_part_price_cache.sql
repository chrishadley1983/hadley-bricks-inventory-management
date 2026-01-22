-- Migration: create_bricklink_part_price_cache
-- Purpose: Cache BrickLink part prices to reduce API calls for partout value calculations

CREATE TABLE bricklink_part_price_cache (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  part_number VARCHAR(50) NOT NULL,
  part_type VARCHAR(20) NOT NULL DEFAULT 'PART',
  colour_id INTEGER NOT NULL,
  colour_name VARCHAR(100),
  price_new DECIMAL(10,4),
  price_used DECIMAL(10,4),
  sell_through_rate DECIMAL(5,2),
  stock_available INTEGER,
  times_sold INTEGER,
  fetched_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT bricklink_part_price_cache_unique_part_colour
    UNIQUE (part_number, colour_id)
);

-- Index for looking up by part number
CREATE INDEX idx_bricklink_part_price_cache_part
  ON bricklink_part_price_cache(part_number);

-- Index for finding stale cache entries
CREATE INDEX idx_bricklink_part_price_cache_fetched
  ON bricklink_part_price_cache(fetched_at);

-- RLS: Allow authenticated users to read/write cache (shared cache)
ALTER TABLE bricklink_part_price_cache ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read cache"
  ON bricklink_part_price_cache
  FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Authenticated users can insert cache"
  ON bricklink_part_price_cache
  FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY "Authenticated users can update cache"
  ON bricklink_part_price_cache
  FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);
