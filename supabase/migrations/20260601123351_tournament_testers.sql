CREATE TABLE tournament_testers (
  tournament_id UUID NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
  player_id UUID NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY (tournament_id, player_id)
);

ALTER TABLE tournament_testers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tournament_testers_select_self_or_admin"
  ON tournament_testers FOR SELECT
  TO authenticated
  USING (player_id = get_player_id() OR is_admin());

CREATE POLICY "tournament_testers_insert_admin"
  ON tournament_testers FOR INSERT
  TO authenticated
  WITH CHECK (is_admin());

CREATE POLICY "tournament_testers_update_admin"
  ON tournament_testers FOR UPDATE
  TO authenticated
  USING (is_admin());

CREATE POLICY "tournament_testers_delete_admin"
  ON tournament_testers FOR DELETE
  TO authenticated
  USING (is_admin());

CREATE OR REPLACE FUNCTION is_tournament_tester(t_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1
    FROM tournament_testers tt
    JOIN players p ON p.id = tt.player_id
    WHERE tt.tournament_id = t_id
      AND p.auth_user_id = auth.uid()
  );
END;
$$;

DROP POLICY IF EXISTS "tournaments_select_authenticated" ON tournaments;
CREATE POLICY "tournaments_select_authenticated"
  ON tournaments FOR SELECT
  TO authenticated
  USING (
    is_visible = true
    OR is_admin()
    OR is_tournament_tester(id)
  );;
