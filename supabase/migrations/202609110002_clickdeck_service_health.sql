-- Task 137: a dedicated no-user-data record for external inactivity checks.

create table if not exists public.clickdeck_service_health (
  id smallint primary key check (id = 1)
);

insert into public.clickdeck_service_health (id)
values (1)
on conflict (id) do nothing;

alter table public.clickdeck_service_health enable row level security;

revoke all on public.clickdeck_service_health from public, anon, authenticated;
grant select on public.clickdeck_service_health to anon;

drop policy if exists "anonymous service health read" on public.clickdeck_service_health;
create policy "anonymous service health read"
on public.clickdeck_service_health
for select
to anon
using (id = 1);

comment on table public.clickdeck_service_health is
  'Static no-user-data row used by the ClickDeck inactivity health check.';
