-- ============================================
-- Listing Assistant Database Schema
-- ============================================
-- This migration creates tables for the eBay Listing Assistant feature:
-- - listing_templates: Store HTML templates for eBay listings
-- - generated_listings: Store AI-generated listings with inventory links
-- - listing_assistant_settings: User preferences

-- ============================================
-- Listing Templates Table
-- ============================================
CREATE TABLE listing_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  name VARCHAR(100) NOT NULL,
  content TEXT NOT NULL,
  type VARCHAR(20) NOT NULL DEFAULT 'custom',
  is_default BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  CONSTRAINT listing_templates_type_check CHECK (type IN ('lego_used', 'lego_new', 'general', 'custom'))
);

-- Enable RLS
ALTER TABLE listing_templates ENABLE ROW LEVEL SECURITY;

-- RLS Policy: Users can only manage their own templates
CREATE POLICY "Users can manage own templates" ON listing_templates
  FOR ALL USING (auth.uid() = user_id);

-- Index for user lookups
CREATE INDEX idx_listing_templates_user ON listing_templates(user_id);

-- ============================================
-- Generated Listings Table
-- ============================================
CREATE TABLE generated_listings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  inventory_item_id UUID REFERENCES inventory_items(id) ON DELETE SET NULL,
  item_name VARCHAR(255) NOT NULL,
  condition VARCHAR(10) NOT NULL,
  title VARCHAR(255) NOT NULL,
  price_range VARCHAR(50),
  description TEXT NOT NULL,
  template_id UUID REFERENCES listing_templates(id) ON DELETE SET NULL,
  source_urls TEXT[],
  ebay_sold_data JSONB,
  status VARCHAR(20) DEFAULT 'draft',
  created_at TIMESTAMPTZ DEFAULT NOW(),

  CONSTRAINT generated_listings_condition_check CHECK (condition IN ('New', 'Used')),
  CONSTRAINT generated_listings_status_check CHECK (status IN ('draft', 'ready', 'listed', 'sold'))
);

-- Enable RLS
ALTER TABLE generated_listings ENABLE ROW LEVEL SECURITY;

-- RLS Policy: Users can only manage their own listings
CREATE POLICY "Users can manage own listings" ON generated_listings
  FOR ALL USING (auth.uid() = user_id);

-- Indexes for common queries
CREATE INDEX idx_generated_listings_user ON generated_listings(user_id);
CREATE INDEX idx_generated_listings_inventory ON generated_listings(inventory_item_id);
CREATE INDEX idx_generated_listings_status ON generated_listings(status);
CREATE INDEX idx_generated_listings_user_created ON generated_listings(user_id, created_at DESC);

-- ============================================
-- Listing Assistant Settings Table
-- ============================================
CREATE TABLE listing_assistant_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE UNIQUE,
  default_tone VARCHAR(20) DEFAULT 'Minimalist',
  default_condition VARCHAR(10) DEFAULT 'Used',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  CONSTRAINT listing_assistant_settings_tone_check CHECK (default_tone IN ('Standard', 'Professional', 'Enthusiastic', 'Friendly', 'Minimalist')),
  CONSTRAINT listing_assistant_settings_condition_check CHECK (default_condition IN ('New', 'Used'))
);

-- Enable RLS
ALTER TABLE listing_assistant_settings ENABLE ROW LEVEL SECURITY;

-- RLS Policy: Users can only manage their own settings
CREATE POLICY "Users can manage own settings" ON listing_assistant_settings
  FOR ALL USING (auth.uid() = user_id);

-- ============================================
-- Updated At Trigger Function
-- ============================================
CREATE OR REPLACE FUNCTION update_listing_assistant_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Apply trigger to listing_templates
CREATE TRIGGER listing_templates_updated_at
  BEFORE UPDATE ON listing_templates
  FOR EACH ROW
  EXECUTE FUNCTION update_listing_assistant_updated_at();

-- Apply trigger to listing_assistant_settings
CREATE TRIGGER listing_assistant_settings_updated_at
  BEFORE UPDATE ON listing_assistant_settings
  FOR EACH ROW
  EXECUTE FUNCTION update_listing_assistant_updated_at();
