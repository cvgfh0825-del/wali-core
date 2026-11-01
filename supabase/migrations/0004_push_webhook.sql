-- ربط جدول notifications بدالة push-notify (بديل Database Webhook من لوحة Supabase)
-- بعد التشغيل: insert into private.config values ('push_url', 'https://<ref>.supabase.co/functions/v1/push-notify'), ('webhook_secret', '<WEBHOOK_SECRET>');
create extension if not exists pg_net with schema extensions;

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;
create table if not exists private.config (key text primary key, value text not null);

create or replace function private.push_notification() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_url text; v_secret text;
begin
  select value into v_url from private.config where key = 'push_url';
  select value into v_secret from private.config where key = 'webhook_secret';
  if v_url is not null then
    perform net.http_post(
      url := v_url,
      body := jsonb_build_object('type', 'INSERT', 'table', 'notifications', 'record', to_jsonb(new)),
      headers := jsonb_build_object('Content-Type', 'application/json', 'x-webhook-secret', coalesce(v_secret, ''))
    );
  end if;
  return new;
end $$;

drop trigger if exists push_notification on public.notifications;
create trigger push_notification after insert on public.notifications
  for each row execute function private.push_notification();
