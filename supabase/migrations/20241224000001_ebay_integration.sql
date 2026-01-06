-- eBay Integration Tables
-- Migration: 20241224000001_ebay_integration
-- Specification: docs/Hadley_Bricks_eBay_Integration_Spec_v1.md

-- ============================================================================
-- EBAY CREDENTIALS TABLE (OAuth tokens for eBay API access)
-- ============================================================================
CREATE TABLE ebay_credentials (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  ebay_user_id TEXT,
  access_token TEXT NOT NULL,
  refresh_token TEXT NOT NULL,
  access_token_expires_at TIMESTAMPTZ NOT NULL,
  refresh_token_expires_at TIMESTAMPTZ NOT NULL,
  scopes TEXT[] NOT NULL,
  marketplace_id TEXT NOT NULL DEFAULT 'EBAY_GB',
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  UNIQUE(user_id)
);

-- ============================================================================
-- EBAY ORDERS TABLE (Master order information from Fulfilment API)
-- ============================================================================
CREATE TABLE ebay_orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  ebay_order_id TEXT NOT NULL,
  legacy_order_id TEXT,
  creation_date TIMESTAMPTZ NOT NULL,
  last_modified_date TIMESTAMPTZ NOT NULL,
  order_fulfilment_status TEXT NOT NULL,
  order_payment_status TEXT NOT NULL,
  cancel_status JSONB,
  buyer_username TEXT NOT NULL,
  buyer_checkout_notes TEXT,
  sales_record_reference TEXT,
  total_fee_basis_amount DECIMAL(12,2),
  total_fee_basis_currency TEXT,
  pricing_summary JSONB,
  payment_summary JSONB,
  fulfilment_instructions JSONB,
  raw_response JSONB NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  UNIQUE(user_id, ebay_order_id)
);

-- ============================================================================
-- EBAY ORDER LINE ITEMS TABLE (Individual items in orders)
-- ============================================================================
CREATE TABLE ebay_order_line_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL REFERENCES ebay_orders(id) ON DELETE CASCADE,
  ebay_line_item_id TEXT NOT NULL,
  legacy_item_id TEXT,
  sku TEXT,
  title TEXT NOT NULL,
  quantity INTEGER NOT NULL,
  line_item_cost_amount DECIMAL(12,2) NOT NULL,
  line_item_cost_currency TEXT NOT NULL,
  total_amount DECIMAL(12,2) NOT NULL,
  total_currency TEXT NOT NULL,
  fulfilment_status TEXT NOT NULL,
  listing_marketplace_id TEXT,
  purchase_marketplace_id TEXT,
  item_location TEXT,
  taxes JSONB,
  properties JSONB,
  raw_response JSONB NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  UNIQUE(ebay_line_item_id)
);

-- ============================================================================
-- EBAY SHIPPING FULFILMENTS TABLE (Shipping records for orders)
-- ============================================================================
CREATE TABLE ebay_shipping_fulfilments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL REFERENCES ebay_orders(id) ON DELETE CASCADE,
  ebay_fulfilment_id TEXT NOT NULL,
  shipped_date TIMESTAMPTZ,
  shipping_carrier_code TEXT,
  tracking_number TEXT,
  line_items JSONB NOT NULL,
  raw_response JSONB NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  UNIQUE(ebay_fulfilment_id)
);

-- ============================================================================
-- EBAY TRANSACTIONS TABLE (Financial transactions from Finances API)
-- ============================================================================
CREATE TABLE ebay_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  ebay_transaction_id TEXT NOT NULL,
  ebay_order_id TEXT,
  transaction_type TEXT NOT NULL,
  transaction_status TEXT NOT NULL,
  transaction_date TIMESTAMPTZ NOT NULL,
  amount DECIMAL(12,2) NOT NULL,
  currency TEXT NOT NULL,
  booking_entry TEXT NOT NULL,
  payout_id TEXT,
  buyer_username TEXT,
  transaction_memo TEXT,
  order_line_items JSONB,
  total_fee_amount DECIMAL(12,2),
  total_fee_currency TEXT,
  raw_response JSONB NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  UNIQUE(user_id, ebay_transaction_id)
);

