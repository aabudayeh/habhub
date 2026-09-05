-- Keep the web Google Health bridge aligned with the app's explicit import
-- window. Zero is a strict current-local-day-only mode; provider query limits
-- may still cap larger positive selections.

alter table public.google_health_connections
  add column if not exists history_days smallint not null default 90;

alter table public.google_health_connections
  drop constraint if exists google_health_connections_history_days_check;
alter table public.google_health_connections
  add constraint google_health_connections_history_days_check
  check (history_days in (0, 30, 90, 365, 730));

create or replace function public.set_google_health_history_days(
  p_user_id uuid,
  p_history_days smallint
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_connection public.google_health_connections%rowtype;
begin
  if (select auth.role()) is distinct from 'service_role' then
    raise exception 'google_health_service_role_required' using errcode = '42501';
  end if;
  if p_user_id is null
     or p_history_days is null
     or p_history_days not in (0, 30, 90, 365, 730) then
    raise exception 'invalid_google_health_history_days' using errcode = '22023';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_user_id::text, 744218)
  );
  select * into v_connection
    from public.google_health_connections connection
   where connection.user_id = p_user_id
   for update;
  if v_connection.user_id is null then
    raise exception 'google_health_connection_required' using errcode = '55000';
  end if;
  if v_connection.sync_lease_until is not null
     and v_connection.sync_lease_until > now() then
    raise exception 'google_health_sync_busy' using errcode = '55000';
  end if;
  if v_connection.history_days = p_history_days then return true; end if;

  update public.google_health_connections connection
     set history_days = p_history_days,
         next_catchup_at = now(),
         updated_at = now()
   where connection.user_id = p_user_id;
  -- The next worker/manual pass must rebuild the newly selected range instead
  -- of treating the previous selection's cursor as coverage.
  delete from public.google_health_sync_cursors cursor
   where cursor.user_id = p_user_id;
  return true;
end;
$$;

revoke all on function public.set_google_health_history_days(uuid, smallint)
  from public, anon, authenticated;
grant execute on function public.set_google_health_history_days(uuid, smallint)
  to service_role;

comment on column public.google_health_connections.history_days is
  'Selected prior-day import window. Zero restricts every sync to the current local day.';
