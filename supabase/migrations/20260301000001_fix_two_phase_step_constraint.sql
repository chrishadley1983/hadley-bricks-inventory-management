-- Fix: Add 'quantity_verifying' to two_phase_step CHECK constraint
-- The original migration (20260123000002) omitted this step, causing constraint
-- violations when the cron tries to advance from quantity_polling → quantity_verifying.

-- Drop the inline constraint created by ADD COLUMN ... CHECK(...)
ALTER TABLE amazon_sync_feeds
DROP CONSTRAINT IF EXISTS amazon_sync_feeds_two_phase_step_check;

-- Re-add with quantity_verifying included
ALTER TABLE amazon_sync_feeds
ADD CONSTRAINT amazon_sync_feeds_two_phase_step_check
CHECK (two_phase_step IN (
  'price_submitted',
  'price_polling',
  'price_verifying',
  'quantity_submitted',
  'quantity_polling',
  'quantity_verifying',
  'complete',
  'failed'
));
