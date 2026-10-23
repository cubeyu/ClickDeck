-- Task 167 checkpoint: enforce creator identity in the database, including
-- legacy public create RPCs. Existing anonymous members retain their access.
-- Apply only after the Google login/link flow and deployment checks pass.
begin;

create or replace function public.create_clickdeck_project(requested_title text, requested_page_fingerprint text, requested_owner_name text)
returns table(project_id uuid, owner_member_id uuid, invite_token text, expires_at timestamptz)
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'authentication-required'; end if;
  -- Auth-managed records are authoritative. Never trust user_metadata, a
  -- client-supplied provider flag, or a stale provider claim in a JWT.
  if not exists (
    select 1 from auth.users u
    join auth.identities i on i.user_id = u.id
    where u.id = auth.uid() and u.is_anonymous is false and i.provider = 'google'
  ) then raise exception 'google-login-required'; end if;
  if requested_title is null or requested_owner_name is null or requested_page_fingerprint is null then raise exception 'invalid-input'; end if;
  perform pg_catalog.pg_advisory_xact_lock(144,1);
  if (select count(*) from public.clickdeck_projects) >= 100 then raise exception 'service-capacity'; end if;
  if (select count(*) from public.clickdeck_projects p where p.owner_user_id = auth.uid() and p.expires_at > now()) >= 3 then raise exception 'project-limit'; end if;
  if exists(select 1 from public.clickdeck_projects where owner_user_id = auth.uid() and created_at > now()-interval '60 seconds') then raise exception 'rate-limit'; end if;
  return query select * from clickdeck_private.create_clickdeck_project(requested_title, requested_page_fingerprint, requested_owner_name);
end;
$$;

-- CREATE OR REPLACE preserves existing EXECUTE grants (including service OFF).
-- create_clickdeck_source_project delegates to this function, so it cannot
-- bypass this check. The private implementation remains uncallable by clients.
commit;
