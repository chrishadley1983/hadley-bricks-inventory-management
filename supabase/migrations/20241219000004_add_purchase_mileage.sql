-- Add mileage tracking fields to purchases table
-- Migration: 20241219000004_add_purchase_mileage

-- Add mileage and collection address fields
ALTER TABLE purchases
ADD COLUMN IF NOT EXISTS mileage DECIMAL(6,1),
ADD COLUMN IF NOT EXISTS collection_address TEXT;

-- Add comment for documentation
COMMENT ON COLUMN purchases.mileage IS 'Round-trip mileage for collection purchases';
COMMENT ON COLUMN purchases.collection_address IS 'Address/postcode where item was collected from';
