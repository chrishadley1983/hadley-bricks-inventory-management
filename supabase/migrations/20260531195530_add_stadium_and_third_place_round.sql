
-- Add stadium name to fixtures (city stays in `venue`)
ALTER TABLE group_matches ADD COLUMN IF NOT EXISTS stadium TEXT;
ALTER TABLE knockout_matches ADD COLUMN IF NOT EXISTS stadium TEXT;

-- Allow the third-place play-off as a knockout round
ALTER TABLE knockout_matches DROP CONSTRAINT IF EXISTS knockout_matches_round_check;
ALTER TABLE knockout_matches ADD CONSTRAINT knockout_matches_round_check
  CHECK (round IN ('round_of_32','round_of_16','quarter_final','semi_final','third_place','final'));
;
