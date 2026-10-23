-- Task 167 staged installation. Controls remain disabled until coordinated activation.
-- Requires reviewed backup, base migrations and Auth configuration. Do not rerun
-- after successful installation. Does not reset existing projects or identities.
begin;
do $$ begin
  if to_regclass('clickdeck_private.guest_admission_control') is null
    or to_regprocedure('public.accept_clickdeck_guest_invite(uuid,text,text,text)') is null then
    raise exception 'guest-admission-prerequisite-missing';
  end if;
end; $$;

create or replace function public.join_clickdeck_project(
  requested_project_id uuid, requested_invite_token text,
  requested_page_fingerprint text, requested_display_name text
)
returns uuid language plpgsql security definer set search_path='' as $$
begin
  if auth.uid() is null then raise exception 'authentication-required'; end if;
  if requested_project_id is null or requested_invite_token is null or requested_invite_token !~ '^[0-9a-f]{36}$' then raise exception 'invalid-invite'; end if;
  if requested_page_fingerprint is null or requested_page_fingerprint !~ '^[0-9a-f]{64}$' then raise exception 'invalid-fingerprint'; end if;
  if requested_display_name is null then raise exception 'invalid-display-name'; end if;
  if (select enabled from clickdeck_private.guest_admission_control where id=1) then
    -- One reservation-aware path for already-authenticated OLD and NEW clients.
    -- Acceptance delegates only to the private implementation: no recursion.
    return public.accept_clickdeck_guest_invite(requested_project_id,requested_invite_token,requested_page_fingerprint,requested_display_name);
  end if;
  return clickdeck_private.join_clickdeck_project(requested_project_id,requested_invite_token,requested_page_fingerprint,requested_display_name);
end;
$$;
-- CREATE OR REPLACE retains the existing owner and ACL, including service OFF.
-- Never grant EXECUTE here or turn admission OFF as an unreviewed rollback.
commit;
