-- User-editable overrides for Monzo transactions
--
-- These columns are owned by the user, not the Monzo sync. The sync services
-- (monzo-sheets-sync, monzo-api) never write to them, so refreshing the data
-- source will not clobber a user's edits. Display layer falls back to
-- merchant_name / description when the user override is null.
--
-- is_archived hides noise rows (e.g. £0.00 card-active checks) from the
-- default transactions table view.

ALTER TABLE monzo_transactions
  ADD COLUMN user_merchant_name TEXT,
  ADD COLUMN user_description TEXT,
  ADD COLUMN is_archived BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_monzo_transactions_is_archived
  ON monzo_transactions (user_id, is_archived)
  WHERE is_archived = false;
