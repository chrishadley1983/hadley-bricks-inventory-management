-- ============================================================================
-- Phase 2: Brickset-Seeded ASIN Discovery
-- Migration: 20260112100001_seeded_asins_discovery.sql
--
-- Creates tables for discovering Amazon ASINs from Brickset set data using
-- EAN/UPC/title matching strategies.
-- ============================================================================

-- ============================================================================
-- SEEDED ASINS TABLE (Global - ASIN discovery is universal)
-- ============================================================================
CREATE TABLE seeded_asins (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  brickset_set_id UUID NOT NULL REFERENCES brickset_sets(id) ON DELETE CASCADE,

  -- Discovered ASIN (nullable until found)
  asin VARCHAR(10),

  -- Discovery status
  discovery_status VARCHAR(20) NOT NULL DEFAULT 'pending'
    CHECK (discovery_status IN ('pending', 'found', 'not_found', 'multiple', 'excluded')),

  -- Match details
  match_method VARCHAR(20) CHECK (match_method IN ('ean', 'upc', 'title_exact', 'title_fuzzy')),
  match_confidence INTEGER CHECK (match_confidence >= 0 AND match_confidence <= 100),

  -- Amazon product details (populated on discovery)
  amazon_title VARCHAR(500),
  amazon_price DECIMAL(10,2),
  amazon_image_url VARCHAR(1000),
  amazon_brand VARCHAR(100),

  -- Multiple ASIN handling (when status = 'multiple')
  alternative_asins JSONB,

  -- Discovery job tracking
  last_discovery_attempt_at TIMESTAMPTZ,
  discovery_attempts INTEGER DEFAULT 0,
  discovery_error TEXT,

  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,

  -- Constraints
  UNIQUE(brickset_set_id)
);

-- Partial unique constraint: only one seeded record per ASIN (when found)
CREATE UNIQUE INDEX idx_seeded_asins_asin_unique ON seeded_asins(asin) WHERE asin IS NOT NULL;

COMMENT ON TABLE seeded_asins IS 'ASINs discovered from Brickset set data using EAN/UPC/title matching';
COMMENT ON COLUMN seeded_asins.discovery_status IS 'pending=not yet searched, found=ASIN discovered, not_found=no match, multiple=multiple ASINs found (needs review), excluded=manually excluded';
COMMENT ON COLUMN seeded_asins.match_confidence IS '100=EAN match, 95=UPC match, 85=exact title match, 60-80=fuzzy title match';

-- ============================================================================
-- USER SEEDED ASIN PREFERENCES (User-scoped sync preferences)
-- ============================================================================
CREATE TABLE user_seeded_asin_preferences (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  seeded_asin_id UUID NOT NULL REFERENCES seeded_asins(id) ON DELETE CASCADE,

  -- User preference
  include_in_sync BOOLEAN NOT NULL DEFAULT false,

  -- Override status (user can exclude even if globally found)
  user_status VARCHAR(20) DEFAULT 'active' CHECK (user_status IN ('active', 'excluded')),
  exclusion_reason VARCHAR(500),
  excluded_at TIMESTAMPTZ,

  -- Manual ASIN override (if user knows the correct ASIN)
  manual_asin_override VARCHAR(10),

  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,

  UNIQUE(user_id, seeded_asin_id)
);

COMMENT ON TABLE user_seeded_asin_preferences IS 'Per-user preferences for which seeded ASINs to include in sync';

-- ============================================================================
-- INDEXES
-- ============================================================================

-- seeded_asins indexes
CREATE INDEX idx_seeded_asins_status ON seeded_asins(discovery_status);
CREATE INDEX idx_seeded_asins_confidence ON seeded_asins(match_confidence DESC) WHERE discovery_status = 'found';
CREATE INDEX idx_seeded_asins_pending ON seeded_asins(last_discovery_attempt_at) WHERE discovery_status IN ('pending', 'not_found');
CREATE INDEX idx_seeded_asins_brickset ON seeded_asins(brickset_set_id);

-- user_seeded_asin_preferences indexes
CREATE INDEX idx_user_seeded_prefs_user ON user_seeded_asin_preferences(user_id);
CREATE INDEX idx_user_seeded_prefs_sync ON user_seeded_asin_preferences(user_id, include_in_sync) WHERE include_in_sync = true;
CREATE INDEX idx_user_seeded_prefs_seeded ON user_seeded_asin_preferences(seeded_asin_id);

-- ============================================================================
-- TRIGGERS
-- ============================================================================
CREATE TRIGGER update_seeded_asins_updated_at
  BEFORE UPDATE ON seeded_asins
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_user_seeded_asin_preferences_updated_at
  BEFORE UPDATE ON user_seeded_asin_preferences
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- ============================================================================
-- ROW LEVEL SECURITY
-- ============================================================================
ALTER TABLE seeded_asins ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_seeded_asin_preferences ENABLE ROW LEVEL SECURITY;

-- seeded_asins: Global read (authenticated users), service role write
CREATE POLICY "Authenticated users can view seeded ASINs"
  ON seeded_asins FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Service role can manage seeded ASINs"
  ON seeded_asins FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- user_seeded_asin_preferences: User-scoped CRUD
