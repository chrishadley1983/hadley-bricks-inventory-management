-- Inventory Resolution: persistent "Won't link" support
--
-- Adds a durable, reversible per-item ignore flag to both order line item tables
-- and teaches the unlinked-count RPCs to exclude:
--   1. a standing rule  - BrickLink / Brick Owl lines (loose-part & Bricqer sales
--      that never map 1:1 to the set/minifig inventory_items table), by conscious
--      business decision;
--   2. zero-quantity lines (cancelled / unshipped Amazon lines that carry qty 0);
--   3. per-item "Won't link" dismissals (link_ignored = true).
--
-- The flag is reversible: link_ignored can be cleared to restore an item.

-- ---------------------------------------------------------------------------
-- 1. Columns (idempotent)
-- ---------------------------------------------------------------------------
ALTER TABLE order_items
  ADD COLUMN IF NOT EXISTS link_ignored        boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS link_ignored_reason text,
  ADD COLUMN IF NOT EXISTS link_ignored_at     timestamptz;

ALTER TABLE ebay_order_line_items
  ADD COLUMN IF NOT EXISTS link_ignored        boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS link_ignored_reason text,
  ADD COLUMN IF NOT EXISTS link_ignored_at     timestamptz;

COMMENT ON COLUMN order_items.link_ignored IS
  'True when the user has consciously decided this line will never be linked to inventory. Excluded from unlinked counts. Reversible.';
COMMENT ON COLUMN ebay_order_line_items.link_ignored IS
  'True when the user has consciously decided this line will never be linked to inventory. Excluded from unlinked counts. Reversible.';

-- Partial indexes to keep the "ignored" filter view cheap.
CREATE INDEX IF NOT EXISTS idx_order_items_link_ignored
  ON order_items (link_ignored) WHERE link_ignored = true;
CREATE INDEX IF NOT EXISTS idx_ebay_loi_link_ignored
  ON ebay_order_line_items (link_ignored) WHERE link_ignored = true;

-- ---------------------------------------------------------------------------
-- 2. count_total_unlinked_order_items - all-time unlinked, with new exclusions
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.count_total_unlinked_order_items(p_user_id uuid)
 RETURNS integer
 LANGUAGE sql
 STABLE SECURITY DEFINER
AS $function$
  SELECT COALESCE(
    (
      -- platform_orders (Amazon; BrickLink/Brick Owl excluded by standing rule)
      SELECT COUNT(*)::integer
      FROM order_items oi
      JOIN platform_orders po ON oi.order_id = po.id
      WHERE po.user_id = p_user_id
        AND oi.inventory_item_id IS NULL
        AND po.status NOT IN ('Cancelled', 'Cancelled/Refunded', 'Refunded')
        AND po.platform NOT IN ('bricklink', 'brickowl')  -- standing rule: parts/Bricqer sales never link
        AND COALESCE(oi.quantity, 0) > 0                   -- ignore zero-qty (cancelled/unshipped) lines
        AND oi.link_ignored = false                        -- per-item conscious dismissal
        AND NOT EXISTS (
          SELECT 1 FROM amazon_inventory_resolution_queue arq
          WHERE arq.order_item_id = oi.id
            AND arq.status = 'no_inventory'
        )
    ), 0
  ) + COALESCE(
    (
      -- ebay_orders
      SELECT COUNT(*)::integer
      FROM ebay_order_line_items eli
      JOIN ebay_orders eo ON eli.order_id = eo.id
      WHERE eo.user_id = p_user_id
        AND eli.inventory_item_id IS NULL
        AND eo.order_payment_status != 'FULLY_REFUNDED'
        AND COALESCE(eli.quantity, 0) > 0
        AND eli.link_ignored = false
        AND NOT EXISTS (
          SELECT 1 FROM ebay_inventory_resolution_queue erq
          WHERE erq.ebay_line_item_id = eli.id
            AND erq.status = 'no_inventory'
        )
    ), 0
  );
$function$;

-- ---------------------------------------------------------------------------
-- 3. count_all_unlinked_order_items_since - date-bounded, same exclusions
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.count_all_unlinked_order_items_since(p_user_id uuid, p_since_date date)
 RETURNS integer
 LANGUAGE sql
 STABLE SECURITY DEFINER
AS $function$
  SELECT COALESCE(
    (
      SELECT COUNT(*)::integer
      FROM order_items oi
      JOIN platform_orders po ON oi.order_id = po.id
      WHERE po.user_id = p_user_id
        AND po.order_date >= p_since_date
        AND oi.inventory_item_id IS NULL
        AND po.status NOT IN ('Cancelled', 'Cancelled/Refunded', 'Refunded')
        AND po.platform NOT IN ('bricklink', 'brickowl')
        AND COALESCE(oi.quantity, 0) > 0
        AND oi.link_ignored = false
        AND NOT EXISTS (
          SELECT 1 FROM amazon_inventory_resolution_queue arq
          WHERE arq.order_item_id = oi.id
            AND arq.status = 'no_inventory'
        )
    ), 0
  ) + COALESCE(
    (
      SELECT COUNT(*)::integer
      FROM ebay_order_line_items eli
      JOIN ebay_orders eo ON eli.order_id = eo.id
      WHERE eo.user_id = p_user_id
        AND eo.creation_date >= p_since_date
        AND eli.inventory_item_id IS NULL
        AND eo.order_payment_status != 'FULLY_REFUNDED'
        AND COALESCE(eo.inventory_link_status, 'pending') NOT IN ('complete', 'no_inventory', 'cancelled', 'skipped', 'pre_linked')
        AND COALESCE(eli.quantity, 0) > 0
        AND eli.link_ignored = false
        AND NOT EXISTS (
          SELECT 1 FROM ebay_inventory_resolution_queue erq
          WHERE erq.ebay_line_item_id = eli.id
            AND erq.status = 'no_inventory'
        )
    ), 0
  );
$function$;
