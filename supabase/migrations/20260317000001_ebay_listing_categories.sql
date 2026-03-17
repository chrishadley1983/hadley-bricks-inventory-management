-- ============================================================================
-- ebay_listing_categories: Store eBay item category and store category data
-- fetched from the Inventory API for audit/review purposes.
-- ============================================================================

CREATE TABLE IF NOT EXISTS ebay_listing_categories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  inventory_item_id UUID REFERENCES inventory_items(id) ON DELETE SET NULL,
  ebay_item_id TEXT,
  offer_id TEXT,
  sku TEXT,
  title TEXT,
  category_id TEXT,
  category_name TEXT,
  store_category_names TEXT[],
  last_synced_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Unique constraint on offer_id per user
CREATE UNIQUE INDEX idx_ebay_listing_categories_offer
  ON ebay_listing_categories (user_id, offer_id);

-- Index for looking up by inventory item
CREATE INDEX idx_ebay_listing_categories_inventory
  ON ebay_listing_categories (inventory_item_id);

-- Index for looking up by SKU
CREATE INDEX idx_ebay_listing_categories_sku
  ON ebay_listing_categories (user_id, sku);

-- RLS
ALTER TABLE ebay_listing_categories ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own ebay listing categories"
  ON ebay_listing_categories FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own ebay listing categories"
  ON ebay_listing_categories FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own ebay listing categories"
  ON ebay_listing_categories FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own ebay listing categories"
  ON ebay_listing_categories FOR DELETE
  USING (auth.uid() = user_id);

-- Updated_at trigger
CREATE TRIGGER set_updated_at
  BEFORE UPDATE ON ebay_listing_categories
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();
