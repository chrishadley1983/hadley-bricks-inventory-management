-- Migration: order_issues
-- Purpose: Track buyer-side order issues on BrickLink and BrickOwl sales.
-- Captures both proactive (picker-discovered) and reactive (buyer-reported) issues,
-- the affected lots from the order, and a unified message log across Gmail / BL /
-- BO / Bricqer / manual sources with content-fingerprint dedup.

-- ============================================================================
-- TABLE: sales_order_issues (header)
-- ============================================================================
CREATE TABLE sales_order_issues (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,

  -- Platform order anchor
  platform TEXT NOT NULL CHECK (platform IN ('bricklink', 'brickowl')),
  platform_order_id TEXT NOT NULL,
  platform_order_uuid UUID REFERENCES platform_orders(id) ON DELETE SET NULL,

  -- Buyer + order snapshot (denormalised so issue history survives if platform_orders row is rebuilt)
  buyer_name TEXT,
  buyer_username TEXT,
  buyer_email TEXT,
  order_date TIMESTAMPTZ,
  order_status TEXT,

  -- Issue lifecycle
  discovered_by TEXT NOT NULL CHECK (discovered_by IN ('us', 'buyer')),
  issue_status TEXT NOT NULL DEFAULT 'open' CHECK (issue_status IN (
    'open',
    'awaiting_buyer',
    'awaiting_us',
    'resolved_refund',
    'resolved_replacement',
    'resolved_partial',
    'resolved_credit',
    'closed_no_action'
  )),

  planned_resolution TEXT,

  -- Structured outcome amounts (set on resolution)
  refund_amount DECIMAL(10, 2),
  replacement_qty INTEGER,
  credit_amount DECIMAL(10, 2),

  -- Latest message snapshot (denormalised for list view performance)
  latest_message_at TIMESTAMPTZ,
  latest_message_preview TEXT,
  latest_message_from TEXT CHECK (latest_message_from IN ('buyer', 'us')),
  latest_message_source TEXT CHECK (latest_message_source IN ('gmail', 'bricklink', 'brickowl', 'bricqer', 'manual')),

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_sales_order_issues_user ON sales_order_issues(user_id);
CREATE INDEX idx_sales_order_issues_platform_order ON sales_order_issues(user_id, platform, platform_order_id);
CREATE INDEX idx_sales_order_issues_status ON sales_order_issues(user_id, issue_status);
CREATE INDEX idx_sales_order_issues_order_date ON sales_order_issues(order_date DESC NULLS LAST);
CREATE INDEX idx_sales_order_issues_latest_msg ON sales_order_issues(latest_message_at DESC NULLS LAST);

CREATE TRIGGER update_sales_order_issues_updated_at
  BEFORE UPDATE ON sales_order_issues
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE sales_order_issues ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own order issues" ON sales_order_issues
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own order issues" ON sales_order_issues
  FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own order issues" ON sales_order_issues
  FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete own order issues" ON sales_order_issues
  FOR DELETE USING (auth.uid() = user_id);

-- ============================================================================
-- TABLE: sales_order_issue_items (affected lots)
-- ============================================================================
CREATE TABLE sales_order_issue_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  issue_id UUID NOT NULL REFERENCES sales_order_issues(id) ON DELETE CASCADE,
  order_item_id UUID REFERENCES order_items(id) ON DELETE SET NULL,

  -- Snapshot of the lot at the time the issue was created
  item_number TEXT NOT NULL,
  item_name TEXT,
  item_type TEXT,
  color_id INTEGER,
  color_name TEXT,
  condition TEXT CHECK (condition IN ('New', 'Used')),

  -- Quantities
  qty_expected INTEGER NOT NULL,
  qty_received INTEGER NOT NULL DEFAULT 0,
  qty_missing INTEGER GENERATED ALWAYS AS (qty_expected - qty_received) STORED,

  issue_type TEXT NOT NULL CHECK (issue_type IN (
    'missing_from_inventory',
    'damaged_in_inventory',
    'missing_from_shipment',
    'damaged_in_transit',
    'wrong_item_sent',
    'wrong_qty_sent',
    'shipment_lost',
    'other'
  )),

  notes TEXT,
  resolved BOOLEAN NOT NULL DEFAULT FALSE,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_sales_order_issue_items_issue ON sales_order_issue_items(issue_id);
CREATE INDEX idx_sales_order_issue_items_order_item ON sales_order_issue_items(order_item_id) WHERE order_item_id IS NOT NULL;

ALTER TABLE sales_order_issue_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own issue items" ON sales_order_issue_items
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM sales_order_issues
      WHERE sales_order_issues.id = sales_order_issue_items.issue_id
      AND sales_order_issues.user_id = auth.uid()
    )
  );
CREATE POLICY "Users can insert own issue items" ON sales_order_issue_items
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM sales_order_issues
      WHERE sales_order_issues.id = sales_order_issue_items.issue_id
      AND sales_order_issues.user_id = auth.uid()
    )
  );
