-- Closes the RPC route into the finance schema left open after revoking anon's
-- table privileges. finance.add_monthly_manual_income() is SECURITY DEFINER
-- with a NULL proacl, so EXECUTE defaulted to PUBLIC — anon could POST to
-- /rest/v1/rpc/add_monthly_manual_income and write a transaction into the
-- ledger regardless of table grants.
--
-- Impact was limited (returns void so no read, date-gated to month-end, and
-- idempotent against a duplicate insert) but it was still an unauthenticated
-- write path into finance.transactions.
--
-- Its legitimate caller is pg_cron job 7 ("0 6 28-31 * *") running as postgres,
-- which is the function owner and unaffected by these revokes.

REVOKE EXECUTE ON FUNCTION finance.add_monthly_manual_income() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION finance.add_monthly_manual_income() FROM anon;;
