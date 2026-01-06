-- Add purchase_id foreign key to inventory_items table
-- Migration: 20250106000002_add_inventory_purchase_fk
--
-- This adds a proper FK relationship between inventory_items and purchases,
-- replacing the text-based linked_lot field for purchase linking.

-- Add purchase_id column with FK constraint
ALTER TABLE inventory_items
ADD COLUMN purchase_id UUID REFERENCES purchases(id) ON DELETE SET NULL;

-- Create index for the foreign key
CREATE INDEX idx_inventory_purchase ON inventory_items(purchase_id);

-- Migrate existing data: match linked_lot text to purchase reference
-- This updates inventory items where linked_lot matches a purchase reference
UPDATE inventory_items inv
SET purchase_id = p.id
FROM purchases p
WHERE inv.linked_lot IS NOT NULL
  AND inv.linked_lot != ''
  AND inv.purchase_id IS NULL
  AND p.user_id = inv.user_id
  AND LOWER(TRIM(inv.linked_lot)) = LOWER(TRIM(p.reference));

-- Note: linked_lot column is kept for now as it may have other uses
-- and serves as a backup during migration. It can be removed later if desired.
