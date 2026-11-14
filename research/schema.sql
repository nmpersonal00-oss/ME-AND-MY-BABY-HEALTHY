-- Relationship Boundaries: private, two-person, observational database.
-- Isolated rb_ tables; no existing Wifey & Hubby tables are modified.
-- Run in the Wifey & Hubby Supabase Postgres project only once.
create schema if not exists rb_private;
revoke all on schema rb_private from public, anon;
grant usage on schema rb_private to authenticated;

create table if not exists public.rb_studies (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  title text not null default 'Personal observational study' check (char_length(title) between 1 and 140),
  start_on date not null default date '2026-11-13',
  timezone text not null default 'America/Los_Angeles'
    check (timezone in ('America/Los_Angeles','America/Winnipeg','UTC')),
  protocol_version text not null default '1.0.0',
  status text not null default 'active' check (status in ('active','stopped')),
  ended_at timestamptz,
  stop_reason text check (stop_reason in ('boundary','voluntary','other')),
  created_at timestamptz not null default now(),
  constraint rb_study_end_consistent check (
    (status='active' and ended_at is null and stop_reason is null)
    or (status='stopped' and ended_at is not null and stop_reason is not null)
  )
);

create table if not exists public.rb_members (
  study_id uuid not null references public.rb_studies(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('owner','participant')),
  nickname text not null default 'Participant' check (char_length(nickname) between 1 and 60),
  joined_at timestamptz not null default now(),
  consented_at timestamptz not null default now(),
  withdrawn_at timestamptz,
  primary key (study_id,user_id)
);
create index if not exists rb_members_user_idx on public.rb_members(user_id);

create table if not exists public.rb_invites (
  id uuid primary key default gen_random_uuid(),
  study_id uuid not null references public.rb_studies(id) on delete cascade,
  created_by uuid not null references auth.users(id) on delete cascade,
  token_hash text not null check (token_hash ~ '^[a-f0-9]{64}$'),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '7 days'),
  used_at timestamptz,
  used_by uuid references auth.users(id),
  unique (study_id,token_hash)
);
create index if not exists rb_invites_lookup_idx
  on public.rb_invites(study_id,token_hash) where used_at is null;

-- The invitation code is never stored: a trigger validates it and clears it.
create table if not exists public.rb_join_requests (
  id uuid primary key default gen_random_uuid(),
  study_id uuid not null references public.rb_studies(id) on delete cascade,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  invite_token text,
  requested_at timestamptz not null default now(),
  unique (study_id,user_id),
  check (invite_token is null)
);

create table if not exists public.rb_checkins (
  id uuid primary key default gen_random_uuid(),
  study_id uuid not null references public.rb_studies(id) on delete cascade,
  author_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  local_date date not null,
  calm smallint not null check (calm between 0 and 10),
  tension smallint not null check (tension between 0 and 10),
  anger smallint not null check (anger between 0 and 10),
  happiness smallint not null check (happiness between 0 and 10),
  connectedness smallint not null check (connectedness between 0 and 10),
  disagreement_episodes smallint not null check (disagreement_episodes between 0 and 30),
  outside_stress smallint check (outside_stress between 0 and 10),
  communication_quality smallint check (communication_quality between 0 and 10),
  sleep_hours numeric(3,1) check (sleep_hours between 0 and 24),
  together_minutes smallint check (together_minutes between 0 and 1440),
  notes text check (char_length(notes) <= 2000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (study_id,author_id,local_date)
);
create index if not exists rb_checkins_owner_date_idx
  on public.rb_checkins(author_id,study_id,local_date);

create table if not exists public.rb_checkin_audit (
  id bigint generated always as identity primary key,
  checkin_id uuid not null references public.rb_checkins(id) on delete cascade,
  author_id uuid not null references auth.users(id) on delete cascade,
  old_row jsonb not null,
  new_row jsonb not null,
  edited_at timestamptz not null default now()
);
create index if not exists rb_checkin_audit_author_idx on public.rb_checkin_audit(author_id);

create table if not exists public.rb_stops (
  id uuid primary key default gen_random_uuid(),
  study_id uuid not null unique references public.rb_studies(id) on delete cascade,
  reported_by uuid not null references auth.users(id) on delete cascade,
  reason text not null check (reason in ('boundary','voluntary','other')),
  boundary_code text check (boundary_code in
    ('physical_contact','uncovered_body','sexual_flirting','undressing')),
  stopped_at timestamptz not null default now(),
  check ((reason='boundary' and boundary_code is not null)
      or (reason<>'boundary' and boundary_code is null))
);

-- Privileged functions live outside exposed public schema; authorization is
-- always derived from auth.uid(), never user-editable JWT metadata.
create or replace function rb_private.is_member(p_study uuid)
returns boolean language sql stable security definer set search_path = ''
as $$
  select exists(select 1 from public.rb_members m
    where m.study_id=p_study and m.user_id=(select auth.uid()));
$$;

create or replace function rb_private.can_write(p_study uuid)
returns boolean language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.rb_members m
    join public.rb_studies s on s.id=m.study_id
    where m.study_id=p_study and m.user_id=(select auth.uid())
      and m.withdrawn_at is null and s.status='active'
  );
