-- Task 155. Owner-confirmed, one-time legacy upgrade. No suggestions are deleted.
begin;
alter table public.clickdeck_projects add column if not exists fingerprint_version text not null default 'dom-v1' check (fingerprint_version in ('dom-v1','source-v2'));
alter table public.clickdeck_projects add column if not exists legacy_page_fingerprint text;

create or replace function public.create_clickdeck_source_project(requested_title text, requested_page_fingerprint text, requested_owner_name text)
returns table(project_id uuid,owner_member_id uuid,invite_token text,expires_at timestamptz)
language plpgsql security definer set search_path='' as $$
declare result record;
begin
 if auth.uid() is null then raise exception 'authentication-required'; end if;
 if not has_table_privilege('authenticated','public.clickdeck_projects','SELECT') then raise exception 'service-disabled'; end if;
 select * into result from public.create_clickdeck_project(requested_title,requested_page_fingerprint,requested_owner_name);
 update public.clickdeck_projects set fingerprint_version='source-v2' where id=result.project_id;
 return query select result.project_id,result.owner_member_id,result.invite_token,result.expires_at;
end; $$;

create or replace function public.upgrade_clickdeck_source(requested_project_id uuid, requested_page_fingerprint text)
returns uuid language plpgsql security definer set search_path='' as $$
declare project public.clickdeck_projects%rowtype;
begin
 if auth.uid() is null then raise exception 'authentication-required'; end if;
 if not has_table_privilege('authenticated','public.clickdeck_projects','SELECT') then raise exception 'service-disabled'; end if;
 if requested_page_fingerprint is null or requested_page_fingerprint !~ '^[0-9a-f]{64}$' then raise exception 'invalid-fingerprint'; end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(auth.uid()::text,144));
 select * into project from public.clickdeck_projects where id=requested_project_id for update;
 if not found then raise exception 'project-not-found'; end if;
 if project.owner_user_id<>auth.uid() then raise exception 'member-not-found'; end if;
 if project.expires_at<=now() then raise exception 'project-expired'; end if;
 if project.fingerprint_version='source-v2' then
  if project.page_fingerprint=requested_page_fingerprint then return project.id; end if;
  raise exception 'fingerprint-mismatch';
 end if;
 update public.clickdeck_projects set legacy_page_fingerprint=page_fingerprint,page_fingerprint=requested_page_fingerprint,fingerprint_version='source-v2' where id=project.id;
 -- Preserve submission payloads, their original fingerprints, IDs, timestamps and expiry.
 return project.id;
end; $$;
revoke all on function public.create_clickdeck_source_project(text,text,text),public.upgrade_clickdeck_source(uuid,text) from public,anon,authenticated;
-- Match the existing service switch, including migration while OFF.
do $$ begin
 if has_function_privilege('authenticated','public.create_clickdeck_project(text,text,text)','EXECUTE') then
  grant execute on function public.create_clickdeck_source_project(text,text,text),public.upgrade_clickdeck_source(uuid,text) to authenticated;
 end if;
end; $$;
commit;
