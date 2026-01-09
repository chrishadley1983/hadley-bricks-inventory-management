-- Amazon Inventory Linking Migration
-- Migration: 20250114000001_amazon_inventory_linking
-- Purpose: Add inventory linking support for Amazon orders and create resolution queue
-- Plan: docs/plans/amazon-inventory-linking.md

-- ============================================================================
-- 1. ADD INVENTORY LINKING TRACKING TO ORDER_ITEMS
-- ============================================================================

ALTER TABLE order_items
  ADD COLUMN IF NOT EXISTS amazon_linked_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS amazon_link_method TEXT CHECK (amazon_link_method IN ('auto_picklist', 'auto_asin', 'manual'));

COMMENT ON COLUMN order_items.amazon_linked_at IS 'When the Amazon inventory linking was completed';
COMMENT ON COLUMN order_items.amazon_link_method IS 'How the link was made: auto_picklist (from fulfillment), auto_asin (ASIN match), manual (user selected)';

-- ============================================================================
-- 2. ADD LINK STATUS TO PLATFORM_ORDERS
-- ============================================================================

ALTER TABLE platform_orders
  ADD COLUMN IF NOT EXISTS inventory_link_status TEXT CHECK (inventory_link_status IN ('pending', 'partial', 'complete', 'skipped'));

CREATE INDEX IF NOT EXISTS idx_platform_orders_link_status
  ON platform_orders(user_id, inventory_link_status, platform)
  WHERE inventory_link_status IS NOT NULL;

COMMENT ON COLUMN platform_orders.inventory_link_status IS 'Overall inventory linking status for this order';

-- ============================================================================
-- 3. ADD AMAZON ORDER ITEM REFERENCE TO INVENTORY_ITEMS
-- ============================================================================

ALTER TABLE inventory_items
  ADD COLUMN IF NOT EXISTS amazon_order_item_id UUID REFERENCES order_items(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_inventory_amazon_order_item
  ON inventory_items(amazon_order_item_id)
  WHERE amazon_order_item_id IS NOT NULL;

COMMENT ON COLUMN inventory_items.amazon_order_item_id IS 'FK to order_items for Amazon sales';

-- ============================================================================
-- 4. CREATE AMAZON RESOLUTION QUEUE TABLE
-- ============================================================================

CREATE TABLE IF NOT EXISTS amazon_inventory_resolution_queue (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,

  -- The order item that needs resolution
  order_item_id UUID NOT NULL REFERENCES order_items(id) ON DELETE CASCADE,
  platform_order_id UUID NOT NULL REFERENCES platform_orders(id) ON DELETE CASCADE,

  -- Snapshot of order item data for display (so we don't need joins for list view)
  asin TEXT,
  item_name TEXT NOT NULL,
  quantity INTEGER NOT NULL DEFAULT 1,
  total_amount DECIMAL(12,2) NOT NULL,
  order_date TIMESTAMPTZ NOT NULL,
  amazon_order_id TEXT NOT NULL,

  -- Resolution status
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'resolved', 'skipped', 'no_inventory')),
  resolution_reason TEXT NOT NULL CHECK (resolution_reason IN (
    'no_asin',                 -- Order item has no ASIN
    'no_matches',              -- ASIN search found nothing
    'insufficient_inventory',  -- Not enough inventory for quantity
    'already_linked',          -- Inventory item already linked to another order
    'multiple_asin_matches',   -- Multiple inventory items have same ASIN (requires selection)
    'picklist_mismatch'        -- Picklist linked item not matching expected ASIN
  )),

  -- Match candidates (JSON array of inventory items with scores)
  -- Format: [{ id: string, score: number, reasons: string[] }, ...]
  match_candidates JSONB,

  -- For multi-quantity: how many inventory items need to be selected
  quantity_needed INTEGER DEFAULT 1,

  -- Resolution outcome
  resolved_inventory_item_ids UUID[] DEFAULT '{}',
  resolved_at TIMESTAMPTZ,
  resolved_by UUID REFERENCES profiles(id),

  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,

  UNIQUE(order_item_id)
);

-- Indexes for resolution queue
CREATE INDEX IF NOT EXISTS idx_amazon_resolution_queue_user_status
  ON amazon_inventory_resolution_queue(user_id, status);

CREATE INDEX IF NOT EXISTS idx_amazon_resolution_queue_order
  ON amazon_inventory_resolution_queue(platform_order_id);

CREATE INDEX IF NOT EXISTS idx_amazon_resolution_queue_pending
  ON amazon_inventory_resolution_queue(user_id, created_at DESC)
  WHERE status = 'pending';

-- ============================================================================
-- 5. UPDATED_AT TRIGGER
-- ============================================================================

CREATE TRIGGER update_amazon_inventory_resolution_queue_updated_at
  BEFORE UPDATE ON amazon_inventory_resolution_queue
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- ============================================================================
-- 6. ROW LEVEL SECURITY
-- ============================================================================

ALTER TABLE amazon_inventory_resolution_queue ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own Amazon resolution queue items"
  ON amazon_inventory_resolution_queue FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own Amazon resolution queue items"
  ON amazon_inventory_resolution_queue FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own Amazon resolution queue items"
  ON amazon_inventory_resolution_queue FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own Amazon resolution queue items"
  ON amazon_inventory_resolution_queue FOR DELETE
  USING (auth.uid() = user_id);

COMMENT ON TABLE amazon_inventory_resolution_queue IS 'Queue of Amazon order items that could not be auto-linked to inventory and require user resolution';
