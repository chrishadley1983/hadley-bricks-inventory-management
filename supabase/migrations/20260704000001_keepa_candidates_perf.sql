-- keepa_refresh_candidates timed out once price_snapshots grew to ~2.8M rows
-- (post re-import): the view's GROUP BY MAX(date) scans every keepa row.
-- Fix: partial index + LATERAL max-per-set so each candidate is one index probe.

CREATE INDEX IF NOT EXISTS idx_price_snapshots_keepa_set_date
  ON price_snapshots (set_num, date DESC)
  WHERE source = 'keepa_amazon_buybox';

CREATE OR REPLACE VIEW keepa_refresh_candidates AS
SELECT
  b.set_number,
  b.amazon_asin,
  b.retirement_status,
  ps.last_keepa_date
FROM brickset_sets b
LEFT JOIN LATERAL (
  SELECT MAX(date) AS last_keepa_date
  FROM price_snapshots
  WHERE set_num = b.set_number AND source = 'keepa_amazon_buybox'
) ps ON TRUE
WHERE b.amazon_asin IS NOT NULL
  AND (
    b.retirement_status IN ('available', 'retiring_soon')
    OR (
      b.retirement_status = 'retired'
      AND COALESCE(b.exit_date, b.expected_retirement_date) >= CURRENT_DATE - INTERVAL '4 years'
    )
  );

COMMENT ON VIEW keepa_refresh_candidates IS 'Sets eligible for ongoing Keepa price refresh, with last snapshot date for staleness ordering (LATERAL + partial index — the GROUP BY form timed out at 2.8M snapshot rows)';
