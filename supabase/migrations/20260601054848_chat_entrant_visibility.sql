-- Chat visibility: only registered entrants may read a tournament's chat;
-- co-entrants can resolve each other's player display info.

DROP POLICY IF EXISTS "chat_messages_select_authenticated" ON chat_messages;
CREATE POLICY "chat_messages_select_entrants" ON chat_messages
  FOR SELECT TO authenticated
  USING (
    is_admin()
    OR EXISTS (
      SELECT 1 FROM tournament_entries te
      WHERE te.tournament_id = chat_messages.tournament_id
        AND te.player_id = get_player_id()
    )
  );

DROP POLICY IF EXISTS "chat_messages_select_anon" ON chat_messages;

DROP POLICY IF EXISTS "players_select_co_entrants" ON players;
CREATE POLICY "players_select_co_entrants" ON players
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM tournament_entries te_them
      JOIN tournament_entries te_me
        ON te_me.tournament_id = te_them.tournament_id
      WHERE te_them.player_id = players.id
        AND te_me.player_id = get_player_id()
    )
  );

NOTIFY pgrst, 'reload schema';;
