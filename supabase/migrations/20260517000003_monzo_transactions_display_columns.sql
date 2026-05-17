-- Generated columns so the UI can sort by what's actually shown.
--
-- The list renders user_merchant_name (and user_description) when set,
-- otherwise the original Monzo value. Without these columns the sort
-- header would still order by the raw merchant_name, surprising users
-- who've renamed rows.
--
-- NULLIF coerces empty strings (defensive — the API already converts
-- empty -> null) so an empty override doesn't beat a populated original.

ALTER TABLE monzo_transactions
  ADD COLUMN display_merchant_name TEXT
    GENERATED ALWAYS AS (COALESCE(NULLIF(user_merchant_name, ''), merchant_name)) STORED,
  ADD COLUMN display_description TEXT
    GENERATED ALWAYS AS (COALESCE(NULLIF(user_description, ''), description)) STORED;

CREATE INDEX IF NOT EXISTS idx_monzo_transactions_display_merchant
  ON monzo_transactions (user_id, display_merchant_name);

CREATE INDEX IF NOT EXISTS idx_monzo_transactions_display_description
  ON monzo_transactions (user_id, display_description);
