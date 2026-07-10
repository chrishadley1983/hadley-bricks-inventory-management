-- Goal/phase model for the fitness programme. A programme can declare a
-- current goal phase (e.g. fat_loss vs muscle_build) and the protein target +
-- coaching framing are resolved from it, instead of being hardcoded in the
-- dashboard/skills. The engine auto-switches phases on a metric trigger
-- (e.g. BMI crossing into the healthy range). Absent goal_config => legacy
-- weight-adaptive behaviour (protein_g_per_kg column), so existing rows are
-- unaffected.
ALTER TABLE fitness_programmes
  ADD COLUMN IF NOT EXISTS goal_config jsonb;

COMMENT ON COLUMN fitness_programmes.goal_config IS
  'Goal/phase config driving the protein target and coaching framing. Shape: {current_phase, auto_switch:{metric,below,to_phase}, phases:{<name>:{label,focus,protein:{mode:fixed|adaptive,g|g_per_kg},protein_note,rule}}}. NULL => legacy weight-adaptive protein from protein_g_per_kg. Editable by Peter via PUT /fitness/goal.';;
