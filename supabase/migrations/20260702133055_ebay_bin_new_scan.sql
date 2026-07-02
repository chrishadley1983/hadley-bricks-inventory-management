-- BIN watcher NEW-condition scan (sealed): Amazon-resale + New-POV signals.
-- Second broad search per cycle with its own cursor; Amazon prices from the
-- local seeded_asin_pricing table (no Keepa in the loop).
-- Applied to prod via MCP as version 20260702133055.
ALTER TABLE public.ebay_bin_config
  ADD COLUMN IF NOT EXISTS new_scan_enabled        boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS amazon_min_margin_pct   numeric NOT NULL DEFAULT 15,
  ADD COLUMN IF NOT EXISTS amazon_great_margin_pct numeric NOT NULL DEFAULT 25,
  ADD COLUMN IF NOT EXISTS last_scan_cursor_new    timestamptz;