$$;

create or replace function rb_private.add_owner()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  insert into public.rb_members(study_id,user_id,role,nickname)
  values(new.id,new.owner_id,'owner','Researcher');
  return new;
end;
$$;
drop trigger if exists rb_add_owner on public.rb_studies;
create trigger rb_add_owner after insert on public.rb_studies
for each row execute function rb_private.add_owner();

create or replace function rb_private.join_with_invite()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare v_status text; v_invite uuid;
begin
  if (select auth.uid()) is null then raise exception 'Sign in first'; end if;
  new.user_id := (select auth.uid());
  if new.invite_token is null or char_length(new.invite_token) < 40 then
    raise exception 'Invalid invitation';
  end if;
  select status into v_status from public.rb_studies
    where id=new.study_id for update;
  if v_status is distinct from 'active' then
    raise exception 'Study is unavailable or stopped';
  end if;
  if exists(select 1 from public.rb_members where study_id=new.study_id and user_id=new.user_id) then
    raise exception 'Already a participant';
  end if;
  if (select count(*) from public.rb_members where study_id=new.study_id) >= 2 then
    raise exception 'Study already has two participants';
  end if;
  select id into v_invite from public.rb_invites
    where study_id=new.study_id
      and token_hash=encode(sha256(convert_to(new.invite_token,'UTF8')),'hex')
      and used_at is null and expires_at>now()
    order by created_at desc limit 1 for update;
  if v_invite is null then raise exception 'Invalid or expired invitation'; end if;
  insert into public.rb_members(study_id,user_id,role,nickname)
  values(new.study_id,new.user_id,'participant','Participant');
  update public.rb_invites set used_at=now(), used_by=new.user_id where id=v_invite;
  new.invite_token := null; -- no plaintext token at rest
  return new;
end;
$$;
drop trigger if exists rb_process_join on public.rb_join_requests;
create trigger rb_process_join before insert on public.rb_join_requests
for each row execute function rb_private.join_with_invite();

create or replace function rb_private.guard_checkin()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare v_start date; v_tz text; v_status text;
begin
  if new.author_id is distinct from (select auth.uid()) then
    raise exception 'Only self-reports are permitted';
  end if;
  if tg_op='UPDATE' and (
    new.id is distinct from old.id or
    new.study_id is distinct from old.study_id or
    new.author_id is distinct from old.author_id or
    new.local_date is distinct from old.local_date or
    new.created_at is distinct from old.created_at
  ) then raise exception 'The identity and date of an entry cannot change'; end if;
  select start_on,timezone,status into v_start,v_tz,v_status
    from public.rb_studies where id=new.study_id for share;
  if v_status is distinct from 'active'
     or not rb_private.can_write(new.study_id) then
    raise exception 'Study is stopped or you withdrew';
  end if;
  if new.local_date < v_start or
     new.local_date > (now() at time zone v_tz)::date then
    raise exception 'Entry date is outside the observation window';
  end if;
  if tg_op='UPDATE' then new.updated_at:=now(); end if;
  return new;
end;
$$;
drop trigger if exists rb_guard_checkin on public.rb_checkins;
create trigger rb_guard_checkin before insert or update on public.rb_checkins
for each row execute function rb_private.guard_checkin();

create or replace function rb_private.audit_checkin()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  insert into public.rb_checkin_audit(checkin_id,author_id,old_row,new_row)
  values(old.id,old.author_id,to_jsonb(old),to_jsonb(new));
  return new;
end;
$$;
drop trigger if exists rb_audit_checkin on public.rb_checkins;
create trigger rb_audit_checkin after update on public.rb_checkins
for each row execute function rb_private.audit_checkin();

create or replace function rb_private.guard_stop()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare v_status text;
begin
  if new.reported_by is distinct from (select auth.uid()) then
    raise exception 'Cannot report for someone else';
  end if;
  select status into v_status from public.rb_studies
    where id=new.study_id for update;
  if v_status is distinct from 'active'
     or not rb_private.can_write(new.study_id) then
    raise exception 'This observation is already stopped';
  end if;
  return new;
end;
$$;
drop trigger if exists rb_guard_stop on public.rb_stops;
create trigger rb_guard_stop before insert on public.rb_stops
for each row execute function rb_private.guard_stop();

create or replace function rb_private.apply_stop()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  update public.rb_studies set status='stopped', ended_at=new.stopped_at,
    stop_reason=new.reason where id=new.study_id and status='active';
  return new;
