-- Vinted Sniper decisions log.
--
-- The browser extension at Discord-Messenger/FB Refresh/vinted-sniper scans
-- Vinted catalog pages and decides per listing whether to send a Discord alert.
-- Today only successful Gemini Vision calls are logged (gemini_api_usage), so
-- there is no record of: brand-gated rejects, low-margin rejects, name-mismatch
-- rejects, no-Amazon-price rejects, or what was actually sent.
--
-- This table captures every per-listing decision with the full snapshot needed
-- to retrospectively review false negatives (bargains we silently skipped).

CREATE TABLE vinted_sniper_decisions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  scanned_at      TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- Listing snapshot
  listing_id      TEXT NOT NULL,
  listing_url     TEXT,
  image_url       TEXT,
  raw_title       TEXT,
  brand           TEXT,
  condition_text  TEXT,
  price_num       NUMERIC(10,2),
  price_incl_num  NUMERIC(10,2),

  -- Set identification trail
  set_num_text     TEXT,         -- regex hit from title/slug
  set_num_vision   TEXT,         -- Gemini result, if vision was called
  set_num_used     TEXT,         -- final pick that drove pricing lookup
  vision_raw       TEXT,         -- raw Gemini response text
  vision_features  JSONB,        -- ["red car","minifig","wheels"]
  vision_confidence TEXT,        -- "high" | "medium" | "low"

  -- BrickSet catalog cross-check (Option I)
  catalog_hit     BOOLEAN,       -- did set_num_used resolve in brickset_sets?
  catalog_theme   TEXT,          -- e.g. "Star Wars"
  catalog_name    TEXT,          -- canonical set_name
  theme_mismatch  BOOLEAN,       -- title implied a different theme

  -- Pricing lookup (seeded_asin_pricing or Keepa)
  set_name        TEXT,          -- name from price source
  asin            TEXT,
  amazon_price    NUMERIC(10,2),
  was_price_90d   NUMERIC(10,2),
  rrp             NUMERIC(10,2),
  name_match      BOOLEAN,       -- title↔set_name fuzzy match (option D)

  -- Outcome
  cog             NUMERIC(10,2),
  margin_pct      NUMERIC(6,2),
  profit          NUMERIC(10,2),
  decision        TEXT NOT NULL,
  decision_reason TEXT,

  CONSTRAINT vinted_sniper_decisions_decision_check CHECK (decision IN (
    'sent_green',
    'sent_amber',
    'skipped_brand_not_lego',
    'skipped_excluded_pattern',
    'skipped_no_set_number',
    'skipped_no_amazon_price',
    'skipped_low_margin',
    'skipped_name_mismatch',
    'skipped_vision_unverified'
  ))
);

CREATE INDEX vinted_sniper_decisions_scanned_at_idx
  ON vinted_sniper_decisions (scanned_at DESC);
CREATE INDEX vinted_sniper_decisions_decision_idx
  ON vinted_sniper_decisions (decision);
CREATE INDEX vinted_sniper_decisions_listing_id_idx
  ON vinted_sniper_decisions (listing_id);

-- RLS: extension writes via anon key; only authenticated users read.
ALTER TABLE vinted_sniper_decisions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "anon can insert decisions"
  ON vinted_sniper_decisions
  FOR INSERT
  TO anon
  WITH CHECK (true);

CREATE POLICY "authenticated can read decisions"
  ON vinted_sniper_decisions
  FOR SELECT
  TO authenticated
  USING (true);

COMMENT ON TABLE vinted_sniper_decisions IS
  'Every scan decision made by the Vinted Sniper extension. Used to '
  'retrospectively audit false negatives after gates were tightened.';
