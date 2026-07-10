ALTER TABLE fitness_programmes
  ADD COLUMN IF NOT EXISTS deficit_kcal integer NOT NULL DEFAULT 550,
  ADD COLUMN IF NOT EXISTS protein_g_per_kg numeric(4,2) NOT NULL DEFAULT 1.67;

COMMENT ON COLUMN fitness_programmes.deficit_kcal IS 'Daily kcal deficit below TDEE used by the weight-adaptive target engine (compute_current_targets). Lets a programme set a more/less aggressive deficit than the 550 default.';
COMMENT ON COLUMN fitness_programmes.protein_g_per_kg IS 'Protein target in g per kg bodyweight used by the target engine. Default 1.67; raise for stronger lean-mass preservation on an aggressive cut.';;
