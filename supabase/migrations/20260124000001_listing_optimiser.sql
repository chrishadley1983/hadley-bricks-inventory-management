-- Migration: Listing Optimiser Feature
-- Creates table for storing listing quality reviews and adds summary columns to platform_listings

-- ============================================================================
-- 1. Create listing_quality_reviews table for historical analysis records
-- ============================================================================

CREATE TABLE IF NOT EXISTS listing_quality_reviews (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  ebay_listing_id TEXT NOT NULL,
  quality_score INTEGER NOT NULL CHECK (quality_score >= 0 AND quality_score <= 100),
  quality_grade TEXT NOT NULL CHECK (quality_grade IN ('A+', 'A', 'B', 'C', 'D', 'F')),
  breakdown JSONB NOT NULL,
  suggestions JSONB,
  pricing_analysis JSONB,
  reviewed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Add indexes for efficient queries
CREATE INDEX IF NOT EXISTS idx_listing_quality_reviews_user
  ON listing_quality_reviews(user_id);
CREATE INDEX IF NOT EXISTS idx_listing_quality_reviews_listing
  ON listing_quality_reviews(ebay_listing_id);
CREATE INDEX IF NOT EXISTS idx_listing_quality_reviews_date
  ON listing_quality_reviews(reviewed_at DESC);
CREATE INDEX IF NOT EXISTS idx_listing_quality_reviews_user_listing
  ON listing_quality_reviews(user_id, ebay_listing_id);

-- ============================================================================
-- 2. Add summary columns to platform_listings for quick access
-- ============================================================================

ALTER TABLE platform_listings
  ADD COLUMN IF NOT EXISTS last_reviewed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_updated_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS quality_score INTEGER CHECK (quality_score >= 0 AND quality_score <= 100),
  ADD COLUMN IF NOT EXISTS quality_grade TEXT CHECK (quality_grade IS NULL OR quality_grade IN ('A+', 'A', 'B', 'C', 'D', 'F'));

-- Add index for filtering by quality score
CREATE INDEX IF NOT EXISTS idx_platform_listings_quality_score
  ON platform_listings(quality_score) WHERE quality_score IS NOT NULL;

-- ============================================================================
-- 3. Enable RLS on listing_quality_reviews
-- ============================================================================

ALTER TABLE listing_quality_reviews ENABLE ROW LEVEL SECURITY;

-- Users can only see their own reviews
CREATE POLICY "Users can view own listing quality reviews"
  ON listing_quality_reviews FOR SELECT
  USING (auth.uid() = user_id);

-- Users can insert their own reviews
CREATE POLICY "Users can insert own listing quality reviews"
  ON listing_quality_reviews FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- Users can update their own reviews
CREATE POLICY "Users can update own listing quality reviews"
  ON listing_quality_reviews FOR UPDATE
  USING (auth.uid() = user_id);

-- Users can delete their own reviews
CREATE POLICY "Users can delete own listing quality reviews"
  ON listing_quality_reviews FOR DELETE
  USING (auth.uid() = user_id);

-- ============================================================================
-- 4. Create function to get latest review for a listing
-- ============================================================================

CREATE OR REPLACE FUNCTION get_latest_listing_review(p_user_id UUID, p_listing_id TEXT)
RETURNS TABLE (
  id UUID,
  quality_score INTEGER,
  quality_grade TEXT,
  breakdown JSONB,
  suggestions JSONB,
  pricing_analysis JSONB,
  reviewed_at TIMESTAMPTZ
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    r.id,
    r.quality_score,
    r.quality_grade,
    r.breakdown,
    r.suggestions,
    r.pricing_analysis,
    r.reviewed_at
  FROM listing_quality_reviews r
  WHERE r.user_id = p_user_id
    AND r.ebay_listing_id = p_listing_id
  ORDER BY r.reviewed_at DESC
  LIMIT 1;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================================
-- 5. Create function to get listing optimiser summary stats
-- ============================================================================

CREATE OR REPLACE FUNCTION get_listing_optimiser_summary(p_user_id UUID)
RETURNS TABLE (
  total_listings BIGINT,
  reviewed_count BIGINT,
  average_score NUMERIC,
  low_score_count BIGINT
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    COUNT(*)::BIGINT as total_listings,
    COUNT(*) FILTER (WHERE quality_score IS NOT NULL)::BIGINT as reviewed_count,
    ROUND(AVG(quality_score) FILTER (WHERE quality_score IS NOT NULL), 1) as average_score,
    COUNT(*) FILTER (WHERE quality_score IS NOT NULL AND quality_score < 70)::BIGINT as low_score_count
  FROM platform_listings
  WHERE user_id = p_user_id
    AND platform = 'ebay'
    AND status = 'active';
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
