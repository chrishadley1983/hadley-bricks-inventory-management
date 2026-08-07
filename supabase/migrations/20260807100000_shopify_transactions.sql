-- Shopify payment transactions: revenue + processing-fee source for the P&L.
--
-- Mirrors the role paypal_transactions plays for BL/BO: Shopify Payments fees
-- are netted off payouts and never reach Monzo, so without this table no
-- Shopify processing fee is claimed anywhere. Rows come from the per-order
-- transactions endpoint; fee/payout fields are enriched from the Shopify
-- Payments balance-transactions endpoint (only Shopify Payments charges
-- appear there — PayPal-gateway orders keep fee data in paypal_transactions).
--
-- Sign conventions: gross_amount is signed (sales positive, refunds negative);
-- fee_amount is a positive cost; net_amount = gross_amount - fee_amount.
CREATE TABLE shopify_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id),
  shopify_transaction_id TEXT NOT NULL,
  shopify_order_id TEXT,
  order_name TEXT,
  kind TEXT,
  gateway TEXT,
  status TEXT,
  transaction_date TIMESTAMPTZ,
  currency TEXT,
  gross_amount NUMERIC(12,2),
  fee_amount NUMERIC(12,2),
  net_amount NUMERIC(12,2),
  balance_transaction_id TEXT,
  payout_id TEXT,
  payout_status TEXT,
  -- Gateway-side payment reference (e.g. the PayPal capture/transaction id)
  -- used to de-duplicate against paypal_transactions on the P&L.
  payment_ref TEXT,
  raw_response JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_shopify_transactions_user_txn UNIQUE (user_id, shopify_transaction_id)
);

CREATE INDEX idx_shopify_transactions_date ON shopify_transactions(user_id, transaction_date);
CREATE INDEX idx_shopify_transactions_order ON shopify_transactions(user_id, shopify_order_id);

ALTER TABLE shopify_transactions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own shopify transactions" ON shopify_transactions
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
