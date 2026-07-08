-- Auto-categorisation v2: persist engine confidence + true source on transactions
ALTER TABLE finance.transactions
  ADD COLUMN IF NOT EXISTS categorisation_confidence numeric,
  ADD COLUMN IF NOT EXISTS engine_source text;

COMMENT ON COLUMN finance.transactions.categorisation_confidence IS
  'Confidence (0-1) from the categorisation engine at import time. NULL for manual/pre-v2 rows.';
COMMENT ON COLUMN finance.transactions.engine_source IS
  'Raw engine strategy: rule_exact | rule_pattern | merchant_rule | similar | ai | none. Unlike categorisation_source (enum), preserves provenance.';

-- Mining upserts need a stable conflict target
CREATE UNIQUE INDEX IF NOT EXISTS uq_category_mappings_pattern_type
  ON finance.category_mappings (lower(pattern), match_type);

-- Security: legacy Enable Banking table had RLS disabled (0 rows, service-role only)
ALTER TABLE finance.enable_banking_sessions ENABLE ROW LEVEL SECURITY;;
