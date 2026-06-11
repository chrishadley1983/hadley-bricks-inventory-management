-- Unified Markdown & Repricing migration
ALTER TABLE inventory_items
  ADD COLUMN IF NOT EXISTS next_markdown_eval_at DATE;

CREATE INDEX IF NOT EXISTS idx_inventory_items_next_markdown_eval
  ON inventory_items(user_id, next_markdown_eval_at)
  WHERE status = 'LISTED';

ALTER TABLE markdown_config
  ADD COLUMN IF NOT EXISTS suggest_interval_days INTEGER NOT NULL DEFAULT 30,
  ADD COLUMN IF NOT EXISTS relist_age_days INTEGER NOT NULL DEFAULT 90,
  ADD COLUMN IF NOT EXISTS min_change_pct NUMERIC(5,2) NOT NULL DEFAULT 3.0,
  ADD COLUMN IF NOT EXISTS report_email TEXT;

UPDATE markdown_config SET ebay_fee_rate = 0.1566 WHERE ebay_fee_rate = 0.18;
UPDATE markdown_config SET report_email = 'chris@hadleybricks.co.uk' WHERE report_email IS NULL;

ALTER TABLE markdown_proposals
  DROP CONSTRAINT IF EXISTS markdown_proposals_proposed_action_check;
ALTER TABLE markdown_proposals
  ADD CONSTRAINT markdown_proposals_proposed_action_check
  CHECK (proposed_action IN ('MARKDOWN', 'AUCTION', 'RELIST'));

ALTER TABLE markdown_proposals
  DROP CONSTRAINT IF EXISTS markdown_proposals_diagnosis_check;
ALTER TABLE markdown_proposals
  ADD CONSTRAINT markdown_proposals_diagnosis_check
  CHECK (diagnosis IN ('OVERPRICED', 'LOW_DEMAND', 'RELIST'));

ALTER TABLE markdown_proposals
  ADD COLUMN IF NOT EXISTS applied_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS pushed_to_platform BOOLEAN NOT NULL DEFAULT false;;
