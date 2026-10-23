-- Task 167 staged installation. Controls remain disabled until coordinated activation.
-- Requires reviewed backup, base migrations and Auth configuration. Do not rerun
-- after successful installation. Does not reset existing projects or identities.
begin;
create table clickdeck_private.read_control (
  id integer primary key check (id=1), enabled boolean not null default false
);
insert into clickdeck_private.read_control(id) values(1);
create table clickdeck_private.read_budget (
  user_id uuid primary key references auth.users(id) on delete cascade,
  window_start timestamptz not null,
  used integer not null check(used between 1 and 60)
);
revoke all on clickdeck_private.read_control,clickdeck_private.read_budget from public,anon,authenticated;

-- Allowlisted Data API surface, rather than only blocking three table names:
-- table aliases, embedding through another relation and future views stay closed.
-- PostgREST supplies request.path/method; no client headers/metadata are trusted.
-- This must be composed with any existing pre-request hook, never overwrite it.
create function public.clickdeck_read_request_gate()
returns void language plpgsql security definer set search_path='' as $$
declare
  path text := ltrim(coalesce(current_setting('request.path',true),''),'/');
  method text := current_setting('request.method',true);
begin
  if not (select enabled from clickdeck_private.read_control where id=1) then return; end if;
  if method='POST' and path=any(array[
    'rpc/read_clickdeck_project',
    'rpc/create_clickdeck_project','rpc/create_clickdeck_source_project',
    'rpc/join_clickdeck_project','rpc/accept_clickdeck_guest_invite',
    'rpc/preview_clickdeck_invite','rpc/preview_clickdeck_guest_invite',
    'rpc/submit_clickdeck_tasks','rpc/upgrade_clickdeck_source','rpc/close_clickdeck_project'
  ]) then return; end if;
  raise exception 'migration-required';
end; $$;
revoke all on function public.clickdeck_read_request_gate() from public;
grant execute on function public.clickdeck_read_request_gate() to anon,authenticated;

create function public.read_clickdeck_project(requested_project_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  uid uuid := auth.uid();
  moment timestamptz := clock_timestamp();
  consumed integer;
  result jsonb;
begin
  -- Keep the existing emergency OFF mechanism, despite SECURITY DEFINER.
  if not has_table_privilege('authenticated','public.clickdeck_projects','SELECT')
    or not has_table_privilege('authenticated','public.clickdeck_members','SELECT')
    or not has_table_privilege('authenticated','public.clickdeck_submissions','SELECT') then
    raise exception 'service-disabled';
  end if;
  if uid is null then raise exception 'authentication-required'; end if;
  if not exists(select 1 from public.clickdeck_projects p
    join public.clickdeck_members m on m.project_id=p.id
    where p.id=requested_project_id and m.user_id=uid and p.expires_at>moment) then
    -- Do not reveal existence or expiry of someone else's project.
    raise exception 'project-not-found';
  end if;
  -- One row per identity, shared by every project/tab. Successful reads only:
  -- rejected/rolled-back requests do not consume persistent budget.
  insert into clickdeck_private.read_budget as b(user_id,window_start,used)
    values(uid,moment,1)
  on conflict(user_id) do update set
    window_start=case when b.window_start<=moment-interval '60 seconds' then moment else b.window_start end,
    used=case when b.window_start<=moment-interval '60 seconds' then 1 else b.used+1 end
  where b.window_start<=moment-interval '60 seconds' or b.used<60
  returning used into consumed;
  if consumed is null then raise exception 'rate-limit'; end if;
  -- Explicit safe projection: never return invitation hashes or future columns.
  select jsonb_build_object(
    'projects',jsonb_build_array(jsonb_build_object('id',p.id,'title',p.title,
      'page_fingerprint',p.page_fingerprint,'fingerprint_version',p.fingerprint_version,
      'created_at',p.created_at,'last_activity_at',p.last_activity_at,'expires_at',p.expires_at)),
    'members',coalesce((select jsonb_agg(jsonb_build_object('id',m.id,'project_id',m.project_id,
      'user_id',m.user_id,'display_name',m.display_name,'role',m.role,'joined_at',m.joined_at)
      order by m.joined_at,m.id) from public.clickdeck_members m where m.project_id=p.id),'[]'::jsonb),
    'submissions',coalesce((select jsonb_agg(jsonb_build_object('id',s.id,'project_id',s.project_id,
      'user_id',s.user_id,'member_display_name',s.member_display_name,'page_fingerprint',s.page_fingerprint,
      'tasks',s.tasks,'task_count',s.task_count,'submitted_at',s.submitted_at)
      order by s.submitted_at,s.id) from public.clickdeck_submissions s where s.project_id=p.id),'[]'::jsonb)
  ) into result from public.clickdeck_projects p
    where p.id=requested_project_id and p.expires_at>clock_timestamp()
      and exists(select 1 from public.clickdeck_members m where m.project_id=p.id and m.user_id=uid);
  if result is null then raise exception 'project-not-found'; end if;
  return result;
end; $$;
revoke all on function public.read_clickdeck_project(uuid) from public,anon;
grant execute on function public.read_clickdeck_project(uuid) to authenticated;
commit;