end;
$$;
drop trigger if exists rb_apply_stop on public.rb_stops;
create trigger rb_apply_stop after insert on public.rb_stops
for each row execute function rb_private.apply_stop();

create or replace function rb_private.guard_member_edit()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  if new.user_id is distinct from old.user_id or
     new.study_id is distinct from old.study_id or
     new.role is distinct from old.role or
     new.joined_at is distinct from old.joined_at or
     new.consented_at is distinct from old.consented_at then
    raise exception 'Membership identities are immutable';
  end if;
  if old.withdrawn_at is not null and new.withdrawn_at is distinct from old.withdrawn_at then
    raise exception 'Withdrawal cannot be reversed';
  end if;
  if old.withdrawn_at is null and new.withdrawn_at is not null then
    new.withdrawn_at := now();
    if exists(select 1 from public.rb_studies
      where id=new.study_id and status='active') then
      insert into public.rb_stops(study_id,reported_by,reason)
      values(new.study_id,new.user_id,'voluntary');
    end if;
  end if;
  return new;
end;
$$;
drop trigger if exists rb_guard_member_edit on public.rb_members;
create trigger rb_guard_member_edit before update on public.rb_members
for each row execute function rb_private.guard_member_edit();

-- Every public table has RLS enabled and explicit per-table permissions.
alter table public.rb_studies enable row level security;
alter table public.rb_members enable row level security;
alter table public.rb_invites enable row level security;
alter table public.rb_join_requests enable row level security;
alter table public.rb_checkins enable row level security;
alter table public.rb_checkin_audit enable row level security;
alter table public.rb_stops enable row level security;

create policy rb_study_read on public.rb_studies for select to authenticated
  using (rb_private.is_member(id));
create policy rb_study_create on public.rb_studies for insert to authenticated
  with check (owner_id=(select auth.uid()) and status='active'
    and ended_at is null and stop_reason is null);
create policy rb_members_read on public.rb_members for select to authenticated
  using (rb_private.is_member(study_id));
create policy rb_members_self_edit on public.rb_members for update to authenticated
  using (user_id=(select auth.uid()))
  with check (user_id=(select auth.uid()));
create policy rb_invites_read on public.rb_invites for select to authenticated
  using (created_by=(select auth.uid()) and rb_private.is_member(study_id));
create policy rb_invites_create on public.rb_invites for insert to authenticated
  with check (created_by=(select auth.uid())
    and exists(select 1 from public.rb_studies s
      where s.id=study_id and s.owner_id=(select auth.uid()) and s.status='active')
    and expires_at>now() and expires_at<=now()+interval '14 days');
create policy rb_join_create on public.rb_join_requests for insert to authenticated
  with check (user_id=(select auth.uid()));
create policy rb_join_self_read on public.rb_join_requests for select to authenticated
  using (user_id=(select auth.uid()));
create policy rb_checkins_self_read on public.rb_checkins for select to authenticated
  using (author_id=(select auth.uid()));
create policy rb_checkins_self_create on public.rb_checkins for insert to authenticated
  with check (author_id=(select auth.uid()) and rb_private.can_write(study_id));
create policy rb_checkins_self_edit on public.rb_checkins for update to authenticated
  using (author_id=(select auth.uid()) and rb_private.can_write(study_id))
  with check (author_id=(select auth.uid()) and rb_private.can_write(study_id));
create policy rb_checkins_self_delete on public.rb_checkins for delete to authenticated
  using (author_id=(select auth.uid()));
create policy rb_audit_self_read on public.rb_checkin_audit for select to authenticated
  using (author_id=(select auth.uid()));
create policy rb_stops_member_read on public.rb_stops for select to authenticated
  using (rb_private.is_member(study_id));
create policy rb_stops_member_create on public.rb_stops for insert to authenticated
  with check (reported_by=(select auth.uid()) and rb_private.can_write(study_id));

revoke all on public.rb_studies,public.rb_members,public.rb_invites,
  public.rb_join_requests,public.rb_checkins,public.rb_checkin_audit,
  public.rb_stops from anon,authenticated;
grant select,insert on public.rb_studies to authenticated;
grant select,update(nickname,withdrawn_at) on public.rb_members to authenticated;
grant select,insert on public.rb_invites to authenticated;
grant select,insert on public.rb_join_requests to authenticated;
grant select,insert,update,delete on public.rb_checkins to authenticated;
grant select on public.rb_checkin_audit to authenticated;
grant select,insert on public.rb_stops to authenticated;

revoke all on all functions in schema rb_private from public,anon,authenticated;
grant execute on function rb_private.is_member(uuid) to authenticated;
grant execute on function rb_private.can_write(uuid) to authenticated;
