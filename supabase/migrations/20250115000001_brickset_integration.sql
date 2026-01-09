-- Brickset API Integration
-- Migration: 20250115000001_brickset_integration
-- Purpose: Store Brickset set data as global cache and user API credentials

-- ============================================================================
-- BRICKSET SETS TABLE (Global cache - set data is universal)
-- ============================================================================
CREATE TABLE brickset_sets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Set identification
  set_number TEXT NOT NULL,
  variant INTEGER DEFAULT 1,
  brickset_id INTEGER,

  -- Basic info
  year_from INTEGER,
  category TEXT,
  theme TEXT,
  theme_group TEXT,
  subtheme TEXT,
  set_name TEXT NOT NULL,

  -- Images
  image_url TEXT,
  image_filename TEXT,

  -- Pricing (retail)
  us_retail_price DECIMAL(10,2),
  uk_retail_price DECIMAL(10,2),
  ca_retail_price DECIMAL(10,2),
  de_retail_price DECIMAL(10,2),

  -- Availability dates
  us_date_added DATE,
  us_date_removed DATE,

  -- Physical specs
  pieces INTEGER,
  minifigs INTEGER,
  packaging_type TEXT,
  availability TEXT,

  -- Item numbers and barcodes
  us_item_number TEXT,
  eu_item_number TEXT,
  ean TEXT,
  upc TEXT,

  -- Dimensions (in cm/g)
  width DECIMAL(8,2),
  height DECIMAL(8,2),
  depth DECIMAL(8,2),
  weight DECIMAL(8,2),

  -- Age range
  age_min INTEGER,
  age_max INTEGER,

  -- Community stats
  own_count INTEGER,
  want_count INTEGER,
  instructions_count INTEGER,
  additional_image_count INTEGER,

  -- Status
  released BOOLEAN DEFAULT false,
  rating DECIMAL(3,1),

  -- BrickLink price guide
  bricklink_sold_price_new DECIMAL(10,2),
  bricklink_sold_price_used DECIMAL(10,2),

  -- Additional data
  designers TEXT[],
  launch_date DATE,
  exit_date DATE,

  -- Full API response for audit
  raw_response JSONB,

  -- Cache metadata
  last_fetched_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,

  -- Unique constraint on set number
  UNIQUE(set_number)
);

-- ============================================================================
-- BRICKSET API CREDENTIALS TABLE (Per-user API key storage)
-- ============================================================================
CREATE TABLE brickset_api_credentials (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  api_key_encrypted BYTEA NOT NULL,
  last_used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  UNIQUE(user_id)
);

-- ============================================================================
-- INDEXES
-- ============================================================================

-- brickset_sets indexes
CREATE INDEX idx_brickset_sets_set_number ON brickset_sets(set_number);
CREATE INDEX idx_brickset_sets_theme ON brickset_sets(theme);
CREATE INDEX idx_brickset_sets_year ON brickset_sets(year_from);
CREATE INDEX idx_brickset_sets_theme_year ON brickset_sets(theme, year_from);
CREATE INDEX idx_brickset_sets_name ON brickset_sets USING gin(to_tsvector('english', set_name));
CREATE INDEX idx_brickset_sets_last_fetched ON brickset_sets(last_fetched_at);
CREATE INDEX idx_brickset_sets_brickset_id ON brickset_sets(brickset_id) WHERE brickset_id IS NOT NULL;

-- brickset_api_credentials indexes
CREATE INDEX idx_brickset_api_credentials_user ON brickset_api_credentials(user_id);

-- ============================================================================
-- UPDATED_AT TRIGGERS
-- ============================================================================
CREATE TRIGGER update_brickset_sets_updated_at
  BEFORE UPDATE ON brickset_sets
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_brickset_api_credentials_updated_at
  BEFORE UPDATE ON brickset_api_credentials
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- ============================================================================
-- ROW LEVEL SECURITY
-- ============================================================================

-- brickset_sets: Public read access (set data is universal)
ALTER TABLE brickset_sets ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can view Brickset sets"
  ON brickset_sets FOR SELECT
  USING (true);

-- Note: Inserts/updates to brickset_sets are done via service role (server-side only)
-- No user-specific write policies needed

-- brickset_api_credentials: User-specific access
ALTER TABLE brickset_api_credentials ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own Brickset credentials"
  ON brickset_api_credentials FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own Brickset credentials"
  ON brickset_api_credentials FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own Brickset credentials"
  ON brickset_api_credentials FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own Brickset credentials"
  ON brickset_api_credentials FOR DELETE
  USING (auth.uid() = user_id);

-- ============================================================================
-- COMMENTS
-- ============================================================================
COMMENT ON TABLE brickset_sets IS 'Global cache of LEGO set data from Brickset API';
COMMENT ON COLUMN brickset_sets.set_number IS 'Full set number including variant (e.g., 75192-1)';
COMMENT ON COLUMN brickset_sets.variant IS 'Set variant number (from numberVariant in API)';
COMMENT ON COLUMN brickset_sets.brickset_id IS 'Internal Brickset API set ID';
COMMENT ON COLUMN brickset_sets.last_fetched_at IS 'When data was last fetched from Brickset API (for cache TTL)';
COMMENT ON COLUMN brickset_sets.raw_response IS 'Complete API response for audit trail';

COMMENT ON TABLE brickset_api_credentials IS 'User Brickset API keys (encrypted)';
COMMENT ON COLUMN brickset_api_credentials.api_key_encrypted IS 'Encrypted API key using application encryption';
