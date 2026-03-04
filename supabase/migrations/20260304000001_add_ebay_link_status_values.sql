-- Add 'no_inventory', 'cancelled', and 'pre_linked' to ebay_orders.inventory_link_status
-- Fixes 19 stuck orders that have no matching inventory items or were cancelled/refunded.

-- Step 1: Expand the CHECK constraint
ALTER TABLE ebay_orders
  DROP CONSTRAINT IF EXISTS ebay_orders_inventory_link_status_check;

ALTER TABLE ebay_orders
  ADD CONSTRAINT ebay_orders_inventory_link_status_check
  CHECK (inventory_link_status IN ('pending', 'partial', 'complete', 'skipped', 'pre_linked', 'no_inventory', 'cancelled'));

-- Step 2: Update cancelled/refunded orders
UPDATE ebay_orders SET inventory_link_status = 'cancelled'
WHERE ebay_order_id IN (
  '21-14243-55028',  -- julconnected (seller cancelled)
  '25-14195-57597',  -- not.brad16 (buyer cancelled)
  '17-14137-45294'   -- monika35kk (fulfilled but fully refunded)
);

-- Step 3: Update fulfilled+paid orders with no inventory items
UPDATE ebay_orders SET inventory_link_status = 'no_inventory'
WHERE ebay_order_id IN (
  '27-14286-37970', '06-14304-36741', '20-14255-86226',
  '21-14232-54586', '16-14223-28605', '09-14202-68614',
  '14-14194-04004', '23-14170-01685', '16-14173-69604',
  '01-14170-71475', '21-14132-20375', '18-14087-52951',
  '06-14104-01006', '19-14070-51118', '21-14043-11911',
  '04-14061-42359'
);

-- Step 4: Update RPC function to exclude no_inventory/cancelled eBay orders
-- Must DROP first because existing function returns integer (can't change return type with CREATE OR REPLACE)
DROP FUNCTION IF EXISTS count_all_unlinked_order_items_since(UUID, DATE);

CREATE OR REPLACE FUNCTION count_all_unlinked_order_items_since(p_user_id UUID, p_since_date DATE)
RETURNS integer
LANGUAGE sql
STABLE SECURITY DEFINER
AS $$
  SELECT COALESCE(
    (
      -- Count from platform_orders (BrickLink, Amazon, etc.)
      SELECT COUNT(*)::integer
      FROM order_items oi
      JOIN platform_orders po ON oi.order_id = po.id
      WHERE po.user_id = p_user_id
        AND po.order_date >= p_since_date
        AND oi.inventory_item_id IS NULL
        AND po.status NOT IN ('Cancelled', 'Cancelled/Refunded', 'Refunded')
        AND NOT EXISTS (
          SELECT 1 FROM amazon_inventory_resolution_queue arq
          WHERE arq.order_item_id = oi.id
            AND arq.status = 'no_inventory'
        )
    ), 0
  ) + COALESCE(
    (
      -- Count from ebay_orders — also exclude orders with terminal link statuses
      SELECT COUNT(*)::integer
      FROM ebay_order_line_items eli
      JOIN ebay_orders eo ON eli.order_id = eo.id
      WHERE eo.user_id = p_user_id
        AND eo.creation_date >= p_since_date
        AND eli.inventory_item_id IS NULL
        AND eo.order_payment_status != 'FULLY_REFUNDED'
        AND COALESCE(eo.inventory_link_status, 'pending') NOT IN ('complete', 'no_inventory', 'cancelled', 'skipped', 'pre_linked')
        AND NOT EXISTS (
          SELECT 1 FROM ebay_inventory_resolution_queue erq
          WHERE erq.ebay_line_item_id = eli.id
            AND erq.status = 'no_inventory'
        )
    ), 0
  );
$$;
