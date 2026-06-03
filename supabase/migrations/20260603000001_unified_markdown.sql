-- ============================================
-- Unified Markdown & Repricing
-- Merge eBay Listing Refresh + Smart Auto-Markdown into one engine.
-- See docs/features/unified-markdown/design.md
-- ============================================

-- ---- inventory_items: per-item 30-day suggestion anchor ----
-- next_markdown_eval_at = date the item is next due for a pricing suggestion.
-- Anchored to listing_date + suggest_interval_days, rolling forward each eval,
-- reset on relist. Lets the daily cron pick only items due "today".
ALTER TABLE inventory_items
  ADD COLUMN IF NOT EXISTS next_markdown_eval_at DATE;

CREATE INDEX IF NOT EXISTS idx_inventory_items_next_markdown_eval
  ON inventory_items(user_id, next_markdown_eval_at)
  WHERE status = 'LISTED';

-- ---- markdown_config: unified cadence + reporting ----
ALTER TABLE markdown_config
  ADD COLUMN IF NOT EXISTS suggest_interval_days INTEGER NOT NULL DEFAULT 30,
  ADD COLUMN IF NOT EXISTS relist_age_days INTEGER NOT NULL DEFAULT 90,
  ADD COLUMN IF NOT EXISTS min_change_pct NUMERIC(5,2) NOT NULL DEFAULT 3.0,
  ADD COLUMN IF NOT EXISTS report_email TEXT;

-- Correct eBay fee rate to the documented effective rate (15.66%):
-- 12.8% final value + 0.36% regulatory + 2.5% payment processing.
-- (Was 0.18; the £0.30 fixed per-order fee is applied in engine logic.)
-- See apps/web/src/lib/purchase-evaluator/calculations.ts
UPDATE markdown_config SET ebay_fee_rate = 0.1566 WHERE ebay_fee_rate = 0.18;

-- Default report_email to the seller inbox where not set.
UPDATE markdown_config SET report_email = 'chris@hadleybricks.co.uk' WHERE report_email IS NULL;

-- ---- markdown_proposals: RELIST action + platform-push tracking ----
ALTER TABLE markdown_proposals
  DROP CONSTRAINT IF EXISTS markdown_proposals_proposed_action_check;
ALTER TABLE markdown_proposals
  ADD CONSTRAINT markdown_proposals_proposed_action_check
  CHECK (proposed_action IN ('MARKDOWN', 'AUCTION', 'RELIST'));

-- Allow a 'RELIST' diagnosis marker for mechanical 90-day Cassini relists
-- (pricing diagnosis OVERPRICED/LOW_DEMAND still used where applicable).
ALTER TABLE markdown_proposals
  DROP CONSTRAINT IF EXISTS markdown_proposals_diagnosis_check;
ALTER TABLE markdown_proposals
  ADD CONSTRAINT markdown_proposals_diagnosis_check
  CHECK (diagnosis IN ('OVERPRICED', 'LOW_DEMAND', 'RELIST'));

ALTER TABLE markdown_proposals
  ADD COLUMN IF NOT EXISTS applied_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS pushed_to_platform BOOLEAN NOT NULL DEFAULT false;
