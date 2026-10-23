-- Task 136: shorten private collaboration retention and add cleanup schedules.

alter table public.clickdeck_projects
  alter column expires_at set default (now() + interval '48 hours');

create or replace function public.create_clickdeck_project(
  requested_title text,
  requested_page_fingerprint text,
  requested_owner_name text
)
returns table(project_id uuid, owner_member_id uuid, invite_token text, expires_at timestamptz)
language plpgsql security definer set search_path = public, extensions, pg_temp
as $$
declare
  current_user_id uuid := auth.uid();
  raw_token text := encode(gen_random_bytes(18), 'hex');
  new_project_id uuid;
  new_member_id uuid;
  new_expiry timestamptz := now() + interval '48 hours';
begin
  if current_user_id is null then raise exception 'authentication-required'; end if;
  if char_length(trim(requested_title)) not between 1 and 120 then raise exception 'invalid-title'; end if;
  if requested_page_fingerprint !~ '^[0-9a-f]{64}$' then raise exception 'invalid-fingerprint'; end if;
  if char_length(trim(requested_owner_name)) not between 1 and 60 then raise exception 'invalid-display-name'; end if;
  insert into public.clickdeck_projects(title, page_fingerprint, invite_token_hash, owner_user_id, expires_at)
  values (trim(requested_title), requested_page_fingerprint, digest(raw_token, 'sha256'), current_user_id, new_expiry)
  returning id into new_project_id;
  insert into public.clickdeck_members(project_id, user_id, display_name, role)
  values (new_project_id, current_user_id, trim(requested_owner_name), 'owner') returning id into new_member_id;
  return query select new_project_id, new_member_id, raw_token, new_expiry;
end;
$$;

create or replace function public.join_clickdeck_project(
  requested_project_id uuid,
  requested_invite_token text,
  requested_page_fingerprint text,
  requested_display_name text
)
returns uuid language plpgsql security definer set search_path = public, extensions, pg_temp
as $$
declare
  current_user_id uuid := auth.uid();
  locked_project public.clickdeck_projects%rowtype;
  new_member_id uuid;
begin
  if current_user_id is null then raise exception 'authentication-required'; end if;
  if char_length(trim(requested_display_name)) not between 1 and 60 then raise exception 'invalid-display-name'; end if;
  select * into locked_project from public.clickdeck_projects where id = requested_project_id for update;
  if not found then raise exception 'project-not-found'; end if;
  if locked_project.expires_at <= now() then raise exception 'project-expired'; end if;
  if locked_project.page_fingerprint <> requested_page_fingerprint then raise exception 'fingerprint-mismatch'; end if;
  if locked_project.invite_token_hash <> digest(requested_invite_token, 'sha256') then raise exception 'invalid-invite'; end if;
  if (select count(*) from public.clickdeck_members where project_id = requested_project_id) >= 6 then raise exception 'member-limit'; end if;
  insert into public.clickdeck_members(project_id, user_id, display_name, role)
  values (requested_project_id, current_user_id, trim(requested_display_name), 'member') returning id into new_member_id;
  update public.clickdeck_projects set last_activity_at = now(), expires_at = now() + interval '48 hours'
  where id = requested_project_id;
  return new_member_id;
end;
$$;

create or replace function public.submit_clickdeck_tasks(
  requested_project_id uuid,
  requested_page_fingerprint text,
  requested_tasks jsonb
)
returns uuid language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  current_user_id uuid := auth.uid();
  locked_project public.clickdeck_projects%rowtype;
  current_member public.clickdeck_members%rowtype;
  incoming_count integer;
  existing_count integer;
  new_submission_id uuid;
begin
  if current_user_id is null then raise exception 'authentication-required'; end if;
  if jsonb_typeof(requested_tasks) <> 'array' then raise exception 'invalid-tasks'; end if;
  incoming_count := jsonb_array_length(requested_tasks);
  if incoming_count not between 1 and 100 then raise exception 'invalid-task-count'; end if;
  select * into locked_project from public.clickdeck_projects where id = requested_project_id for update;
  if not found then raise exception 'project-not-found'; end if;
  if locked_project.expires_at <= now() then raise exception 'project-expired'; end if;
  if locked_project.page_fingerprint <> requested_page_fingerprint then raise exception 'fingerprint-mismatch'; end if;
  select * into current_member from public.clickdeck_members
  where project_id = requested_project_id and user_id = current_user_id;
  if not found then raise exception 'member-not-found'; end if;
  select coalesce(sum(task_count), 0)::integer into existing_count
  from public.clickdeck_submissions where project_id = requested_project_id;
  if existing_count + incoming_count > 100 then raise exception 'task-limit'; end if;
  insert into public.clickdeck_submissions(project_id, user_id, member_display_name, page_fingerprint, tasks)
  values (requested_project_id, current_user_id, current_member.display_name, requested_page_fingerprint, requested_tasks)
  returning id into new_submission_id;
  update public.clickdeck_projects set last_activity_at = now(), expires_at = now() + interval '48 hours'
  where id = requested_project_id;
  return new_submission_id;
end;
$$;

create or replace function public.purge_orphaned_clickdeck_anonymous_users()
returns integer language plpgsql security definer set search_path = public, auth, pg_temp
as $$
declare deleted_count integer;
begin
  delete from auth.users users
  where users.is_anonymous is true
    and users.created_at < now() - interval '7 days'
    and not exists (select 1 from public.clickdeck_members members where members.user_id = users.id);
  get diagnostics deleted_count = row_count;
  return deleted_count;
end;
$$;

revoke all on function public.purge_orphaned_clickdeck_anonymous_users() from public;

create extension if not exists pg_cron with schema pg_catalog;
do $$
declare existing_job bigint;
begin
  for existing_job in select jobid from cron.job where jobname in (
    'purge-expired-clickdeck-projects', 'purge-orphaned-clickdeck-anonymous-users'
  ) loop
    perform cron.unschedule(existing_job);
  end loop;
  perform cron.schedule('purge-expired-clickdeck-projects', '15 * * * *',
    'select public.purge_expired_clickdeck_projects();');
  perform cron.schedule('purge-orphaned-clickdeck-anonymous-users', '35 3 * * *',
    'select public.purge_orphaned_clickdeck_anonymous_users();');
end;
$$;
