-- markdown v2: Amazon 365d exit recommendations carry diagnosis='EXIT'.
-- The original constraint (20260603071303_unified_markdown.sql) allowed only
-- OVERPRICED / LOW_DEMAND / RELIST — one EXIT row would abort the sweep's
-- atomic proposal insert.
ALTER TABLE markdown_proposals
  DROP CONSTRAINT IF EXISTS markdown_proposals_diagnosis_check;
ALTER TABLE markdown_proposals
  ADD CONSTRAINT markdown_proposals_diagnosis_check
  CHECK (diagnosis IN ('OVERPRICED', 'LOW_DEMAND', 'RELIST', 'EXIT'));
