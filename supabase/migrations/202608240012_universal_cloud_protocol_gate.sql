-- Released clients that predate the bounded cloud publication protocol can
-- repeatedly replay an unchanged relational workspace.  The tuple-level
-- containment in 202608240009/010 prevents most data churn, but every replay
-- still consumes PostgREST, authentication, and query CPU.
--
-- Keep private snapshot backup compatible with schema-27 clients, including
-- Google-bearing accounts.  Fence only the revisioned relational projection:
-- current clients advertise protocol 2, while a legacy client is rejected at
-- its first metadata/revision check before it can issue hundreds of row calls.

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
     or public.habhub_privacy_schema_version() < v_required then
    raise exception 'google_health_privacy_client_upgrade_required' using errcode = '55000';
  end if;
end;
$$;

revoke all on function public.assert_google_health_privacy_client(uuid, integer)
  from public, anon, authenticated, service_role;
grant execute on function public.assert_google_health_privacy_client(uuid, integer)
  to authenticated;

comment on function public.assert_google_health_privacy_client(uuid, integer) is
  'Requires the current privacy schema after an account is marked as containing Google Health data; private snapshot backup is independent of relational cloud protocol.';

create or replace function public.assert_habhub_cloud_protocol(
  p_minimum integer default 2
)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_required integer := greatest(coalesce(p_minimum, 2), 2);
begin
  if public.habhub_cloud_protocol_version() < v_required then
    raise exception 'habhub_cloud_protocol_upgrade_required' using errcode = '55000';
  end if;
end;
$$;

revoke all on function public.assert_habhub_cloud_protocol(integer)
  from public, anon, authenticated, service_role;

comment on function public.assert_habhub_cloud_protocol(integer) is
  'Internal revision-fence guard that rejects unbounded legacy relational workspace publication.';

create or replace function public.assert_account_snapshot_revision(
  p_user_id uuid,
  p_expected_revision bigint
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := (select auth.uid());
  current_revision bigint;
  expected_fence text;
begin
  if caller_id is null or caller_id <> p_user_id then
    raise exception 'account_revision_forbidden' using errcode = '42501';
  end if;

  perform public.assert_google_health_privacy_client(
    p_user_id,
    public.habhub_privacy_schema_version()
  );
  perform public.assert_habhub_cloud_protocol(2);

  if p_expected_revision is null then
    raise exception 'stale_group_publish' using errcode = '40001';
  end if;

  expected_fence := p_user_id::text || ':' || p_expected_revision::text;
  if current_setting('habhub.account_revision_fence', true) = expected_fence then
    return;
  end if;
  select snapshot.revision
    into current_revision
    from public.user_snapshots snapshot
   where snapshot.user_id = p_user_id
   for update;
  if current_revision is null or current_revision <> p_expected_revision then
    raise exception 'stale_group_publish' using errcode = '40001';
  end if;
  perform set_config('habhub.account_revision_fence', expected_fence, true);
end;
$$;

revoke all on function public.assert_account_snapshot_revision(uuid, bigint)
  from public, anon, authenticated, service_role;
grant execute on function public.assert_account_snapshot_revision(uuid, bigint)
  to authenticated;

comment on function public.assert_account_snapshot_revision(uuid, bigint) is
  'Authenticated relational publication fence requiring privacy compatibility, bounded cloud protocol 2, and the current private snapshot revision.';

notify pgrst, 'reload schema';
