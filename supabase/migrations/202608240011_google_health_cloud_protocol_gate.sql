-- Google-bearing schema-27 clients understand the privacy-safe snapshot
-- format, but released clients predate the bounded workspace publication
-- protocol. Keep the privacy schema and its versioned Realtime topic stable;
-- advertise this independent capability on PostgREST requests instead.
create or replace function public.habhub_cloud_protocol_version()
returns integer
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_headers jsonb;
  v_value text;
begin
  begin
    v_headers := nullif(current_setting('request.headers', true), '')::jsonb;
  exception when others then
    return 0;
  end;
  v_value := v_headers ->> 'x-habhub-cloud-protocol';
  if coalesce(v_value, '') ~ '^[0-9]{1,4}$' then
    return v_value::integer;
  end if;
  return 0;
end;
$$;

revoke all on function public.habhub_cloud_protocol_version()
  from public, anon, authenticated, service_role;
grant execute on function public.habhub_cloud_protocol_version()
  to authenticated, service_role;

comment on function public.habhub_cloud_protocol_version() is
  'Returns the bounded PostgREST cloud publication protocol advertised by the current request, or zero when absent/invalid.';

-- Preserve every existing privacy and deletion guard. The new protocol floor
-- is deliberately below the early return for ordinary accounts: only an
-- account marked as containing Google Health data requires protocol 2. This
-- rejects an outdated client before snapshot or revision-fenced workspace
-- writes while leaving service-owned jobs and non-Google accounts unchanged.
create or replace function public.assert_google_health_privacy_client(
  p_user_id uuid,
  p_client_schema_version integer
)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_required integer := 27;
begin
  if (select auth.uid()) is null or (select auth.uid()) <> p_user_id then
    raise exception 'google_health_privacy_client_upgrade_required' using errcode = '42501';
  end if;
  if exists (
    select 1
      from public.google_health_account_deletion_guards guard
     where guard.user_id = p_user_id
  ) then
    raise exception 'google_health_account_deleting' using errcode = '55000';
  end if;
  if not exists (
    select 1
      from public.google_health_privacy_accounts privacy
     where privacy.user_id = p_user_id
  ) then
    return;
  end if;
  select coalesce(config.min_privacy_schema, 27)
    into v_required
    from public.google_health_runtime_config config
   where config.singleton = true;
  v_required := coalesce(v_required, 27);
  if coalesce(p_client_schema_version, 0) < v_required
     or public.habhub_privacy_schema_version() < v_required
     or public.habhub_cloud_protocol_version() < 2 then
    raise exception 'google_health_privacy_client_upgrade_required' using errcode = '55000';
  end if;
end;
$$;

revoke all on function public.assert_google_health_privacy_client(uuid, integer)
  from public, anon, authenticated, service_role;
grant execute on function public.assert_google_health_privacy_client(uuid, integer)
  to authenticated;

comment on function public.assert_google_health_privacy_client(uuid, integer) is
  'Requires the current privacy schema and cloud protocol 2 only after an account is marked as containing Google Health data.';

notify pgrst, 'reload schema';
