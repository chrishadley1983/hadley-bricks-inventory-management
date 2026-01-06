-- eBay SKU Mappings and Inventory Extensions
-- Migration: 20241224000002_ebay_sku_mappings
-- Specification: eBay Orders Display & Picking List Feature Specification v1.0

-- ============================================================================
-- EBAY SKU MAPPINGS TABLE (Manual SKU to Inventory mappings)
-- ============================================================================
CREATE TABLE IF NOT EXISTS ebay_sku_mappings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  ebay_sku TEXT NOT NULL,
  inventory_item_id UUID NOT NULL REFERENCES inventory_items(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT ebay_sku_mappings_user_sku_unique UNIQUE(user_id, ebay_sku)
);

-- ============================================================================
-- INDEXES
-- ============================================================================
CREATE INDEX IF NOT EXISTS idx_ebay_sku_mappings_user ON ebay_sku_mappings(user_id);
CREATE INDEX IF NOT EXISTS idx_ebay_sku_mappings_sku ON ebay_sku_mappings(ebay_sku);
CREATE INDEX IF NOT EXISTS idx_ebay_sku_mappings_inventory ON ebay_sku_mappings(inventory_item_id);

-- ============================================================================
-- UPDATED_AT TRIGGER
-- ============================================================================
CREATE TRIGGER update_ebay_sku_mappings_updated_at
  BEFORE UPDATE ON ebay_sku_mappings
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- ============================================================================
-- ROW LEVEL SECURITY
-- ============================================================================
ALTER TABLE ebay_sku_mappings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own SKU mappings"
  ON ebay_sku_mappings FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own SKU mappings"
  ON ebay_sku_mappings FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own SKU mappings"
  ON ebay_sku_mappings FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own SKU mappings"
  ON ebay_sku_mappings FOR DELETE
  USING (auth.uid() = user_id);

-- ============================================================================
-- INVENTORY ITEMS EXTENSIONS (Add sold tracking columns)
-- ============================================================================
ALTER TABLE inventory_items
ADD COLUMN IF NOT EXISTS sold_date TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS sold_price DECIMAL(12,2),
ADD COLUMN IF NOT EXISTS sold_platform TEXT,
ADD COLUMN IF NOT EXISTS sold_order_id TEXT;

-- Create index for sold items query optimization
CREATE INDEX IF NOT EXISTS idx_inventory_sold_date ON inventory_items(user_id, sold_date DESC) WHERE sold_date IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_inventory_sold_platform ON inventory_items(user_id, sold_platform) WHERE sold_platform IS NOT NULL;
