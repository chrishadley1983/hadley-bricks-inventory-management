
-- Third-place play-off not wanted: restore original 5-round constraint (keep stadium columns)
ALTER TABLE knockout_matches DROP CONSTRAINT IF EXISTS knockout_matches_round_check;
ALTER TABLE knockout_matches ADD CONSTRAINT knockout_matches_round_check
  CHECK (round IN ('round_of_32','round_of_16','quarter_final','semi_final','final'));
;
