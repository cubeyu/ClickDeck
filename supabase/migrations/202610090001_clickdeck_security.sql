-- Task 144. Run once through the migration ledger, as database administrator.
begin;
create schema if not exists clickdeck_private;
revoke all on schema clickdeck_private from public, anon, authenticated;

alter function public.create_clickdeck_project(text,text,text) set schema clickdeck_private;
alter function public.join_clickdeck_project(uuid,text,text,text) set schema clickdeck_private;
alter function public.submit_clickdeck_tasks(uuid,text,jsonb) set schema clickdeck_private;
revoke all on all functions in schema clickdeck_private from public, anon, authenticated;

create function clickdeck_private.valid_json(value jsonb, depth integer default 0)
returns boolean language plpgsql immutable set search_path = '' as $$
declare child jsonb;
begin
  if value is null or depth > 8 then return false; end if;
  if jsonb_typeof(value) = 'string' then return char_length(value #>> '{}') <= 4000; end if;
  if jsonb_typeof(value) in ('array','object') then
    if jsonb_typeof(value) = 'array' then
      if jsonb_array_length(value) > 100 then return false; end if;
      for child in select v from jsonb_array_elements(value) v loop
        if not clickdeck_private.valid_json(child, depth+1) then return false; end if;
      end loop;
    else
      if (select count(*) from jsonb_object_keys(value)) > 32 then return false; end if;
      for child in select v from jsonb_each(value) as e(k,v) loop
        if not clickdeck_private.valid_json(child, depth+1) then return false; end if;
      end loop;
    end if;
  end if;
  return true;
end;
$$;

create function public.create_clickdeck_project(requested_title text, requested_page_fingerprint text, requested_owner_name text)
returns table(project_id uuid, owner_member_id uuid, invite_token text, expires_at timestamptz)
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'authentication-required'; end if;
  if requested_title is null or requested_owner_name is null or requested_page_fingerprint is null then raise exception 'invalid-input'; end if;
  -- Serialize admission across users: account rotation cannot bypass the capacity ceiling.
  perform pg_catalog.pg_advisory_xact_lock(144,1);
  -- Include expired rows awaiting cleanup so close/recreate cannot evade storage limits.
  if (select count(*) from public.clickdeck_projects) >= 100 then raise exception 'service-capacity'; end if;
  if (select count(*) from public.clickdeck_projects p where p.owner_user_id = auth.uid() and p.expires_at > now()) >= 3 then raise exception 'project-limit'; end if;
  if exists(select 1 from public.clickdeck_projects where owner_user_id = auth.uid() and created_at > now()-interval '60 seconds') then raise exception 'rate-limit'; end if;
  return query select * from clickdeck_private.create_clickdeck_project(requested_title, requested_page_fingerprint, requested_owner_name);
end;
$$;

create function public.join_clickdeck_project(requested_project_id uuid, requested_invite_token text, requested_page_fingerprint text, requested_display_name text)
returns uuid language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'authentication-required'; end if;
  if requested_project_id is null or requested_invite_token is null or requested_invite_token !~ '^[0-9a-f]{36}$' then raise exception 'invalid-invite'; end if;
  if requested_page_fingerprint is null or requested_page_fingerprint !~ '^[0-9a-f]{64}$' then raise exception 'invalid-fingerprint'; end if;
  if requested_display_name is null then raise exception 'invalid-display-name'; end if;
  return clickdeck_private.join_clickdeck_project(requested_project_id, requested_invite_token, requested_page_fingerprint, requested_display_name);
end;
$$;

create function public.submit_clickdeck_tasks(requested_project_id uuid, requested_page_fingerprint text, requested_tasks jsonb)
returns uuid language plpgsql security definer set search_path = '' as $$
declare task jsonb; field text;
begin
  if auth.uid() is null then raise exception 'authentication-required'; end if;
  if requested_project_id is null or requested_page_fingerprint is null or requested_page_fingerprint !~ '^[0-9a-f]{64}$' then raise exception 'invalid-fingerprint'; end if;
  if requested_tasks is null or jsonb_typeof(requested_tasks) is distinct from 'array' then raise exception 'invalid-tasks'; end if;
  if octet_length(requested_tasks::text) > 262144 then raise exception 'payload-limit'; end if;
  if not clickdeck_private.valid_json(requested_tasks) then raise exception 'invalid-tasks'; end if;
  for task in select v from jsonb_array_elements(requested_tasks) v loop
    if jsonb_typeof(task) is distinct from 'object'
      or jsonb_typeof(task->'id') is distinct from 'string' or length(task->>'id') not between 1 and 200
      or jsonb_typeof(task->'summary') is distinct from 'string' or length(task->>'summary') not between 1 and 4000
      or jsonb_typeof(task->'kind') is distinct from 'string'
      or (task->>'kind') not in ('style','content','attribute','intent','move','remove')
      or jsonb_typeof(task->'sequence') is distinct from 'number'
      or (task->>'sequence') !~ '^[0-9]{1,9}$' then raise exception 'invalid-tasks'; end if;
    foreach field in array array['before','after','property','attribute'] loop
      if task ? field and jsonb_typeof(task->field) is distinct from 'string' then raise exception 'invalid-tasks'; end if;
    end loop;
    if task ? 'locator' and (jsonb_typeof(task->'locator') is distinct from 'object'
      or jsonb_typeof(task->'locator'->'cssPath') is distinct from 'string'
      or length(task->'locator'->>'cssPath') not between 1 and 1000) then raise exception 'invalid-tasks'; end if;
    foreach field in array array['source','target'] loop
      if task ? field and (jsonb_typeof(task->field) is distinct from 'object'
        or jsonb_typeof(task->field->'anchor') is distinct from 'object'
        or jsonb_typeof(task->field->'contents') is distinct from 'array'
        or jsonb_typeof(task->field->'nearby') is distinct from 'array'
        or jsonb_typeof(task->field->'userIntent') is distinct from 'string') then raise exception 'invalid-tasks'; end if;
    end loop;
  end loop;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(auth.uid()::text,144));
  -- Lock project before the byte budget check; different members must not race it.
  perform 1 from public.clickdeck_projects where id=requested_project_id for update;
  if (select coalesce(sum(octet_length(tasks::text)),0) from public.clickdeck_submissions where project_id=requested_project_id) + octet_length(requested_tasks::text) > 262144 then raise exception 'payload-limit'; end if;
  if exists(select 1 from public.clickdeck_submissions where user_id=auth.uid() and submitted_at > now()-interval '5 seconds') then raise exception 'rate-limit'; end if;
  return clickdeck_private.submit_clickdeck_tasks(requested_project_id, requested_page_fingerprint, requested_tasks);
end;
$$;

create or replace function public.clickdeck_is_member(target_project_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
 select exists(select 1 from public.clickdeck_members m join public.clickdeck_projects p on p.id=m.project_id
 where m.project_id=target_project_id and m.user_id=auth.uid() and p.expires_at > now());
$$;

create function public.close_clickdeck_project(requested_project_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'authentication-required'; end if;
  update public.clickdeck_projects set expires_at=now() where id=requested_project_id and owner_user_id=auth.uid();
  if not found then raise exception 'project-not-found'; end if;
end;
$$;
revoke all on function public.create_clickdeck_project(text,text,text), public.join_clickdeck_project(uuid,text,text,text), public.submit_clickdeck_tasks(uuid,text,jsonb), public.close_clickdeck_project(uuid) from public, anon;
grant execute on function public.create_clickdeck_project(text,text,text), public.join_clickdeck_project(uuid,text,text,text), public.submit_clickdeck_tasks(uuid,text,jsonb), public.close_clickdeck_project(uuid) to authenticated;
revoke all on all functions in schema clickdeck_private from public, anon, authenticated;
commit;