CREATE POLICY "Users can view own seeded ASIN preferences"
  ON user_seeded_asin_preferences FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own seeded ASIN preferences"
  ON user_seeded_asin_preferences FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own seeded ASIN preferences"
  ON user_seeded_asin_preferences FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own seeded ASIN preferences"
  ON user_seeded_asin_preferences FOR DELETE
  USING (auth.uid() = user_id);

-- ============================================================================
-- UPDATE ARBITRAGE SYNC STATUS JOB TYPES
-- ============================================================================

-- Drop the existing constraint
ALTER TABLE arbitrage_sync_status
  DROP CONSTRAINT IF EXISTS arbitrage_sync_status_job_type_check;

-- Add the updated constraint with seeded_discovery
ALTER TABLE arbitrage_sync_status
  ADD CONSTRAINT arbitrage_sync_status_job_type_check
  CHECK (job_type IN (
    'inventory_asins',
    'amazon_pricing',
    'bricklink_pricing',
    'asin_mapping',
    'ebay_pricing',
    'seeded_discovery'
  ));

-- ============================================================================
-- HELPER FUNCTION: Initialize seeded_asins from brickset_sets
-- ============================================================================
CREATE OR REPLACE FUNCTION initialize_seeded_asins()
RETURNS TABLE(created_count INTEGER, skipped_count INTEGER)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_created INTEGER := 0;
  v_skipped INTEGER := 0;
BEGIN
  -- Insert new seeded_asins for brickset_sets that don't have one yet
  -- Only include sets from 2010+ (year_from >= 2010)
  WITH inserted AS (
    INSERT INTO seeded_asins (brickset_set_id)
    SELECT bs.id
    FROM brickset_sets bs
    LEFT JOIN seeded_asins sa ON bs.id = sa.brickset_set_id
    WHERE sa.id IS NULL
      AND bs.year_from >= 2010
    RETURNING id
  )
  SELECT COUNT(*) INTO v_created FROM inserted;

  -- Count how many were skipped (already exist)
  SELECT COUNT(*) INTO v_skipped
  FROM brickset_sets bs
  INNER JOIN seeded_asins sa ON bs.id = sa.brickset_set_id
  WHERE bs.year_from >= 2010;

  RETURN QUERY SELECT v_created, v_skipped;
END;
$$;

COMMENT ON FUNCTION initialize_seeded_asins() IS 'Initializes seeded_asins table from brickset_sets for sets from 2010+. Returns count of created and skipped records.';

-- ============================================================================
-- VIEW: Seeded ASIN Discovery Status Summary
-- ============================================================================
CREATE OR REPLACE VIEW seeded_discovery_summary AS
SELECT
  COUNT(*) FILTER (WHERE discovery_status = 'pending') as pending_count,
  COUNT(*) FILTER (WHERE discovery_status = 'found') as found_count,
  COUNT(*) FILTER (WHERE discovery_status = 'not_found') as not_found_count,
  COUNT(*) FILTER (WHERE discovery_status = 'multiple') as multiple_count,
  COUNT(*) FILTER (WHERE discovery_status = 'excluded') as excluded_count,
  COUNT(*) as total_count,
  ROUND(
    COUNT(*) FILTER (WHERE discovery_status = 'found')::DECIMAL /
    NULLIF(COUNT(*), 0) * 100,
    1
  ) as found_percent,
  AVG(match_confidence) FILTER (WHERE discovery_status = 'found') as avg_confidence,
  MAX(last_discovery_attempt_at) as last_discovery_at
FROM seeded_asins;

COMMENT ON VIEW seeded_discovery_summary IS 'Summary statistics for seeded ASIN discovery progress';

-- ============================================================================
-- VIEW: User Seeded ASINs for Arbitrage
-- Returns seeded ASINs with brickset data for users who have enabled them
-- ============================================================================
CREATE OR REPLACE VIEW user_seeded_arbitrage_items AS
SELECT
  p.user_id,
  sa.id as seeded_asin_id,
  COALESCE(p.manual_asin_override, sa.asin) as asin,
  bs.id as brickset_set_id,
  bs.set_number as bricklink_set_number,
  bs.set_name,
  bs.theme as brickset_theme,
  bs.year_from as brickset_year,
  bs.uk_retail_price as brickset_rrp,
  bs.pieces as brickset_pieces,
  COALESCE(sa.amazon_image_url, bs.image_url) as image_url,
  COALESCE(sa.amazon_title, bs.set_name) as name,
  sa.match_method,
  sa.match_confidence,
  sa.discovery_status,
  p.include_in_sync,
  p.user_status
FROM seeded_asins sa
INNER JOIN brickset_sets bs ON sa.brickset_set_id = bs.id
INNER JOIN user_seeded_asin_preferences p ON sa.id = p.seeded_asin_id
WHERE sa.discovery_status = 'found'
  AND sa.asin IS NOT NULL
  AND p.include_in_sync = true
  AND p.user_status = 'active';

COMMENT ON VIEW user_seeded_arbitrage_items IS 'User-scoped seeded ASINs ready for arbitrage sync (found, enabled, active)';
