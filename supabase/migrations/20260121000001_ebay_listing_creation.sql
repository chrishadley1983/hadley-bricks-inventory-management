-- ============================================
-- eBay Listing Creation Feature
-- ============================================
-- This migration adds support for the "Create eBay Listing" feature:
-- - Extends inventory_items with eBay listing fields
-- - Business policies cache for shipping/payment/return policies
-- - Listing creation audit trail
-- - Local drafts for error recovery

-- ============================================
-- 1. Extend inventory_items table
-- ============================================
ALTER TABLE inventory_items ADD COLUMN IF NOT EXISTS ebay_listing_id VARCHAR(50);
ALTER TABLE inventory_items ADD COLUMN IF NOT EXISTS ebay_listing_url VARCHAR(500);

-- Index for looking up items by eBay listing ID
CREATE INDEX IF NOT EXISTS idx_inventory_ebay_listing ON inventory_items(ebay_listing_id) WHERE ebay_listing_id IS NOT NULL;

-- ============================================
-- 2. Business Policies Cache Table
-- ============================================
-- Caches eBay business policies (fulfillment, payment, return) to avoid
-- repeated API calls. Policies are cached for 24 hours.
CREATE TABLE IF NOT EXISTS ebay_business_policies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  policy_type VARCHAR(20) NOT NULL CHECK (policy_type IN ('fulfillment', 'payment', 'return')),
  policy_id VARCHAR(50) NOT NULL,
  policy_name VARCHAR(200) NOT NULL,
  policy_data JSONB NOT NULL,
  is_default BOOLEAN DEFAULT FALSE,
  cached_at TIMESTAMPTZ DEFAULT NOW(),

  UNIQUE(user_id, policy_type, policy_id)
);

-- Enable RLS
ALTER TABLE ebay_business_policies ENABLE ROW LEVEL SECURITY;

-- RLS Policy: Users can only manage their own policies
CREATE POLICY "Users can manage own business policies" ON ebay_business_policies
  FOR ALL USING (auth.uid() = user_id);

-- Indexes
CREATE INDEX idx_ebay_business_policies_user ON ebay_business_policies(user_id);
CREATE INDEX idx_ebay_business_policies_user_type ON ebay_business_policies(user_id, policy_type);

-- ============================================
-- 3. Listing Creation Audit Table
-- ============================================
-- Full audit trail for listing creation operations including
-- AI generation metadata, quality scores, and error contexts.
CREATE TABLE IF NOT EXISTS listing_creation_audit (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  inventory_item_id UUID NOT NULL REFERENCES inventory_items(id) ON DELETE CASCADE,

  -- eBay listing details
  ebay_listing_id VARCHAR(50),
  ebay_offer_id VARCHAR(50),

  -- Operation details
  action VARCHAR(50) NOT NULL CHECK (action IN ('create_listing', 'update_listing', 'publish_listing', 'schedule_listing')),
  status VARCHAR(20) NOT NULL CHECK (status IN ('started', 'in_progress', 'completed', 'failed', 'cancelled')),

  -- Listing configuration
  listing_price DECIMAL(10,2),
  description_style VARCHAR(50) CHECK (description_style IN ('Minimalist', 'Standard', 'Professional', 'Friendly', 'Enthusiastic')),
  template_id UUID REFERENCES listing_templates(id) ON DELETE SET NULL,
  photos_enhanced BOOLEAN DEFAULT FALSE,
  photo_count INTEGER DEFAULT 0,
  listing_type VARCHAR(20) CHECK (listing_type IN ('draft', 'live', 'scheduled')),
  scheduled_date TIMESTAMPTZ,

  -- Best Offer configuration
  best_offer_enabled BOOLEAN DEFAULT TRUE,
  best_offer_auto_accept_percent INTEGER DEFAULT 95,
  best_offer_auto_decline_percent INTEGER DEFAULT 75,

  -- AI-generated content
  generated_title VARCHAR(100),
  generated_description TEXT,
  item_specifics JSONB,
  category_id VARCHAR(20),
  category_name VARCHAR(200),

  -- AI model information
  ai_model_used VARCHAR(50),
  ai_confidence_score INTEGER CHECK (ai_confidence_score >= 0 AND ai_confidence_score <= 100),
  ai_recommendations JSONB,
  ai_generation_time_ms INTEGER,

  -- Quality review (Gemini 3 Pro)
  quality_score INTEGER CHECK (quality_score >= 0 AND quality_score <= 100),
  quality_feedback JSONB,
  quality_review_time_ms INTEGER,

  -- Business policies used
  fulfillment_policy_id VARCHAR(50),
  payment_policy_id VARCHAR(50),
  return_policy_id VARCHAR(50),

  -- Research data sources
  research_sources JSONB, -- { brickset: {...}, bricklink: {...} }

  -- Error handling
  error_message TEXT,
  error_step VARCHAR(50),
  error_details JSONB,

  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);

-- Enable RLS
ALTER TABLE listing_creation_audit ENABLE ROW LEVEL SECURITY;

-- RLS Policy: Users can only view their own audit records
CREATE POLICY "Users can view own listing audits" ON listing_creation_audit
  FOR ALL USING (auth.uid() = user_id);

-- Indexes
CREATE INDEX idx_listing_creation_audit_user ON listing_creation_audit(user_id);
CREATE INDEX idx_listing_creation_audit_inventory ON listing_creation_audit(inventory_item_id);
CREATE INDEX idx_listing_creation_audit_user_created ON listing_creation_audit(user_id, created_at DESC);
CREATE INDEX idx_listing_creation_audit_status ON listing_creation_audit(status) WHERE status IN ('started', 'in_progress');

-- ============================================
-- 4. Local Drafts Table (Error Recovery)
-- ============================================
-- Stores draft listing data when creation fails, allowing users
-- to resume or edit and retry without losing their work.
CREATE TABLE IF NOT EXISTS listing_local_drafts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  inventory_item_id UUID NOT NULL REFERENCES inventory_items(id) ON DELETE CASCADE,

  -- Draft content (serialized form data)
  draft_data JSONB NOT NULL,

  -- Error context from failed attempt
  error_context JSONB,
  failed_audit_id UUID REFERENCES listing_creation_audit(id) ON DELETE SET NULL,

  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  -- Only one draft per inventory item per user
  UNIQUE(user_id, inventory_item_id)
);

-- Enable RLS
ALTER TABLE listing_local_drafts ENABLE ROW LEVEL SECURITY;

-- RLS Policy: Users can only manage their own drafts
CREATE POLICY "Users can manage own listing drafts" ON listing_local_drafts
  FOR ALL USING (auth.uid() = user_id);

-- Indexes
CREATE INDEX idx_listing_local_drafts_user ON listing_local_drafts(user_id);
CREATE INDEX idx_listing_local_drafts_inventory ON listing_local_drafts(inventory_item_id);

-- ============================================
-- 5. Updated At Trigger for Drafts
-- ============================================
CREATE TRIGGER listing_local_drafts_updated_at
  BEFORE UPDATE ON listing_local_drafts
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- ============================================
-- Comment on tables for documentation
-- ============================================
COMMENT ON TABLE ebay_business_policies IS 'Cache for eBay business policies (fulfillment, payment, return). TTL: 24 hours.';
COMMENT ON TABLE listing_creation_audit IS 'Audit trail for eBay listing creation operations including AI generation metadata and quality scores.';
COMMENT ON TABLE listing_local_drafts IS 'Stores draft listing data for error recovery. One draft per inventory item.';
