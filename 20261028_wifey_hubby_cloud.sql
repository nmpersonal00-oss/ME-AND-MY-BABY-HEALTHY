-- Run only in a NEW, DEDICATED Wifey & Hubby Supabase project.
-- Existing Tulip & Honey Closet project must NOT be modified.

create table if not exists public.wh_documents (
  user_id uuid not null references auth.users(id) on delete cascade,
  document_key text not null check (document_key ~ '^wifey-hubby-[a-z0-9-]{1,100}$'),
  value text not null,
  updated_at timestamptz not null default now(),
  primary key(user_id, document_key)
);
create table if not exists public.wh_push_subscriptions (
  endpoint text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  p256dh text not null,
  auth text not null,
  time_zone text not null default 'UTC',
  enabled boolean not null default true,
  updated_at timestamptz not null default now()
);
create index if not exists wh_push_subscriptions_owner_idx on public.wh_push_subscriptions(user_id);
create table if not exists public.wh_push_deliveries (
  user_id uuid not null references auth.users(id) on delete cascade,
  endpoint text not null,
  reminder_key text not null,
  created_at timestamptz not null default now(),
  primary key(user_id, endpoint, reminder_key)
);
create index if not exists wh_push_deliveries_created_idx on public.wh_push_deliveries(created_at);

create or replace function public.wh_touch_updated_at() returns trigger language plpgsql set search_path = '' as $$
begin
 new.updated_at=now(); return new;
end $$;
drop trigger if exists wh_docs_touch on public.wh_documents;
create trigger wh_docs_touch before update on public.wh_documents for each row execute function public.wh_touch_updated_at();
drop trigger if exists wh_subscriptions_touch on public.wh_push_subscriptions;
create trigger wh_subscriptions_touch before update on public.wh_push_subscriptions for each row execute function public.wh_touch_updated_at();

alter table public.wh_documents enable row level security;
alter table public.wh_push_subscriptions enable row level security;
alter table public.wh_push_deliveries enable row level security;

-- An authenticated account can read/write ONLY its own app data.
create policy wh_documents_select on public.wh_documents for select to authenticated using ((select auth.uid())=user_id);
create policy wh_documents_insert on public.wh_documents for insert to authenticated with check ((select auth.uid())=user_id);
create policy wh_documents_update on public.wh_documents for update to authenticated using ((select auth.uid())=user_id) with check ((select auth.uid())=user_id);
create policy wh_documents_delete on public.wh_documents for delete to authenticated using ((select auth.uid())=user_id);
create policy wh_push_select on public.wh_push_subscriptions for select to authenticated using ((select auth.uid())=user_id);
create policy wh_push_insert on public.wh_push_subscriptions for insert to authenticated with check ((select auth.uid())=user_id);
create policy wh_push_update on public.wh_push_subscriptions for update to authenticated using ((select auth.uid())=user_id) with check ((select auth.uid())=user_id);
create policy wh_push_delete on public.wh_push_subscriptions for delete to authenticated using ((select auth.uid())=user_id);
-- wh_push_deliveries intentionally has NO client policies. Only backend service role can access it.

grant usage on schema public to authenticated;
grant select,insert,update,delete on public.wh_documents to authenticated;
grant select,insert,update,delete on public.wh_push_subscriptions to authenticated;
revoke all on public.wh_push_deliveries from anon, authenticated;

-- To keep old successful delivery receipts from growing without bound, optionally schedule
-- a monthly cleanup after cron is configured:
-- delete from public.wh_push_deliveries where created_at < now() - interval '400 days';

-- Server-only private Web Push credentials, stored in Supabase Vault.
-- Populate wh_vapid_public, wh_vapid_private, wh_vapid_subject, wh_cron_secret
-- using private SQL editor actions. Do not put their values into migration files.
create or replace function public.wh_server_push_secrets() returns jsonb
language sql security definer set search_path='' as $fn$
  select coalesce(jsonb_object_agg(name,decrypted_secret),'{}'::jsonb)
  from vault.decrypted_secrets
  where name in ('wh_vapid_public','wh_vapid_private','wh_vapid_subject','wh_cron_secret')
$fn$;
revoke all on function public.wh_server_push_secrets() from public,anon,authenticated;
grant execute on function public.wh_server_push_secrets() to service_role;