-- ============================================================================
-- EBAY PAYOUTS TABLE (Bank payout records)
-- ============================================================================
CREATE TABLE ebay_payouts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  ebay_payout_id TEXT NOT NULL,
  payout_status TEXT NOT NULL,
  payout_date TIMESTAMPTZ NOT NULL,
  amount DECIMAL(12,2) NOT NULL,
  currency TEXT NOT NULL,
  payout_instrument JSONB,
  transaction_count INTEGER,
  raw_response JSONB NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  UNIQUE(user_id, ebay_payout_id)
);

-- ============================================================================
-- EBAY SYNC LOG TABLE (Tracking sync operations)
-- ============================================================================
CREATE TABLE ebay_sync_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  sync_type TEXT NOT NULL CHECK (sync_type IN ('ORDERS', 'TRANSACTIONS', 'PAYOUTS')),
  status TEXT NOT NULL CHECK (status IN ('RUNNING', 'COMPLETED', 'FAILED')),
  started_at TIMESTAMPTZ NOT NULL,
  completed_at TIMESTAMPTZ,
  records_processed INTEGER,
  records_created INTEGER,
  records_updated INTEGER,
  last_sync_cursor TEXT,
  error_message TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

-- ============================================================================
-- INDEXES
-- ============================================================================
-- ebay_credentials
CREATE INDEX idx_ebay_credentials_user ON ebay_credentials(user_id);

-- ebay_orders
CREATE INDEX idx_ebay_orders_user ON ebay_orders(user_id);
CREATE INDEX idx_ebay_orders_creation_date ON ebay_orders(user_id, creation_date DESC);
CREATE INDEX idx_ebay_orders_status ON ebay_orders(user_id, order_fulfilment_status);
CREATE INDEX idx_ebay_orders_last_modified ON ebay_orders(user_id, last_modified_date DESC);

-- ebay_order_line_items
CREATE INDEX idx_ebay_line_items_order ON ebay_order_line_items(order_id);
CREATE INDEX idx_ebay_line_items_sku ON ebay_order_line_items(sku) WHERE sku IS NOT NULL;

-- ebay_shipping_fulfilments
CREATE INDEX idx_ebay_fulfilments_order ON ebay_shipping_fulfilments(order_id);

-- ebay_transactions
CREATE INDEX idx_ebay_transactions_user ON ebay_transactions(user_id);
CREATE INDEX idx_ebay_transactions_date ON ebay_transactions(user_id, transaction_date DESC);
CREATE INDEX idx_ebay_transactions_type ON ebay_transactions(user_id, transaction_type);
CREATE INDEX idx_ebay_transactions_payout ON ebay_transactions(payout_id) WHERE payout_id IS NOT NULL;
CREATE INDEX idx_ebay_transactions_order ON ebay_transactions(ebay_order_id) WHERE ebay_order_id IS NOT NULL;

-- ebay_payouts
CREATE INDEX idx_ebay_payouts_user ON ebay_payouts(user_id);
CREATE INDEX idx_ebay_payouts_date ON ebay_payouts(user_id, payout_date DESC);
CREATE INDEX idx_ebay_payouts_status ON ebay_payouts(user_id, payout_status);

-- ebay_sync_log
CREATE INDEX idx_ebay_sync_log_user ON ebay_sync_log(user_id);
CREATE INDEX idx_ebay_sync_log_type ON ebay_sync_log(user_id, sync_type);
CREATE INDEX idx_ebay_sync_log_started ON ebay_sync_log(user_id, started_at DESC);

-- ============================================================================
-- UPDATED_AT TRIGGERS
-- ============================================================================
CREATE TRIGGER update_ebay_credentials_updated_at
  BEFORE UPDATE ON ebay_credentials
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_ebay_orders_updated_at
  BEFORE UPDATE ON ebay_orders
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_ebay_order_line_items_updated_at
  BEFORE UPDATE ON ebay_order_line_items
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_ebay_shipping_fulfilments_updated_at
  BEFORE UPDATE ON ebay_shipping_fulfilments
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_ebay_transactions_updated_at
  BEFORE UPDATE ON ebay_transactions
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_ebay_payouts_updated_at
  BEFORE UPDATE ON ebay_payouts
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- ============================================================================
-- ROW LEVEL SECURITY
-- ============================================================================
ALTER TABLE ebay_credentials ENABLE ROW LEVEL SECURITY;
ALTER TABLE ebay_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE ebay_order_line_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE ebay_shipping_fulfilments ENABLE ROW LEVEL SECURITY;
ALTER TABLE ebay_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE ebay_payouts ENABLE ROW LEVEL SECURITY;
ALTER TABLE ebay_sync_log ENABLE ROW LEVEL SECURITY;

