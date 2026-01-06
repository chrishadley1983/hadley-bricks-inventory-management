-- Migration: 20250105000001_order_fulfillment_tracking
-- Adds fields for order fulfillment workflow and inventory tracking

-- ============================================================================
-- INVENTORY ITEMS - Add fields for sold item tracking
-- ============================================================================

-- Archive location - where sold items are archived/stored for records
ALTER TABLE inventory_items ADD COLUMN IF NOT EXISTS archive_location TEXT;

-- Sold at timestamp - when the item was marked as sold
ALTER TABLE inventory_items ADD COLUMN IF NOT EXISTS sold_at TIMESTAMPTZ;

-- Returned from item - links to the original item if this was created from a refund
ALTER TABLE inventory_items ADD COLUMN IF NOT EXISTS returned_from_item_id UUID REFERENCES inventory_items(id);

-- ============================================================================
-- PLATFORM ORDERS - Add fulfillment tracking
-- ============================================================================

-- Fulfilled at timestamp - when the user confirmed the order was processed/picked
ALTER TABLE platform_orders ADD COLUMN IF NOT EXISTS fulfilled_at TIMESTAMPTZ;

-- ============================================================================
-- INDEXES for new fields
-- ============================================================================

-- Index for finding items by sold status
CREATE INDEX IF NOT EXISTS idx_inventory_sold_at ON inventory_items(user_id, sold_at) WHERE sold_at IS NOT NULL;

-- Index for finding returned items
CREATE INDEX IF NOT EXISTS idx_inventory_returned_from ON inventory_items(returned_from_item_id) WHERE returned_from_item_id IS NOT NULL;

-- Index for finding fulfilled orders
CREATE INDEX IF NOT EXISTS idx_orders_fulfilled_at ON platform_orders(user_id, fulfilled_at) WHERE fulfilled_at IS NOT NULL;

-- ============================================================================
-- COMMENTS for documentation
-- ============================================================================

COMMENT ON COLUMN inventory_items.archive_location IS 'Storage location after item is sold (e.g., "SOLD-2025-01" for monthly archives)';
COMMENT ON COLUMN inventory_items.sold_at IS 'Timestamp when item was marked as sold through order fulfillment';
COMMENT ON COLUMN inventory_items.returned_from_item_id IS 'If this item was created from a refund, references the original sold item';
COMMENT ON COLUMN platform_orders.fulfilled_at IS 'Timestamp when user confirmed the order was picked and processed';
