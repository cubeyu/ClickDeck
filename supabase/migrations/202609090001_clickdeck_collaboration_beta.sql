-- ClickDeck collaboration Beta foundation.
-- Apply only to a disposable/local Supabase project until the Beta security review is complete.

create extension if not exists pgcrypto;

create table public.clickdeck_projects (
  id uuid primary key default gen_random_uuid(),
  title text not null check (char_length(title) between 1 and 120),
  page_fingerprint text not null check (page_fingerprint ~ '^[0-9a-f]{64}$'),
  invite_token_hash bytea not null,
  owner_user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  last_activity_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '72 hours')
);

create table public.clickdeck_members (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.clickdeck_projects(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  display_name text not null check (char_length(display_name) between 1 and 60),
  role text not null check (role in ('owner', 'member')),
  joined_at timestamptz not null default now(),
  unique (project_id, user_id)
);

create table public.clickdeck_submissions (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.clickdeck_projects(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  member_display_name text not null check (char_length(member_display_name) between 1 and 60),
  page_fingerprint text not null check (page_fingerprint ~ '^[0-9a-f]{64}$'),
  tasks jsonb not null check (jsonb_typeof(tasks) = 'array'),
  task_count integer generated always as (jsonb_array_length(tasks)) stored,
  submitted_at timestamptz not null default now(),
  check (jsonb_array_length(tasks) between 1 and 100)
);

create index clickdeck_members_project_idx on public.clickdeck_members(project_id);
create index clickdeck_submissions_project_idx on public.clickdeck_submissions(project_id, submitted_at, id);
create index clickdeck_projects_expiry_idx on public.clickdeck_projects(expires_at);

alter table public.clickdeck_projects enable row level security;
alter table public.clickdeck_members enable row level security;
alter table public.clickdeck_submissions enable row level security;

create or replace function public.clickdeck_is_member(target_project_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.clickdeck_members
    where project_id = target_project_id and user_id = auth.uid()
  );
$$;

revoke all on function public.clickdeck_is_member(uuid) from public;
grant execute on function public.clickdeck_is_member(uuid) to authenticated;

create policy "members can read active projects"
on public.clickdeck_projects for select to authenticated
using (expires_at > now() and public.clickdeck_is_member(id));

create policy "members can read project roster"
on public.clickdeck_members for select to authenticated
using (public.clickdeck_is_member(project_id));

create policy "members can read project submissions"
on public.clickdeck_submissions for select to authenticated
using (public.clickdeck_is_member(project_id));

revoke all on public.clickdeck_projects from anon, authenticated;
revoke all on public.clickdeck_members from anon, authenticated;
revoke all on public.clickdeck_submissions from anon, authenticated;
grant select on public.clickdeck_projects, public.clickdeck_members, public.clickdeck_submissions to authenticated;

create or replace function public.create_clickdeck_project(
  requested_title text,
  requested_page_fingerprint text,
  requested_owner_name text
)
returns table(project_id uuid, owner_member_id uuid, invite_token text, expires_at timestamptz)
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  current_user_id uuid := auth.uid();
  raw_token text := encode(gen_random_bytes(18), 'hex');
  new_project_id uuid;
  new_member_id uuid;
  new_expiry timestamptz := now() + interval '72 hours';
begin
  if current_user_id is null then raise exception 'authentication-required'; end if;
  if char_length(trim(requested_title)) not between 1 and 120 then raise exception 'invalid-title'; end if;
  if requested_page_fingerprint !~ '^[0-9a-f]{64}$' then raise exception 'invalid-fingerprint'; end if;
  if char_length(trim(requested_owner_name)) not between 1 and 60 then raise exception 'invalid-display-name'; end if;

  insert into public.clickdeck_projects(title, page_fingerprint, invite_token_hash, owner_user_id, expires_at)
  values (trim(requested_title), requested_page_fingerprint, digest(raw_token, 'sha256'), current_user_id, new_expiry)
  returning id into new_project_id;

  insert into public.clickdeck_members(project_id, user_id, display_name, role)
  values (new_project_id, current_user_id, trim(requested_owner_name), 'owner')
  returning id into new_member_id;

  return query select new_project_id, new_member_id, raw_token, new_expiry;
end;
$$;

create or replace function public.join_clickdeck_project(
  requested_project_id uuid,
  requested_invite_token text,
  requested_page_fingerprint text,
  requested_display_name text
)
returns uuid
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  current_user_id uuid := auth.uid();
  locked_project public.clickdeck_projects%rowtype;
  new_member_id uuid;
begin
  if current_user_id is null then raise exception 'authentication-required'; end if;
  if char_length(trim(requested_display_name)) not between 1 and 60 then raise exception 'invalid-display-name'; end if;

  select * into locked_project from public.clickdeck_projects
  where id = requested_project_id for update;
  if not found then raise exception 'project-not-found'; end if;
  if locked_project.expires_at <= now() then raise exception 'project-expired'; end if;
  if locked_project.page_fingerprint <> requested_page_fingerprint then raise exception 'fingerprint-mismatch'; end if;
  if locked_project.invite_token_hash <> digest(requested_invite_token, 'sha256') then raise exception 'invalid-invite'; end if;
  if (select count(*) from public.clickdeck_members where project_id = requested_project_id) >= 6 then
    raise exception 'member-limit';
  end if;

  insert into public.clickdeck_members(project_id, user_id, display_name, role)
  values (requested_project_id, current_user_id, trim(requested_display_name), 'member')
  returning id into new_member_id;

  update public.clickdeck_projects
  set last_activity_at = now(), expires_at = now() + interval '72 hours'
  where id = requested_project_id;
  return new_member_id;
end;
$$;

create or replace function public.submit_clickdeck_tasks(
  requested_project_id uuid,
  requested_page_fingerprint text,
  requested_tasks jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
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

  select * into locked_project from public.clickdeck_projects
  where id = requested_project_id for update;
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

  update public.clickdeck_projects
  set last_activity_at = now(), expires_at = now() + interval '72 hours'
  where id = requested_project_id;
  return new_submission_id;
end;
$$;

create or replace function public.purge_expired_clickdeck_projects()
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare deleted_count integer;
begin
  delete from public.clickdeck_projects where expires_at <= now();
  get diagnostics deleted_count = row_count;
  return deleted_count;
end;
$$;

revoke all on function public.create_clickdeck_project(text, text, text) from public;
revoke all on function public.join_clickdeck_project(uuid, text, text, text) from public;
revoke all on function public.submit_clickdeck_tasks(uuid, text, jsonb) from public;
revoke all on function public.purge_expired_clickdeck_projects() from public;
grant execute on function public.create_clickdeck_project(text, text, text) to authenticated;
grant execute on function public.join_clickdeck_project(uuid, text, text, text) to authenticated;
grant execute on function public.submit_clickdeck_tasks(uuid, text, jsonb) to authenticated;

-- In hosted Supabase, schedule this after confirming pg_cron is available:
-- select cron.schedule(
--   'purge-expired-clickdeck-projects',
--   '15 * * * *',
--   $$select public.purge_expired_clickdeck_projects();$$
-- );
