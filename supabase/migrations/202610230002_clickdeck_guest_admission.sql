-- Task 167 staged installation. Controls remain disabled until coordinated activation.
-- Requires reviewed backup, base migrations and Auth configuration. Do not rerun
-- after successful installation. Does not reset existing projects or identities.
begin;
create table clickdeck_private.guest_admission_control (
  id integer primary key check (id=1), enabled boolean not null default false
);
insert into clickdeck_private.guest_admission_control(id) values(1);
create table clickdeck_private.guest_reservations (
  user_id uuid primary key,
  project_id uuid not null references public.clickdeck_projects(id) on delete cascade,
  invite_hash bytea not null,
  page_fingerprint text not null,
  display_name text not null check (char_length(display_name) between 1 and 60),
  expires_at timestamptz not null
);
create index guest_reservations_project_idx on clickdeck_private.guest_reservations(project_id);
revoke all on clickdeck_private.guest_admission_control, clickdeck_private.guest_reservations from public, anon, authenticated;

create function public.clickdeck_before_user_created(event jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  guest jsonb; uid uuid; pid uuid; token text; fingerprint text; label text;
  project public.clickdeck_projects%rowtype;
  reservation clickdeck_private.guest_reservations%rowtype;
begin
  if not (select enabled from clickdeck_private.guest_admission_control where id=1) then return '{}'::jsonb; end if;
  if not has_table_privilege('authenticated','public.clickdeck_projects','SELECT') then
    return jsonb_build_object('error',jsonb_build_object('http_code',403,'message','service-disabled'));
  end if;
  -- These fields are supplied by Auth, not by the client's user_metadata.
  if event->'user'->'is_anonymous' = 'false'::jsonb
    and event->'user'->'app_metadata'->>'provider' = 'google' then return '{}'::jsonb; end if;
  if event->'user'->'is_anonymous' is distinct from 'true'::jsonb then
    return jsonb_build_object('error',jsonb_build_object('http_code',403,'message','google-login-required'));
  end if;
  guest := event->'user'->'user_metadata'->'clickdeck_guest';
  if jsonb_typeof(guest) is distinct from 'object' or octet_length(guest::text)>2048
    or jsonb_typeof(guest->'project_id') is distinct from 'string'
    or jsonb_typeof(guest->'invite_token') is distinct from 'string'
    or jsonb_typeof(guest->'page_fingerprint') is distinct from 'string'
    or jsonb_typeof(guest->'display_name') is distinct from 'string'
    or coalesce(event->'user'->>'id','') !~ '^[0-9a-fA-F-]{36}$'
    or coalesce(guest->>'project_id','') !~ '^[0-9a-fA-F-]{36}$'
    or coalesce(guest->>'invite_token','') !~ '^[0-9a-f]{36}$'
    or coalesce(guest->>'page_fingerprint','') !~ '^[0-9a-f]{64}$'
    or char_length(trim(guest->>'display_name')) not between 1 and 60 then
    return jsonb_build_object('error',jsonb_build_object('http_code',403,'message','invalid-invite'));
  end if;
  begin
    uid := (event->'user'->>'id')::uuid;
    pid := (guest->>'project_id')::uuid;
  exception when invalid_text_representation then
    return jsonb_build_object('error',jsonb_build_object('http_code',403,'message','invalid-invite'));
  end;
  token := guest->>'invite_token'; fingerprint := guest->>'page_fingerprint'; label := trim(guest->>'display_name');
  select * into project from public.clickdeck_projects where id=pid for update;
  if not found or project.invite_token_hash <> pg_catalog.sha256(pg_catalog.convert_to(token,'UTF8')) then
    return jsonb_build_object('error',jsonb_build_object('http_code',403,'message','invalid-invite'));
  end if;
  if project.expires_at<=clock_timestamp() then
    return jsonb_build_object('error',jsonb_build_object('http_code',403,'message','project-expired'));
  end if;
  if project.page_fingerprint<>fingerprint then
    return jsonb_build_object('error',jsonb_build_object('http_code',403,'message','fingerprint-mismatch'));
  end if;
  -- Always lock project before its reservations, including in Auth triggers.
  delete from clickdeck_private.guest_reservations r where r.project_id=pid
    and (r.expires_at<=clock_timestamp() or r.invite_hash<>project.invite_token_hash
      or r.page_fingerprint<>project.page_fingerprint);
  if exists(select 1 from auth.users where id=uid) then
    return jsonb_build_object('error',jsonb_build_object('http_code',403,'message','invalid-invite'));
  end if;
  select * into reservation from clickdeck_private.guest_reservations where user_id=uid;
  if found then
    if reservation.project_id=pid and reservation.invite_hash=project.invite_token_hash
      and reservation.page_fingerprint=fingerprint and reservation.display_name=label then
      -- Repeated hook delivery cannot extend a reservation.
      return '{}'::jsonb;
    end if;
    return jsonb_build_object('error',jsonb_build_object('http_code',403,'message','invalid-invite'));
  end if;
  if (select count(*) from public.clickdeck_members where project_id=pid)
    + (select count(*) from clickdeck_private.guest_reservations where project_id=pid) >= 6 then
    return jsonb_build_object('error',jsonb_build_object('http_code',403,'message','member-limit'));
  end if;
  insert into clickdeck_private.guest_reservations(user_id,project_id,invite_hash,page_fingerprint,display_name,expires_at)
  values(uid,pid,project.invite_token_hash,fingerprint,label,least(project.expires_at,clock_timestamp()+interval '2 minutes'));
  return '{}'::jsonb;
end;
$$;
revoke all on function public.clickdeck_before_user_created(jsonb) from public, anon, authenticated;
grant usage on schema public to supabase_auth_admin;
grant execute on function public.clickdeck_before_user_created(jsonb) to supabase_auth_admin;

create function clickdeck_private.scrub_guest_registration()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if (select enabled from clickdeck_private.guest_admission_control where id=1) and new.is_anonymous is true then
    -- Do not retain invitation credentials in the stored Auth profile.
    new.raw_user_meta_data := coalesce(new.raw_user_meta_data,'{}'::jsonb)-'clickdeck_guest';
  end if;
  return new;
end;
$$;

create function clickdeck_private.finalize_guest_registration()
returns trigger language plpgsql security definer set search_path='' as $$
declare
  pid uuid; project public.clickdeck_projects%rowtype;
  reservation clickdeck_private.guest_reservations%rowtype;
begin
  if not (select enabled from clickdeck_private.guest_admission_control where id=1) then return new; end if;
  if not has_table_privilege('authenticated','public.clickdeck_projects','SELECT') then raise exception 'service-disabled'; end if;
  if new.is_anonymous is false and new.raw_app_meta_data->>'provider'='google' then return new; end if;
  if new.is_anonymous is distinct from true then raise exception 'google-login-required'; end if;
  select project_id into pid from clickdeck_private.guest_reservations where user_id=new.id;
  if not found then raise exception 'guest-registration-required'; end if;
  select * into project from public.clickdeck_projects where id=pid for update;
  if not found then raise exception 'invalid-invite'; end if;
  select * into reservation from clickdeck_private.guest_reservations where user_id=new.id for update;
  if not found or reservation.expires_at<=clock_timestamp() then raise exception 'guest-registration-expired'; end if;
  if project.invite_token_hash<>reservation.invite_hash then raise exception 'invalid-invite'; end if;
  if project.expires_at<=clock_timestamp() then raise exception 'project-expired'; end if;
  if project.page_fingerprint<>reservation.page_fingerprint then raise exception 'fingerprint-mismatch'; end if;
  if (select count(*) from public.clickdeck_members where project_id=pid)>=6 then raise exception 'member-limit'; end if;
  -- This FK-valid insert shares the Auth user INSERT transaction. If later token
  -- issuance rolls that transaction back, both rows and consumption roll back.
  insert into public.clickdeck_members(project_id,user_id,display_name,role)
    values(pid,new.id,reservation.display_name,'member');
  delete from clickdeck_private.guest_reservations where user_id=new.id;
  return new;
end;
$$;
revoke all on function clickdeck_private.scrub_guest_registration(),clickdeck_private.finalize_guest_registration() from public, anon, authenticated;
create trigger clickdeck_scrub_guest_registration before insert on auth.users
  for each row execute function clickdeck_private.scrub_guest_registration();
create trigger clickdeck_finalize_guest_registration after insert on auth.users
  for each row execute function clickdeck_private.finalize_guest_registration();

-- Invitation possession reveals only the deadline, before any account exists.
create function public.preview_clickdeck_guest_invite(requested_project_id uuid, requested_invite_token text, requested_page_fingerprint text)
returns timestamptz language plpgsql security definer set search_path='' as $$
declare project public.clickdeck_projects%rowtype;
begin
  if not (select enabled from clickdeck_private.guest_admission_control where id=1) then raise exception 'migration-required'; end if;
  if not has_table_privilege('authenticated','public.clickdeck_projects','SELECT') then raise exception 'service-disabled'; end if;
  select * into project from public.clickdeck_projects where id=requested_project_id;
  if not found or requested_invite_token is null or requested_invite_token !~ '^[0-9a-f]{36}$'
    or project.invite_token_hash<>pg_catalog.sha256(pg_catalog.convert_to(requested_invite_token,'UTF8')) then raise exception 'invalid-invite'; end if;
  if project.expires_at<=clock_timestamp() then raise exception 'project-expired'; end if;
  if requested_page_fingerprint is null or project.page_fingerprint<>requested_page_fingerprint then raise exception 'fingerprint-mismatch'; end if;
  return project.expires_at;
end;
$$;
revoke all on function public.preview_clickdeck_guest_invite(uuid,text,text) from public;
grant execute on function public.preview_clickdeck_guest_invite(uuid,text,text) to anon,authenticated;

-- Auth registration may have already established membership. Retry must
-- return the existing member, even when that registration filled slot six.
create function public.accept_clickdeck_guest_invite(requested_project_id uuid, requested_invite_token text, requested_page_fingerprint text, requested_display_name text)
returns uuid language plpgsql security definer set search_path='' as $$
declare project public.clickdeck_projects%rowtype; result uuid;
begin
  if auth.uid() is null then raise exception 'authentication-required'; end if;
  perform public.preview_clickdeck_guest_invite(requested_project_id,requested_invite_token,requested_page_fingerprint);
  if requested_display_name is null or char_length(trim(requested_display_name)) not between 1 and 60 then raise exception 'invalid-display-name'; end if;
  select * into project from public.clickdeck_projects where id=requested_project_id for update;
  -- Recheck after acquiring the same lock used by admission/registration.
  perform public.preview_clickdeck_guest_invite(requested_project_id,requested_invite_token,requested_page_fingerprint);
  select id into result from public.clickdeck_members where project_id=requested_project_id and user_id=auth.uid();
  if found then return result; end if;
  delete from clickdeck_private.guest_reservations r where r.project_id=requested_project_id
    and (r.expires_at<=clock_timestamp() or r.invite_hash<>project.invite_token_hash or r.page_fingerprint<>project.page_fingerprint);
  if (select count(*) from public.clickdeck_members where project_id=requested_project_id)
    + (select count(*) from clickdeck_private.guest_reservations where project_id=requested_project_id)>=6 then raise exception 'member-limit'; end if;
  return clickdeck_private.join_clickdeck_project(requested_project_id,requested_invite_token,requested_page_fingerprint,requested_display_name);
end;
$$;
revoke all on function public.accept_clickdeck_guest_invite(uuid,text,text,text) from public,anon;
grant execute on function public.accept_clickdeck_guest_invite(uuid,text,text,text) to authenticated;
commit;
