DROP POLICY IF EXISTS "chat_messages_insert_own" ON chat_messages;
CREATE POLICY "chat_messages_insert_own" ON chat_messages FOR INSERT TO authenticated
  WITH CHECK (
    player_id = get_player_id()
    AND (
      is_admin()
      OR EXISTS (
        SELECT 1 FROM tournament_entries te
        WHERE te.tournament_id = chat_messages.tournament_id
          AND te.player_id = get_player_id()
      )
    )
  );;
