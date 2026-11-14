-- Apply AFTER schema.sql. Records episode counts separately from intensity ratings.
alter table public.rb_checkins
  add column tension_episodes smallint not null default 0
    check(tension_episodes between 0 and 30),
  add column anger_episodes smallint not null default 0
    check(anger_episodes between 0 and 30);
alter table public.rb_studies
  add constraint rb_protocol_is_immutable check(
    start_on = date '2026-11-13' and protocol_version = '1.0.0'
  );
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
  if tg_op='INSERT' then new.created_at := now(); end if;
  new.updated_at := now();
  return new;
end;
$$;
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
  new.stopped_at := now();
  return new;
end;
$$;