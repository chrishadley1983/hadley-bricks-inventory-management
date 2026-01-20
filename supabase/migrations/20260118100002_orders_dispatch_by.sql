-- Orders Dispatch By Column
-- Migration: 20260118100002_orders_dispatch_by
-- Purpose: Add dispatch_by column to platform_orders for SLA deadline tracking

-- ============================================================================
-- ADD DISPATCH_BY COLUMN TO PLATFORM_ORDERS
-- Stores the deadline by which an order must be dispatched
-- ============================================================================
ALTER TABLE platform_orders
ADD COLUMN IF NOT EXISTS dispatch_by TIMESTAMPTZ;

-- ============================================================================
-- INDEX FOR DISPATCH DEADLINE QUERIES
-- Optimised for finding orders that need dispatching
-- ============================================================================
CREATE INDEX idx_platform_orders_dispatch_by ON platform_orders(user_id, dispatch_by)
WHERE dispatch_by IS NOT NULL
  AND internal_status NOT IN ('Shipped', 'Completed', 'Cancelled');

-- ============================================================================
-- COMMENT
-- ============================================================================
COMMENT ON COLUMN platform_orders.dispatch_by IS 'Deadline timestamp for dispatching the order, fetched from platform SLA data (eBay fulfillmentStartInstructions / Amazon LatestShipDate)';
