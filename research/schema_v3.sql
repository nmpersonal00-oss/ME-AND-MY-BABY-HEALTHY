-- Reject temporary anonymous Supabase sessions for private research access.
-- Does not change other applications' policies or Supabase Auth settings.
create or replace function rb_private.is_permanent_actor()
returns boolean language sql stable security definer set search_path = ''
as $$
 select (select auth.uid()) is not null
    and coalesce((select auth.jwt())->>'is_anonymous','false') <> 'true';
$$;

create or replace function rb_private.is_member(p_study uuid)
returns boolean language sql stable security definer set search_path = ''
as $$
  select rb_private.is_permanent_actor() and exists(
    select 1 from public.rb_members m
    where m.study_id=p_study and m.user_id=(select auth.uid())
  );
$$;

create or replace function rb_private.can_write(p_study uuid)
returns boolean language sql stable security definer set search_path = ''
as $$
  select rb_private.is_permanent_actor() and exists(
    select 1 from public.rb_members m
    join public.rb_studies s on s.id=m.study_id
    where m.study_id=p_study and m.user_id=(select auth.uid())
      and m.withdrawn_at is null and s.status='active'
  );
$$;

drop policy rb_study_create on public.rb_studies;
create policy rb_study_create on public.rb_studies
 for insert to authenticated with check (
  rb_private.is_permanent_actor()
  and owner_id=(select auth.uid()) and status='active'
  and ended_at is null and stop_reason is null
);

drop policy rb_join_create on public.rb_join_requests;
create policy rb_join_create on public.rb_join_requests
 for insert to authenticated with check (
   rb_private.is_permanent_actor() and user_id=(select auth.uid())
 );

revoke all on function rb_private.is_permanent_actor() from public,anon,authenticated;
grant execute on function rb_private.is_permanent_actor() to authenticated;
