-- Add inventory link and color columns to scanner_pieces
ALTER TABLE scanner_pieces ADD COLUMN IF NOT EXISTS inventory_item_id UUID REFERENCES inventory_items(id);
ALTER TABLE scanner_pieces ADD COLUMN IF NOT EXISTS color_id INT;
ALTER TABLE scanner_pieces ADD COLUMN IF NOT EXISTS color_name TEXT;

CREATE INDEX IF NOT EXISTS idx_scanner_pieces_inventory ON scanner_pieces(inventory_item_id) WHERE inventory_item_id IS NOT NULL;
