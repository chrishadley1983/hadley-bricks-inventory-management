-- Add platform_status_changed_at column to platform_orders
-- This tracks when the order status was last changed on the source platform (e.g., BrickLink)
-- Used for incremental sync: only fetch full order details when this timestamp is newer than our last sync

ALTER TABLE platform_orders
ADD COLUMN IF NOT EXISTS platform_status_changed_at TIMESTAMPTZ;

-- Add index for efficient incremental sync queries
CREATE INDEX IF NOT EXISTS idx_platform_orders_status_changed
ON platform_orders (user_id, platform, platform_status_changed_at);

COMMENT ON COLUMN platform_orders.platform_status_changed_at IS
'Timestamp when order status was last changed on the source platform. Used for incremental sync optimization.';
