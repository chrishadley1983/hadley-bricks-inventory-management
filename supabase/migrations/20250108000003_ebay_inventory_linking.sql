-- eBay Inventory Linking Migration
-- Migration: 20250108000003_ebay_inventory_linking
-- Purpose: Add direct inventory linking to eBay orders and create resolution queue
-- Plan: docs/plans/ebay-inventory-linking-refactor.md

-- ============================================================================
-- 1. ADD INVENTORY LINKING TO EBAY ORDER LINE ITEMS
-- ============================================================================

ALTER TABLE ebay_order_line_items
  ADD COLUMN IF NOT EXISTS inventory_item_id UUID REFERENCES inventory_items(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS inventory_linked_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS inventory_link_method TEXT CHECK (inventory_link_method IN ('auto_sku', 'manual'));

CREATE INDEX IF NOT EXISTS idx_ebay_line_items_inventory_id
  ON ebay_order_line_items(inventory_item_id)
  WHERE inventory_item_id IS NOT NULL;

COMMENT ON COLUMN ebay_order_line_items.inventory_item_id IS 'FK to inventory_items - the inventory item sold in this line item';
COMMENT ON COLUMN ebay_order_line_items.inventory_linked_at IS 'When the inventory link was established';
COMMENT ON COLUMN ebay_order_line_items.inventory_link_method IS 'How the link was made: auto_sku (exact SKU match) or manual (user selected)';

-- ============================================================================
-- 2. ADD TRACKING FIELDS TO EBAY ORDERS
-- ============================================================================

ALTER TABLE ebay_orders
  ADD COLUMN IF NOT EXISTS inventory_linked_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS inventory_link_status TEXT CHECK (inventory_link_status IN ('pending', 'partial', 'complete', 'skipped'));

CREATE INDEX IF NOT EXISTS idx_ebay_orders_link_status
  ON ebay_orders(inventory_link_status)
  WHERE inventory_link_status IS NOT NULL;

COMMENT ON COLUMN ebay_orders.inventory_linked_at IS 'When all line items were linked to inventory';
COMMENT ON COLUMN ebay_orders.inventory_link_status IS 'Overall linking status: pending (not processed), partial (some linked), complete (all linked), skipped (user skipped)';

-- ============================================================================
-- 3. CREATE RESOLUTION QUEUE TABLE
-- For line items that couldn't be auto-linked and need user resolution
-- ============================================================================

CREATE TABLE IF NOT EXISTS ebay_inventory_resolution_queue (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,

  -- The line item that needs resolution
  ebay_line_item_id UUID NOT NULL REFERENCES ebay_order_line_items(id) ON DELETE CASCADE,
  ebay_order_id UUID NOT NULL REFERENCES ebay_orders(id) ON DELETE CASCADE,

  -- Snapshot of line item data for display (so we don't need joins for list view)
  sku TEXT,
  title TEXT NOT NULL,
  quantity INTEGER NOT NULL DEFAULT 1,
  total_amount DECIMAL(12,2) NOT NULL,
  order_date TIMESTAMPTZ NOT NULL,

  -- Resolution status
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'resolved', 'skipped', 'no_inventory')),
  resolution_reason TEXT NOT NULL CHECK (resolution_reason IN (
    'no_sku',              -- Line item has no SKU
    'no_matches',          -- SKU/title search found nothing
    'multiple_sku_matches', -- Multiple inventory items have same SKU
    'fuzzy_set_number',    -- No exact SKU, but set number extracted from title matched
    'fuzzy_title',         -- No exact SKU or set number, but title keywords matched
    'multi_quantity'       -- Quantity > 1 requires manual selection of multiple items
  )),

  -- Match candidates (JSON array of inventory items with scores)
  -- Format: [{ id: string, score: number, reasons: string[] }, ...]
  match_candidates JSONB,

  -- For multi-quantity: how many inventory items need to be selected
  quantity_needed INTEGER DEFAULT 1,

  -- Resolution outcome
  resolved_inventory_item_ids UUID[] DEFAULT '{}',  -- Array for multi-quantity support
  resolved_at TIMESTAMPTZ,
  resolved_by UUID REFERENCES profiles(id),

  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,

  UNIQUE(ebay_line_item_id)
);

-- Indexes for resolution queue
CREATE INDEX IF NOT EXISTS idx_resolution_queue_user_status
  ON ebay_inventory_resolution_queue(user_id, status);

CREATE INDEX IF NOT EXISTS idx_resolution_queue_order
  ON ebay_inventory_resolution_queue(ebay_order_id);

CREATE INDEX IF NOT EXISTS idx_resolution_queue_pending
  ON ebay_inventory_resolution_queue(user_id, created_at DESC)
  WHERE status = 'pending';

-- ============================================================================
-- 4. ADD NET SALE DETAIL FIELDS TO INVENTORY ITEMS
-- ============================================================================

ALTER TABLE inventory_items
  ADD COLUMN IF NOT EXISTS sold_gross_amount DECIMAL(12,2),
  ADD COLUMN IF NOT EXISTS sold_fees_amount DECIMAL(12,2),
  ADD COLUMN IF NOT EXISTS sold_postage_received DECIMAL(12,2),
  ADD COLUMN IF NOT EXISTS sold_net_amount DECIMAL(12,2),
  ADD COLUMN IF NOT EXISTS ebay_line_item_id UUID REFERENCES ebay_order_line_items(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_inventory_ebay_line_item
  ON inventory_items(ebay_line_item_id)
  WHERE ebay_line_item_id IS NOT NULL;

COMMENT ON COLUMN inventory_items.sold_gross_amount IS 'Gross sale amount (what buyer paid for item, excluding postage)';
COMMENT ON COLUMN inventory_items.sold_fees_amount IS 'Total platform fees (eBay final value fee, regulatory fee, etc.)';
COMMENT ON COLUMN inventory_items.sold_postage_received IS 'Postage amount received from buyer';
COMMENT ON COLUMN inventory_items.sold_net_amount IS 'Net sale amount after fees (gross - fees)';
COMMENT ON COLUMN inventory_items.ebay_line_item_id IS 'FK to ebay_order_line_items for eBay sales';

-- ============================================================================
-- 5. UPDATED_AT TRIGGER FOR RESOLUTION QUEUE
-- ============================================================================

CREATE TRIGGER update_ebay_inventory_resolution_queue_updated_at
  BEFORE UPDATE ON ebay_inventory_resolution_queue
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- ============================================================================
-- 6. ROW LEVEL SECURITY FOR RESOLUTION QUEUE
-- ============================================================================

ALTER TABLE ebay_inventory_resolution_queue ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own resolution queue items"
  ON ebay_inventory_resolution_queue FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own resolution queue items"
  ON ebay_inventory_resolution_queue FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own resolution queue items"
  ON ebay_inventory_resolution_queue FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own resolution queue items"
  ON ebay_inventory_resolution_queue FOR DELETE
  USING (auth.uid() = user_id);

-- ============================================================================
-- 7. COMMENTS
-- ============================================================================

COMMENT ON TABLE ebay_inventory_resolution_queue IS 'Queue of eBay order line items that could not be auto-linked to inventory and require user resolution';
