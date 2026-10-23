-- Task 167 staged installation. Controls remain disabled until coordinated activation.
-- Requires reviewed backup, base migrations and Auth configuration. Do not rerun
-- after successful installation. Does not reset existing projects or identities.
begin;
create or replace function public.clickdeck_access_token_claims(event jsonb)
returns jsonb language plpgsql immutable set search_path='' as $$
declare claims jsonb; metadata jsonb;
begin
  claims := event->'claims';
  if jsonb_typeof(claims) is distinct from 'object' then raise exception 'invalid-token-hook-event'; end if;
  metadata := claims->'user_metadata';
  if jsonb_typeof(metadata)='object' and metadata ? 'clickdeck_guest' then
    -- Keep all required claims and unrelated metadata unchanged. A DB INSERT
    -- trigger cannot sanitize Auth's in-memory first-token claims by itself.
    claims := jsonb_set(claims,'{user_metadata}',metadata-'clickdeck_guest');
  end if;
  return jsonb_build_object('claims',claims);
end;
$$;
revoke all on function public.clickdeck_access_token_claims(jsonb) from public,anon,authenticated;
grant usage on schema public to supabase_auth_admin;
grant execute on function public.clickdeck_access_token_claims(jsonb) to supabase_auth_admin;
commit;
