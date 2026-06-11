-- Force PostgREST to re-introspect the self-referencing reply FK (its schema
-- cache was stale and the chat query's reply embed failed with PGRST200).
ALTER TABLE chat_messages DROP CONSTRAINT IF EXISTS chat_messages_reply_to_id_fkey;
ALTER TABLE chat_messages
  ADD CONSTRAINT chat_messages_reply_to_id_fkey
  FOREIGN KEY (reply_to_id) REFERENCES chat_messages(id) ON DELETE SET NULL;
NOTIFY pgrst, 'reload schema';;
