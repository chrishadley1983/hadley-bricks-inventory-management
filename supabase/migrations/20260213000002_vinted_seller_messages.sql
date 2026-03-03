-- Migration: vinted_seller_messages
-- Purpose: Queue table for automated seller messaging after Vinted purchases.
-- The email-purchases cron inserts pending messages, and the Windows scanner
-- app pulls and processes them via Playwright.

-- ============================================================================
-- TABLE CREATION
-- ============================================================================

CREATE TABLE vinted_seller_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id),
  order_reference TEXT NOT NULL,
  seller_username TEXT NOT NULL,
  message_text TEXT NOT NULL DEFAULT 'Hey - I am buying this as a present so would appreciate if you could package carefully (ideally in a box). Many Thanks',
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'in_progress', 'sent', 'failed')),
  attempts INT NOT NULL DEFAULT 0,
  max_attempts INT NOT NULL DEFAULT 3,
  last_error TEXT,
  picked_up_at TIMESTAMPTZ,
  sent_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,

  -- Dedup: one message per order+seller combination
  CONSTRAINT uq_vinted_seller_messages_order_seller UNIQUE (order_reference, seller_username)
);

-- ============================================================================
-- INDEXES
-- ============================================================================

-- Fast lookup for pending messages to process
CREATE INDEX idx_vinted_seller_messages_status ON vinted_seller_messages(status)
  WHERE status IN ('pending', 'in_progress');

-- Lookup by user
CREATE INDEX idx_vinted_seller_messages_user_id ON vinted_seller_messages(user_id);

-- ============================================================================
-- ROW LEVEL SECURITY
-- ============================================================================

ALTER TABLE vinted_seller_messages ENABLE ROW LEVEL SECURITY;

-- Service role access (cron + API endpoints use service role client)
CREATE POLICY "service_role_full_access" ON vinted_seller_messages
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- Users can view their own messages
CREATE POLICY "users_view_own_messages" ON vinted_seller_messages
  FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

-- ============================================================================
-- COMMENTS
-- ============================================================================

COMMENT ON TABLE vinted_seller_messages IS 'Queue for automated seller messages after Vinted purchases. Cron inserts pending, Windows scanner processes via Playwright.';
COMMENT ON COLUMN vinted_seller_messages.order_reference IS 'Vinted order reference from purchase email';
COMMENT ON COLUMN vinted_seller_messages.seller_username IS 'Vinted seller username to message';
COMMENT ON COLUMN vinted_seller_messages.status IS 'Lifecycle: pending -> in_progress -> sent/failed';
COMMENT ON COLUMN vinted_seller_messages.attempts IS 'Number of send attempts made';
COMMENT ON COLUMN vinted_seller_messages.picked_up_at IS 'When the message was last picked up for processing';
