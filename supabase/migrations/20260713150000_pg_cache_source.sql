-- Provenance for bricklink_price_guide_cache rows.
--
-- Until now the cache recorded WHAT the data is and WHEN (fetched_at, parse_version)
-- but not WHICH lane wrote it — page scrape (catalogPG) vs API live-check were
-- indistinguishable, forcing a queue-join or parse_version proxy to tell them apart
-- (and that proxy is only ~99% accurate). `source` makes it exact:
--   'catalogpg'     — lane D page scrape (PriceGuideCacheService.upsert, finalUrl != bl_api)
--   'api-livecheck' — lane A BL store API (live-check / capturePriceGuide, finalUrl = bl_api)
-- New writes stamp it from PgScrapeResult.finalUrl; see toPgCacheRow.

ALTER TABLE bricklink_price_guide_cache ADD COLUMN IF NOT EXISTS source text;

-- Backfill existing rows from the best available proxy (exact going forward):
--   parse_version = 0  → the live-check partial-write lane (LIVE_CHECK_PARSE_VERSION)
--   parse_version >= 2 → the page-scrape / capture path (PG_PARSE_VERSION history)
-- Historical capturePriceGuide rows (API, but parse_version >= 2) are rare and will
-- self-correct on their next refresh; leaving them tagged 'catalogpg' is acceptable.
UPDATE bricklink_price_guide_cache
SET source = CASE WHEN parse_version = 0 THEN 'api-livecheck' ELSE 'catalogpg' END
WHERE source IS NULL;

CREATE INDEX IF NOT EXISTS idx_pg_cache_source ON bricklink_price_guide_cache (source);

COMMENT ON COLUMN bricklink_price_guide_cache.source IS
  'Lane that last wrote this row: catalogpg (page scrape) | api-livecheck (BL store API). Stamped from PgScrapeResult.finalUrl in toPgCacheRow.';
