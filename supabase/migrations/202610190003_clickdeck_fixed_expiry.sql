-- Task 161. Freeze existing deadlines without rewriting suggestions or grants.
-- New projects keep the existing INSERT default (creation + 48 hours).
-- The trigger also guards older RPCs/clients which still request renewal.
begin;
create or replace function clickdeck_private.keep_project_deadline()
returns trigger language plpgsql set search_path = '' as $$
begin
  -- Preserve the existing explicit owner-close/admin capability; block renewal.
  -- No new close/delete UI is introduced by this migration.
  if new.expires_at > old.expires_at then new.expires_at := old.expires_at; end if;
  return new;
end;
$$;
revoke all on function clickdeck_private.keep_project_deadline() from public, anon, authenticated;
drop trigger if exists clickdeck_fixed_deadline on public.clickdeck_projects;
create trigger clickdeck_fixed_deadline before update of expires_at on public.clickdeck_projects
for each row execute function clickdeck_private.keep_project_deadline();

-- Read-only invitation preflight: no member list, suggestions or token disclosure.
create or replace function public.preview_clickdeck_invite(requested_project_id uuid, requested_invite_token text, requested_page_fingerprint text)
returns timestamptz language plpgsql security definer set search_path = '' as $$
declare project public.clickdeck_projects%rowtype;
begin
  if auth.uid() is null then raise exception 'authentication-required'; end if;
  if not has_table_privilege('authenticated','public.clickdeck_projects','SELECT') then raise exception 'service-disabled'; end if;
  select * into project from public.clickdeck_projects where id=requested_project_id;
  if not found or requested_invite_token is null or requested_invite_token !~ '^[0-9a-f]{36}$'
    or project.invite_token_hash <> pg_catalog.sha256(pg_catalog.convert_to(requested_invite_token,'UTF8')) then raise exception 'invalid-invite'; end if;
  if project.expires_at<=now() then raise exception 'project-expired'; end if;
  if requested_page_fingerprint is null or project.page_fingerprint<>requested_page_fingerprint then raise exception 'fingerprint-mismatch'; end if;
  return project.expires_at;
end;
$$;
revoke all on function public.preview_clickdeck_invite(uuid,text,text) from public,anon,authenticated;
do $$ begin
  if has_function_privilege('authenticated','public.join_clickdeck_project(uuid,text,text,text)','EXECUTE') then
    grant execute on function public.preview_clickdeck_invite(uuid,text,text) to authenticated;
  end if;
end; $$;
commit;
