-- Unified price cache F9: retire the legacy per-part price cache.
-- All readers/writers now go through bricklink_price_guide_cache via the common
-- functions (readPriceGuide / ensurePriceGuide / capturePriceGuide).
--
-- Rename (not drop) so this is reversible; drop after a healthy prod cycle.
ALTER TABLE IF EXISTS public.bricklink_part_price_cache
  RENAME TO bricklink_part_price_cache_deprecated;

COMMENT ON TABLE public.bricklink_part_price_cache_deprecated IS
  'DEPRECATED 2026-07-09 (unified-price-cache F9). Replaced by bricklink_price_guide_cache. Renamed for reversibility; drop after a healthy prod cycle.';
