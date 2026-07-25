ALTER TABLE brickset_sets
  ADD COLUMN IF NOT EXISTS asin_source text,
  ADD COLUMN IF NOT EXISTS asin_confidence integer,
  ADD COLUMN IF NOT EXISTS asin_verified_at timestamptz,
  ADD COLUMN IF NOT EXISTS barcode_source text;

COMMENT ON COLUMN brickset_sets.asin_source IS
  'How amazon_asin was derived. Barcode methods (keepa_ean/keepa_upc/spapi_*) are authoritative; title_* are low-trust guesses. Set by the identity enrichment pipeline.';
COMMENT ON COLUMN brickset_sets.asin_confidence IS
  '0-100 confidence in amazon_asin. 100=EAN, 95=UPC, 60-85=title similarity. Consumers should gate on this (e.g. arbitrage view uses >=95).';
COMMENT ON COLUMN brickset_sets.barcode_source IS
  'Origin of ean/upc: brickset (native API/seed), keepa/spapi (backfilled from the Amazon product for a known ASIN), csv.';

UPDATE brickset_sets bs
SET asin_source = CASE sa.match_method
      WHEN 'ean' THEN 'keepa_ean' WHEN 'upc' THEN 'keepa_upc'
      WHEN 'title_exact' THEN 'title_exact' WHEN 'title_fuzzy' THEN 'title_fuzzy'
      ELSE sa.match_method END,
    asin_confidence = sa.match_confidence
FROM seeded_asins sa
WHERE bs.amazon_asin IS NOT NULL AND bs.amazon_asin = sa.asin
  AND sa.discovery_status = 'found' AND bs.asin_source IS NULL;

UPDATE brickset_sets SET barcode_source = 'brickset'
WHERE (ean IS NOT NULL OR upc IS NOT NULL) AND barcode_source IS NULL;

CREATE INDEX IF NOT EXISTS idx_brickset_asin_confidence ON brickset_sets (asin_confidence);;