-- ebay_credentials policies
CREATE POLICY "Users can view own eBay credentials"
  ON ebay_credentials FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own eBay credentials"
  ON ebay_credentials FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own eBay credentials"
  ON ebay_credentials FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own eBay credentials"
  ON ebay_credentials FOR DELETE
  USING (auth.uid() = user_id);

-- ebay_orders policies
CREATE POLICY "Users can view own eBay orders"
  ON ebay_orders FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own eBay orders"
  ON ebay_orders FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own eBay orders"
  ON ebay_orders FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own eBay orders"
  ON ebay_orders FOR DELETE
  USING (auth.uid() = user_id);

-- ebay_order_line_items policies (through order relationship)
CREATE POLICY "Users can view own eBay order line items"
  ON ebay_order_line_items FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM ebay_orders
    WHERE ebay_orders.id = ebay_order_line_items.order_id
    AND ebay_orders.user_id = auth.uid()
  ));

CREATE POLICY "Users can insert own eBay order line items"
  ON ebay_order_line_items FOR INSERT
  WITH CHECK (EXISTS (
    SELECT 1 FROM ebay_orders
    WHERE ebay_orders.id = ebay_order_line_items.order_id
    AND ebay_orders.user_id = auth.uid()
  ));

CREATE POLICY "Users can update own eBay order line items"
  ON ebay_order_line_items FOR UPDATE
  USING (EXISTS (
    SELECT 1 FROM ebay_orders
    WHERE ebay_orders.id = ebay_order_line_items.order_id
    AND ebay_orders.user_id = auth.uid()
  ));

CREATE POLICY "Users can delete own eBay order line items"
  ON ebay_order_line_items FOR DELETE
  USING (EXISTS (
    SELECT 1 FROM ebay_orders
    WHERE ebay_orders.id = ebay_order_line_items.order_id
    AND ebay_orders.user_id = auth.uid()
  ));

-- ebay_shipping_fulfilments policies (through order relationship)
CREATE POLICY "Users can view own eBay shipping fulfilments"
  ON ebay_shipping_fulfilments FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM ebay_orders
    WHERE ebay_orders.id = ebay_shipping_fulfilments.order_id
    AND ebay_orders.user_id = auth.uid()
  ));

CREATE POLICY "Users can insert own eBay shipping fulfilments"
  ON ebay_shipping_fulfilments FOR INSERT
  WITH CHECK (EXISTS (
    SELECT 1 FROM ebay_orders
    WHERE ebay_orders.id = ebay_shipping_fulfilments.order_id
    AND ebay_orders.user_id = auth.uid()
  ));

CREATE POLICY "Users can update own eBay shipping fulfilments"
  ON ebay_shipping_fulfilments FOR UPDATE
  USING (EXISTS (
    SELECT 1 FROM ebay_orders
    WHERE ebay_orders.id = ebay_shipping_fulfilments.order_id
    AND ebay_orders.user_id = auth.uid()
  ));

CREATE POLICY "Users can delete own eBay shipping fulfilments"
  ON ebay_shipping_fulfilments FOR DELETE
  USING (EXISTS (
    SELECT 1 FROM ebay_orders
    WHERE ebay_orders.id = ebay_shipping_fulfilments.order_id
    AND ebay_orders.user_id = auth.uid()
  ));

-- ebay_transactions policies
CREATE POLICY "Users can view own eBay transactions"
  ON ebay_transactions FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own eBay transactions"
  ON ebay_transactions FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own eBay transactions"
  ON ebay_transactions FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own eBay transactions"
  ON ebay_transactions FOR DELETE
  USING (auth.uid() = user_id);

-- ebay_payouts policies
CREATE POLICY "Users can view own eBay payouts"
  ON ebay_payouts FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own eBay payouts"
  ON ebay_payouts FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own eBay payouts"
  ON ebay_payouts FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own eBay payouts"
  ON ebay_payouts FOR DELETE
  USING (auth.uid() = user_id);

-- ebay_sync_log policies
CREATE POLICY "Users can view own eBay sync logs"
  ON ebay_sync_log FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own eBay sync logs"
  ON ebay_sync_log FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own eBay sync logs"
  ON ebay_sync_log FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own eBay sync logs"
  ON ebay_sync_log FOR DELETE
  USING (auth.uid() = user_id);
