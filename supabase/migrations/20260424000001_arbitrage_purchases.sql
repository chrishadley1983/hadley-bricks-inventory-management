-- Migration: arbitrage_purchases
-- Purpose: Record completed BL-seller arbitrage purchases for downstream velocity
-- tracking (actual sell-through vs projection) and cross-store analytics.

CREATE TABLE arbitrage_purchases (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,

  -- Store identity
  store_slug TEXT NOT NULL,
  store_id INTEGER,
  store_country TEXT,

  -- Purchase link
  bl_order_id TEXT,
  purchased_at TIMESTAMPTZ,

  -- Totals at time of purchase
  total_outlay_gbp DECIMAL(10, 2),
  inbound_postage_gbp DECIMAL(10, 2),
  total_list_gbp DECIMAL(10, 2),
  projected_net_profit_gbp DECIMAL(10, 2),
  projected_margin_pct DECIMAL(5, 2),
  projected_roi_pct DECIMAL(5, 2),

  -- Inputs that produced this basket (for reproducibility)
  inputs JSONB NOT NULL,
  -- { minAsk, minStr, minMargin, cacheTtlDays, feeModel: { blFee, bricqerFee, paypalPct }, velocityBaseline }

  -- Basket contents
  items JSONB NOT NULL,
  -- Array of: { invID, itemType, itemNo, colourId, colourName, itemName, condition,
  --            invQty, realAsk, listPrice, sellThru, netPerUnit, lotProfit, marginPct, mos }

  -- Validation state from cart-scrape comparison
  cart_validation JSONB,
  -- { expectedOutlay, actualCartSubtotal, tolerancePct, passed, diffs[] }

  -- Full terminal report for quick human reference
  report_snapshot TEXT,

  -- Lifecycle
  status TEXT NOT NULL DEFAULT 'planned',
    -- 'planned' (scored, not bought) | 'cart_built' (cart staged) | 'purchased' (order placed) | 'abandoned'

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_arbitrage_purchases_user ON arbitrage_purchases(user_id);
CREATE INDEX idx_arbitrage_purchases_store ON arbitrage_purchases(store_slug);
CREATE INDEX idx_arbitrage_purchases_purchased_at ON arbitrage_purchases(purchased_at DESC NULLS LAST);
CREATE INDEX idx_arbitrage_purchases_status ON arbitrage_purchases(status);

CREATE TRIGGER update_arbitrage_purchases_updated_at
  BEFORE UPDATE ON arbitrage_purchases
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE arbitrage_purchases ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own arbitrage purchases"
  ON arbitrage_purchases FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own arbitrage purchases"
  ON arbitrage_purchases FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own arbitrage purchases"
  ON arbitrage_purchases FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own arbitrage purchases"
  ON arbitrage_purchases FOR DELETE
  USING (auth.uid() = user_id);

COMMENT ON TABLE arbitrage_purchases IS 'Record of BL-seller arbitrage basket purchases for velocity/performance tracking.';
COMMENT ON COLUMN arbitrage_purchases.inputs IS 'Filter/gate config used to build this basket (min-ask, min-str, min-margin, shipping, etc.)';
COMMENT ON COLUMN arbitrage_purchases.items IS 'Each lot in the basket with ask, Bricqer list, STR, projected margin/profit.';
COMMENT ON COLUMN arbitrage_purchases.cart_validation IS 'Cart-scrape vs projection comparison at checkout time (tolerance check).';
