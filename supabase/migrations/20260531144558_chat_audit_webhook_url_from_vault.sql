create or replace function public.chat_messages_audit_notify()
returns trigger language plpgsql security definer
set search_path = public, extensions, vault as $$
declare secret text; webhook_url text;
begin
  select decrypted_secret into secret      from vault.decrypted_secrets where name = 'chat_audit_secret'      limit 1;
  select decrypted_secret into webhook_url  from vault.decrypted_secrets where name = 'chat_audit_webhook_url' limit 1;
  if secret is null or secret = '' then
    raise warning 'chat_messages_audit_notify: vault secret "chat_audit_secret" is missing; skipping webhook for message %', new.id; return new;
  end if;
  if webhook_url is null or webhook_url = '' then
    raise warning 'chat_messages_audit_notify: vault secret "chat_audit_webhook_url" is missing; skipping webhook for message %', new.id; return new;
  end if;
  perform net.http_post(
    url := webhook_url,
    body := jsonb_build_object('message_id', new.id),
    headers := jsonb_build_object('Content-Type','application/json','X-Audit-Secret', secret));
  return new;
exception when others then
  raise warning 'chat_messages_audit_notify failed for message %: %', new.id, sqlerrm; return new;
end $$;;
