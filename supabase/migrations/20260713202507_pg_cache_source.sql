ALTER TABLE bricklink_price_guide_cache ADD COLUMN IF NOT EXISTS source text;
UPDATE bricklink_price_guide_cache
SET source = CASE WHEN parse_version = 0 THEN 'api-livecheck' ELSE 'catalogpg' END
WHERE source IS NULL;
CREATE INDEX IF NOT EXISTS idx_pg_cache_source ON bricklink_price_guide_cache (source);
COMMENT ON COLUMN bricklink_price_guide_cache.source IS
  'Lane that last wrote this row: catalogpg (page scrape) | api-livecheck (BL store API). Stamped from PgScrapeResult.finalUrl in toPgCacheRow.';;
