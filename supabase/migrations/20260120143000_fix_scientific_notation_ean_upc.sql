-- Migration: Fix scientific notation EAN/UPC values
--
-- Problem: During Brickset import, large numbers (EAN/UPC barcodes) were stored
-- in scientific notation format (e.g., "5.70E+12" instead of "5702016913569").
-- This prevents the ASIN discovery service from using these barcodes for Amazon lookups.
--
-- Solution: Convert scientific notation strings back to proper barcode format.
-- EAN codes are 13 digits, UPC codes are 12 digits.

-- First, let's see the scope of the problem (for logging)
DO $$
DECLARE
  corrupted_ean_count INTEGER;
  corrupted_upc_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO corrupted_ean_count
  FROM brickset_sets
  WHERE ean LIKE '%E+%' OR ean LIKE '%e+%';

  SELECT COUNT(*) INTO corrupted_upc_count
  FROM brickset_sets
  WHERE upc LIKE '%E+%' OR upc LIKE '%e+%';

  RAISE NOTICE 'Found % corrupted EAN values and % corrupted UPC values', corrupted_ean_count, corrupted_upc_count;
END $$;

-- Fix EAN values (should be 13 digits)
-- Scientific notation like "5.70E+12" means 5.70 × 10^12
-- We convert to numeric, then to text, padding to 13 digits
UPDATE brickset_sets
SET ean = LPAD(TRIM(TO_CHAR(ean::NUMERIC, '9999999999999')), 13, '0')
WHERE ean LIKE '%E+%' OR ean LIKE '%e+%';

-- Fix UPC values (should be 12 digits)
-- Similar conversion but padding to 12 digits
UPDATE brickset_sets
SET upc = LPAD(TRIM(TO_CHAR(upc::NUMERIC, '999999999999')), 12, '0')
WHERE upc LIKE '%E+%' OR upc LIKE '%e+%';

-- Verify the fix
DO $$
DECLARE
  remaining_ean INTEGER;
  remaining_upc INTEGER;
  sample_ean TEXT;
  sample_set TEXT;
BEGIN
  SELECT COUNT(*) INTO remaining_ean
  FROM brickset_sets
  WHERE ean LIKE '%E+%' OR ean LIKE '%e+%';

  SELECT COUNT(*) INTO remaining_upc
  FROM brickset_sets
  WHERE upc LIKE '%E+%' OR upc LIKE '%e+%';

  -- Get a sample to verify format
  SELECT ean, set_number INTO sample_ean, sample_set
  FROM brickset_sets
  WHERE ean IS NOT NULL AND LENGTH(ean) = 13
  LIMIT 1;

  RAISE NOTICE 'After fix: % corrupted EAN, % corrupted UPC remaining', remaining_ean, remaining_upc;
  RAISE NOTICE 'Sample EAN: % for set %', sample_ean, sample_set;
END $$;

-- Now reset the affected seeded_asins records to 'pending' so they can be rediscovered
-- with the corrected EAN/UPC values
UPDATE seeded_asins sa
SET
  discovery_status = 'pending',
  discovery_attempts = 0,
  discovery_error = NULL,
  asin = NULL,
  match_method = NULL,
  match_confidence = NULL,
  amazon_title = NULL,
  amazon_price = NULL,
  amazon_image_url = NULL,
  amazon_brand = NULL,
  alternative_asins = NULL,
  last_discovery_attempt_at = NULL
FROM brickset_sets bs
WHERE sa.brickset_set_id = bs.id
  AND sa.discovery_status IN ('not_found', 'multiple')
  AND (
    (bs.ean IS NOT NULL AND bs.ean ~ '^\d{13}$')
    OR (bs.upc IS NOT NULL AND bs.upc ~ '^\d{12}$')
  );

-- Log how many were reset
DO $$
DECLARE
  reset_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO reset_count
  FROM seeded_asins
  WHERE discovery_status = 'pending';

  RAISE NOTICE 'Total pending seeded_asins ready for rediscovery: %', reset_count;
END $$;