CREATE POLICY "Users can update own issue items" ON sales_order_issue_items
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM sales_order_issues
      WHERE sales_order_issues.id = sales_order_issue_items.issue_id
      AND sales_order_issues.user_id = auth.uid()
    )
  );
CREATE POLICY "Users can delete own issue items" ON sales_order_issue_items
  FOR DELETE USING (
    EXISTS (
      SELECT 1 FROM sales_order_issues
      WHERE sales_order_issues.id = sales_order_issue_items.issue_id
      AND sales_order_issues.user_id = auth.uid()
    )
  );

-- ============================================================================
-- TABLE: sales_order_issue_messages (unified log)
-- ============================================================================
CREATE TABLE sales_order_issue_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  issue_id UUID NOT NULL REFERENCES sales_order_issues(id) ON DELETE CASCADE,

  source TEXT NOT NULL CHECK (source IN ('gmail', 'bricklink', 'brickowl', 'bricqer', 'manual')),
  external_message_id TEXT,
  direction TEXT NOT NULL CHECK (direction IN ('inbound', 'outbound')),

  sent_at TIMESTAMPTZ NOT NULL,
  from_address TEXT,
  to_address TEXT,
  subject TEXT,
  body TEXT,
  body_html TEXT,
  attachments JSONB,

  -- Cross-source dedup (same message captured via multiple channels)
  content_fingerprint TEXT,
  duplicate_of_id UUID REFERENCES sales_order_issue_messages(id) ON DELETE SET NULL,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE (source, external_message_id)
);

CREATE INDEX idx_sales_order_issue_messages_issue ON sales_order_issue_messages(issue_id, sent_at DESC);
CREATE INDEX idx_sales_order_issue_messages_fingerprint ON sales_order_issue_messages(content_fingerprint) WHERE content_fingerprint IS NOT NULL;
CREATE INDEX idx_sales_order_issue_messages_duplicate ON sales_order_issue_messages(duplicate_of_id) WHERE duplicate_of_id IS NOT NULL;

ALTER TABLE sales_order_issue_messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own issue messages" ON sales_order_issue_messages
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM sales_order_issues
      WHERE sales_order_issues.id = sales_order_issue_messages.issue_id
      AND sales_order_issues.user_id = auth.uid()
    )
  );
CREATE POLICY "Users can insert own issue messages" ON sales_order_issue_messages
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM sales_order_issues
      WHERE sales_order_issues.id = sales_order_issue_messages.issue_id
      AND sales_order_issues.user_id = auth.uid()
    )
  );
CREATE POLICY "Users can update own issue messages" ON sales_order_issue_messages
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM sales_order_issues
      WHERE sales_order_issues.id = sales_order_issue_messages.issue_id
      AND sales_order_issues.user_id = auth.uid()
    )
  );
CREATE POLICY "Users can delete own issue messages" ON sales_order_issue_messages
  FOR DELETE USING (
    EXISTS (
      SELECT 1 FROM sales_order_issues
      WHERE sales_order_issues.id = sales_order_issue_messages.issue_id
      AND sales_order_issues.user_id = auth.uid()
    )
  );

-- ============================================================================
-- TRIGGER: update issue header latest_message_* on message insert (F21)
-- ============================================================================
CREATE OR REPLACE FUNCTION update_issue_latest_message()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE sales_order_issues
  SET
    latest_message_at = NEW.sent_at,
    latest_message_preview = LEFT(COALESCE(NEW.body, NEW.subject, ''), 200),
    latest_message_from = CASE WHEN NEW.direction = 'inbound' THEN 'buyer' ELSE 'us' END,
    latest_message_source = NEW.source,
    updated_at = NOW()
  WHERE id = NEW.issue_id
    AND (latest_message_at IS NULL OR NEW.sent_at > latest_message_at);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_update_issue_latest_message
  AFTER INSERT ON sales_order_issue_messages
  FOR EACH ROW EXECUTE FUNCTION update_issue_latest_message();

-- ============================================================================
-- COMMENTS
-- ============================================================================
COMMENT ON TABLE sales_order_issues IS 'Buyer-side order issues on BrickLink and BrickOwl sales (proactive picker-discovered + reactive buyer-reported).';
COMMENT ON COLUMN sales_order_issues.discovered_by IS 'us = picker found problem before/during pack; buyer = buyer messaged us about a problem with received order';
COMMENT ON COLUMN sales_order_issues.platform_order_uuid IS 'FK to platform_orders.id (canonical); platform + platform_order_id retained as denormalised snapshot.';
COMMENT ON TABLE sales_order_issue_items IS 'Per-lot issue records. Snapshots key fields from order_items so issue history survives order_item deletion.';
COMMENT ON TABLE sales_order_issue_messages IS 'Unified message log across Gmail, BL, BO, Bricqer, manual entries. Cross-source dedup via content_fingerprint + duplicate_of_id self-FK.';
