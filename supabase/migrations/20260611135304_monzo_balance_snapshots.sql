-- Daily Monzo balance snapshots.
-- Source 'api' = live Monzo /balance + /pots (requires OAuth connection);
-- source 'computed' = signed sum of the synced transaction ledger, which is a
-- true balance because history is complete from account opening (Apr 2024)
-- but excludes money held in pots.

CREATE TABLE monzo_balance_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  snapshot_date DATE NOT NULL,
  balance_pence BIGINT NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('computed', 'api')),
  pot_total_pence BIGINT,
  pots JSONB,
  transaction_count INTEGER,
  latest_transaction_at TIMESTAMPTZ,
  low_balance_alerted BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, snapshot_date)
);

ALTER TABLE monzo_balance_snapshots ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own balance snapshots"
  ON monzo_balance_snapshots FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own balance snapshots"
  ON monzo_balance_snapshots FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own balance snapshots"
  ON monzo_balance_snapshots FOR UPDATE
  USING (auth.uid() = user_id);

CREATE INDEX idx_monzo_balance_snapshots_user_date
  ON monzo_balance_snapshots (user_id, snapshot_date DESC);

-- Aggregate in the database: 4,000+ transaction rows would otherwise hit the
-- PostgREST 1,000-row limit. Declines never settle so they are excluded.
CREATE OR REPLACE FUNCTION monzo_computed_balance(p_user_id UUID)
RETURNS TABLE (balance_pence BIGINT, transaction_count BIGINT, latest_transaction_at TIMESTAMPTZ)
LANGUAGE sql
STABLE
AS $$
  SELECT
    COALESCE(SUM(amount), 0)::BIGINT,
    COUNT(*)::BIGINT,
    MAX(created)
  FROM monzo_transactions
  WHERE user_id = p_user_id
    AND decline_reason IS NULL;
$$;;
