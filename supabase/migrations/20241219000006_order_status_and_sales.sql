-- Order Status History and Sales Tables
-- Migration: 20241219000006_order_status_and_sales

-- ============================================================================
-- ORDER STATUS HISTORY TABLE
-- Tracks status changes for audit trail and workflow management
-- ============================================================================
CREATE TABLE order_status_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL REFERENCES platform_orders(id) ON DELETE CASCADE,
  status TEXT NOT NULL,
  previous_status TEXT,
  changed_by TEXT DEFAULT 'system', -- 'system' for auto-sync, 'user' for manual
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

-- ============================================================================
-- SALES TABLE
-- Records completed sales with profit calculation
-- ============================================================================
CREATE TABLE sales (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,

  -- Link to source (optional - can be linked order or manual entry)
  order_id UUID REFERENCES platform_orders(id) ON DELETE SET NULL,

  -- Sale details
  sale_date DATE NOT NULL,
  platform TEXT, -- 'bricklink', 'brickowl', 'bricqer', 'ebay', 'amazon', 'manual', etc.
  platform_order_id TEXT, -- external order ID for reference

  -- Financial details
  sale_amount DECIMAL(10,2) NOT NULL, -- gross sale amount
  shipping_charged DECIMAL(10,2) DEFAULT 0, -- shipping charged to buyer
  shipping_cost DECIMAL(10,2) DEFAULT 0, -- actual shipping cost
  platform_fees DECIMAL(10,2) DEFAULT 0, -- platform/payment fees
  other_costs DECIMAL(10,2) DEFAULT 0, -- packaging, supplies, etc.

  -- Calculated fields (stored for query performance)
  net_revenue DECIMAL(10,2) GENERATED ALWAYS AS (
    sale_amount + shipping_charged - platform_fees - other_costs
  ) STORED,

  -- Cost basis (can be linked to inventory or entered manually)
  cost_of_goods DECIMAL(10,2) DEFAULT 0,
  shipping_expense DECIMAL(10,2) DEFAULT 0, -- actual shipping cost to ship

  -- Profit calculation (stored)
  gross_profit DECIMAL(10,2) GENERATED ALWAYS AS (
    sale_amount + shipping_charged - platform_fees - other_costs - cost_of_goods - shipping_cost
  ) STORED,

  -- Buyer info
  buyer_name TEXT,
  buyer_email TEXT,

  -- Metadata
  description TEXT,
  notes TEXT,
  currency TEXT DEFAULT 'GBP',

  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

-- ============================================================================
-- SALE ITEMS TABLE
-- Line items for each sale (linked to inventory when possible)
-- ============================================================================
CREATE TABLE sale_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sale_id UUID NOT NULL REFERENCES sales(id) ON DELETE CASCADE,

  -- Item details
  item_number TEXT NOT NULL,
  item_name TEXT,
  item_type TEXT, -- 'Part', 'Set', 'Minifig', 'Other'
  color_name TEXT,
  condition TEXT CHECK (condition IN ('New', 'Used')),

  -- Quantity and pricing
  quantity INTEGER NOT NULL DEFAULT 1,
  unit_price DECIMAL(10,2) NOT NULL,
  total_price DECIMAL(10,2) NOT NULL,
  unit_cost DECIMAL(10,2), -- cost per item if known

  -- Link to inventory
  inventory_item_id UUID REFERENCES inventory_items(id) ON DELETE SET NULL,

  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

-- ============================================================================
-- ADD WORKFLOW FIELDS TO PLATFORM_ORDERS
-- ============================================================================
ALTER TABLE platform_orders
ADD COLUMN IF NOT EXISTS internal_status TEXT, -- our internal status (can differ from platform)
ADD COLUMN IF NOT EXISTS packed_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS shipped_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS shipping_carrier TEXT,
ADD COLUMN IF NOT EXISTS shipping_method TEXT,
ADD COLUMN IF NOT EXISTS shipping_cost_actual DECIMAL(10,2),
ADD COLUMN IF NOT EXISTS notes TEXT;

-- ============================================================================
-- INDEXES
-- ============================================================================
-- Order status history
CREATE INDEX idx_order_status_history_order ON order_status_history(order_id);
CREATE INDEX idx_order_status_history_created ON order_status_history(created_at DESC);

-- Sales
CREATE INDEX idx_sales_user ON sales(user_id);
CREATE INDEX idx_sales_date ON sales(user_id, sale_date DESC);
CREATE INDEX idx_sales_platform ON sales(user_id, platform);
CREATE INDEX idx_sales_order ON sales(order_id) WHERE order_id IS NOT NULL;

-- Sale items
CREATE INDEX idx_sale_items_sale ON sale_items(sale_id);
CREATE INDEX idx_sale_items_inventory ON sale_items(inventory_item_id) WHERE inventory_item_id IS NOT NULL;

-- Platform orders new columns
CREATE INDEX idx_platform_orders_internal_status ON platform_orders(user_id, internal_status);
CREATE INDEX idx_platform_orders_shipped ON platform_orders(user_id, shipped_at) WHERE shipped_at IS NOT NULL;

-- ============================================================================
-- RLS POLICIES FOR ORDER_STATUS_HISTORY
-- ============================================================================
ALTER TABLE order_status_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view order status history for own orders"
  ON order_status_history FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM platform_orders
      WHERE platform_orders.id = order_status_history.order_id
      AND platform_orders.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can insert order status history for own orders"
  ON order_status_history FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM platform_orders
      WHERE platform_orders.id = order_status_history.order_id
      AND platform_orders.user_id = auth.uid()
    )
  );

-- ============================================================================
-- RLS POLICIES FOR SALES
-- ============================================================================
ALTER TABLE sales ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own sales"
  ON sales FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own sales"
  ON sales FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own sales"
  ON sales FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own sales"
  ON sales FOR DELETE
  USING (auth.uid() = user_id);

-- ============================================================================
-- RLS POLICIES FOR SALE_ITEMS
-- ============================================================================
ALTER TABLE sale_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view sale items for own sales"
  ON sale_items FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM sales
      WHERE sales.id = sale_items.sale_id
      AND sales.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can insert sale items for own sales"
  ON sale_items FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM sales
      WHERE sales.id = sale_items.sale_id
      AND sales.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can update sale items for own sales"
  ON sale_items FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM sales
      WHERE sales.id = sale_items.sale_id
      AND sales.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can delete sale items for own sales"
  ON sale_items FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM sales
      WHERE sales.id = sale_items.sale_id
      AND sales.user_id = auth.uid()
    )
  );

-- ============================================================================
-- TRIGGERS
-- ============================================================================
-- Auto-update updated_at for sales
CREATE TRIGGER update_sales_updated_at
  BEFORE UPDATE ON sales
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();
