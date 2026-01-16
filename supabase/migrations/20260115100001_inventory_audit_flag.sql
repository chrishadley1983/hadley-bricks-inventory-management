-- Temporary migration for manual stock audit
-- This adds an 'audited' column to track which items have been physically verified
-- To reverse: DROP the column or revert this branch

-- Add audited column (nullable text, will contain 'X' when audited)
ALTER TABLE inventory_items
ADD COLUMN IF NOT EXISTS audited TEXT;

-- Add comment to document temporary nature
COMMENT ON COLUMN inventory_items.audited IS 'Temporary: Manual stock audit flag. Set to X when physically verified. Remove after stock take complete.';
