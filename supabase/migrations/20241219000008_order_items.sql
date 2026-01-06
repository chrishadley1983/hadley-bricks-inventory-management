-- Order Items table for storing line items from platform orders
-- Migration: 20241219000003_order_items

-- ============================================================================
-- ORDER ITEMS TABLE
-- ============================================================================
CREATE TABLE order_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL REFERENCES platform_orders(id) ON DELETE CASCADE,
  item_number TEXT NOT NULL,
  item_name TEXT,
  item_type TEXT,
  color_id INTEGER,
  color_name TEXT,
  quantity INTEGER NOT NULL DEFAULT 1,
  condition TEXT CHECK (condition IN ('New', 'Used')),
  unit_price DECIMAL(10,2),
  total_price DECIMAL(10,2),
  currency TEXT DEFAULT 'GBP',
  -- Link to inventory item if matched
  inventory_item_id UUID REFERENCES inventory_items(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

-- ============================================================================
-- ADD ADDITIONAL COLUMNS TO PLATFORM_ORDERS
-- ============================================================================
ALTER TABLE platform_orders
ADD COLUMN IF NOT EXISTS buyer_email TEXT,
ADD COLUMN IF NOT EXISTS shipping_address JSONB,
ADD COLUMN IF NOT EXISTS tracking_number TEXT,
ADD COLUMN IF NOT EXISTS items_count INTEGER DEFAULT 0;

-- ============================================================================
-- INDEXES
-- ============================================================================
CREATE INDEX idx_order_items_order ON order_items(order_id);
CREATE INDEX idx_order_items_item_number ON order_items(item_number);
CREATE INDEX idx_order_items_inventory ON order_items(inventory_item_id) WHERE inventory_item_id IS NOT NULL;
CREATE INDEX idx_platform_orders_status ON platform_orders(user_id, status);

-- ============================================================================
-- RLS POLICIES FOR ORDER_ITEMS
-- ============================================================================
ALTER TABLE order_items ENABLE ROW LEVEL SECURITY;

-- Users can view order items for their own orders
CREATE POLICY "Users can view own order items"
  ON order_items FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM platform_orders
      WHERE platform_orders.id = order_items.order_id
      AND platform_orders.user_id = auth.uid()
    )
  );

-- Users can insert order items for their own orders
CREATE POLICY "Users can insert own order items"
  ON order_items FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM platform_orders
      WHERE platform_orders.id = order_items.order_id
      AND platform_orders.user_id = auth.uid()
    )
  );

-- Users can update order items for their own orders
CREATE POLICY "Users can update own order items"
  ON order_items FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM platform_orders
      WHERE platform_orders.id = order_items.order_id
      AND platform_orders.user_id = auth.uid()
    )
  );

-- Users can delete order items for their own orders
CREATE POLICY "Users can delete own order items"
  ON order_items FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM platform_orders
      WHERE platform_orders.id = order_items.order_id
      AND platform_orders.user_id = auth.uid()
    )
  );
