-- Delivery Tracking Cache
-- Caches Royal Mail tracking status for Amazon orders to avoid redundant lookups.
-- Used by the delivery-report Cloud Run Job to track delivery performance.
-- Pattern: service-role only (no user RLS policies), same as job_execution_history.

CREATE TABLE IF NOT EXISTS delivery_tracking_cache (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Order identification (Amazon order ID, unique per order)
  platform_order_id TEXT NOT NULL UNIQUE,

  -- Order details
  order_date DATE,
  dispatch_by DATE,
  item_name TEXT,
  expected_delivery DATE,

  -- Royal Mail tracking
  tracking_number TEXT,
  rm_status TEXT,
  rm_delivery_date DATE,

  -- Cache management
  needs_recheck BOOLEAN NOT NULL DEFAULT true,
  last_checked DATE,

  -- Timestamps
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Primary query: "show me orders by date, newest first"
CREATE INDEX idx_delivery_cache_order_date
  ON delivery_tracking_cache (order_date DESC);

-- Query: "which orders need re-checking?"
CREATE INDEX idx_delivery_cache_needs_recheck
  ON delivery_tracking_cache (needs_recheck)
  WHERE needs_recheck = true;

-- RLS: service role only (no user policies)
ALTER TABLE delivery_tracking_cache ENABLE ROW LEVEL SECURITY;
