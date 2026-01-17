-- Migration: Track Applied Listing Optimiser Suggestions
-- Stores which suggestions have been applied to prevent AI from re-suggesting similar changes

-- ============================================================================
-- 1. Create listing_applied_suggestions table
-- ============================================================================

CREATE TABLE IF NOT EXISTS listing_applied_suggestions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  ebay_listing_id TEXT NOT NULL,
  category TEXT NOT NULL, -- 'title', 'description', 'itemSpecifics', 'condition', 'seo'
  field TEXT NOT NULL, -- specific field name
  original_value TEXT, -- what it was before
  applied_value TEXT NOT NULL, -- what we changed it to
  applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- Optional: link to the review that generated this suggestion
  review_id UUID REFERENCES listing_quality_reviews(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Add indexes for efficient queries
CREATE INDEX IF NOT EXISTS idx_listing_applied_suggestions_user
  ON listing_applied_suggestions(user_id);
CREATE INDEX IF NOT EXISTS idx_listing_applied_suggestions_listing
  ON listing_applied_suggestions(ebay_listing_id);
CREATE INDEX IF NOT EXISTS idx_listing_applied_suggestions_user_listing
  ON listing_applied_suggestions(user_id, ebay_listing_id);
CREATE INDEX IF NOT EXISTS idx_listing_applied_suggestions_category
  ON listing_applied_suggestions(ebay_listing_id, category);

-- ============================================================================
-- 2. Enable RLS
-- ============================================================================

ALTER TABLE listing_applied_suggestions ENABLE ROW LEVEL SECURITY;

-- Users can only see their own applied suggestions
CREATE POLICY "Users can view own applied suggestions"
  ON listing_applied_suggestions FOR SELECT
  USING (auth.uid() = user_id);

-- Users can insert their own applied suggestions
CREATE POLICY "Users can insert own applied suggestions"
  ON listing_applied_suggestions FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- Users can delete their own applied suggestions (to allow re-analysis)
CREATE POLICY "Users can delete own applied suggestions"
  ON listing_applied_suggestions FOR DELETE
  USING (auth.uid() = user_id);

-- ============================================================================
-- 3. Create function to get recent applied suggestions for a listing
-- ============================================================================

CREATE OR REPLACE FUNCTION get_listing_applied_suggestions(
  p_user_id UUID,
  p_listing_id TEXT,
  p_days_back INTEGER DEFAULT 30
)
RETURNS TABLE (
  category TEXT,
  field TEXT,
  applied_value TEXT,
  applied_at TIMESTAMPTZ
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    s.category,
    s.field,
    s.applied_value,
    s.applied_at
  FROM listing_applied_suggestions s
  WHERE s.user_id = p_user_id
    AND s.ebay_listing_id = p_listing_id
    AND s.applied_at > NOW() - (p_days_back || ' days')::INTERVAL
  ORDER BY s.applied_at DESC;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
