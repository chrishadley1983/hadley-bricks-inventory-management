drop policy if exists "Admins can update messages" on chat_messages;
create policy "Admins can update messages" on chat_messages
  for update to authenticated using (is_admin()) with check (is_admin());;
