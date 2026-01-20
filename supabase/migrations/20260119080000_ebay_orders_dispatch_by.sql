-- eBay Orders Dispatch By Column
-- Migration: 20260119080000_ebay_orders_dispatch_by
-- Purpose: Add dispatch_by column to ebay_orders for SLA deadline tracking

-- ============================================================================
-- ADD DISPATCH_BY COLUMN TO EBAY_ORDERS
-- Stores the deadline by which an order must be dispatched
-- Extracted from fulfillmentStartInstructions in eBay API response
-- ============================================================================
ALTER TABLE ebay_orders
ADD COLUMN IF NOT EXISTS dispatch_by TIMESTAMPTZ;

-- ============================================================================
-- INDEX FOR DISPATCH DEADLINE QUERIES
-- Optimised for finding orders that need dispatching
-- ============================================================================
CREATE INDEX idx_ebay_orders_dispatch_by ON ebay_orders(user_id, dispatch_by)
WHERE dispatch_by IS NOT NULL
  AND order_fulfilment_status NOT IN ('FULFILLED', 'CANCELLED');

-- ============================================================================
-- COMMENT
-- ============================================================================
COMMENT ON COLUMN ebay_orders.dispatch_by IS 'Deadline timestamp for dispatching the order, extracted from fulfillmentStartInstructions (shipToDate or calculated from maxEstimatedDeliveryDate)';
