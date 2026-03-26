-- Add comment column to bricqer_inventory_snapshot for lot consolidation.
-- Lots are consolidated by (item_number, color_id, condition, comment).
-- "comment" is definition.comment from Bricqer (NOT remarks).

ALTER TABLE bricqer_inventory_snapshot ADD COLUMN comment TEXT;
