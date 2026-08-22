-- Google Health measurements are server-owned. A schema-27 client deliberately
-- excludes them from its durable local cache, so a later unrelated account
-- save must not be able to replace the authoritative snapshot with that
-- cache-safe projection. Rebuild the Google portion from server-only ownership
-- records at every authenticated snapshot write.
create or replace function public.merge_google_health_server_snapshot(
  p_user_id uuid,
  p_client_payload jsonb
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_client_entries jsonb;
  v_server_entries jsonb;
  v_client_statuses jsonb;
  v_settings jsonb;
  v_registry jsonb;
  v_filtered_ids jsonb;
  v_key text;
begin
  if p_user_id is null or jsonb_typeof(p_client_payload) <> 'object' then
    raise exception 'invalid_google_health_snapshot_merge' using errcode = '22023';
  end if;
  if jsonb_typeof(coalesce(p_client_payload -> 'entries', '[]'::jsonb)) <> 'array'
     or jsonb_typeof(coalesce(p_client_payload -> 'dailyMetricStatuses', '[]'::jsonb)) <> 'array'
     or jsonb_typeof(coalesce(p_client_payload -> 'settings', '{}'::jsonb)) <> 'object' then
    raise exception 'invalid_google_health_snapshot_shape' using errcode = '22023';
  end if;

  -- Discard every client-supplied Google row, including legacy id forms. The
  -- import table is the only measurement authority; a dismissal deletes its
  -- ownership row, while a server-confirmed edit updates it transactionally.
  select coalesce(jsonb_agg(item.entry order by item.ordinality), '[]'::jsonb)
    into v_client_entries
    from jsonb_array_elements(
      coalesce(p_client_payload -> 'entries', '[]'::jsonb)
    ) with ordinality item(entry, ordinality)
   where coalesce(item.entry ->> 'sourceProvider', '') <> 'google_health'
     and coalesce(item.entry ->> 'id', '') not like 'google-health:%'
     and coalesce(item.entry ->> 'id', '') not like 'health:google_health:%';

  select coalesce(
           jsonb_agg(
             authoritative.entry
             order by authoritative.first_imported_at, authoritative.entry_id
           ),
           '[]'::jsonb
         )
    into v_server_entries
    from (
      select distinct on (owned.entry_id)
        owned.entry_id,
        owned.entry,
        owned.first_imported_at
        from public.google_health_import_records owned
       where owned.user_id = p_user_id
       order by owned.entry_id, owned.updated_at desc, owned.external_id
    ) authoritative;

  -- Compact Google-derived statuses are projections, not a second authority.
  -- Remove both explicit provenance and legacy metric/day matches; ordinary
  -- client/group publication can rebuild them from the restored entries.
  select coalesce(jsonb_agg(item.status order by item.ordinality), '[]'::jsonb)
    into v_client_statuses
    from jsonb_array_elements(
      coalesce(p_client_payload -> 'dailyMetricStatuses', '[]'::jsonb)
    ) with ordinality item(status, ordinality)
   where coalesce(item.status ->> 'sourceProvider', '') <> 'google_health'
     and not exists (
       select 1
         from jsonb_array_elements(v_server_entries) google_entry
        where google_entry ->> 'userId' = item.status ->> 'userId'
          and google_entry ->> 'metricId' = item.status ->> 'metricId'
          and google_entry ->> 'localDate' = item.status ->> 'localDate'
     );

  -- The preference table, not browser/device state, is authoritative for raw
  -- Google ids, edited provider times, visibility choices and dismissals.
  select coalesce(jsonb_object_agg(
      preference.entry_id,
      jsonb_strip_nulls(jsonb_build_object(
        'visibility', preference.visibility,
        'recordedAtOverride', case
          when preference.recorded_at_override is not null
            and preference.display_local_date is not null
          then preference.recorded_at_override
          else null
        end,
        'localDate', case
          when preference.recorded_at_override is not null
            and preference.display_local_date is not null
          then preference.display_local_date
          else null
        end,
        'dismissed', case when preference.dismissed then true else null end
      ))
    ), '{}'::jsonb)
    into v_registry
    from public.google_health_entry_preferences preference
   where preference.user_id = p_user_id;

  v_settings := coalesce(p_client_payload -> 'settings', '{}'::jsonb)
    - 'googleHealthEntryOverrides';
  if v_registry <> '{}'::jsonb then
    v_settings := jsonb_set(
      v_settings,
      '{googleHealthEntryOverrides}',
      v_registry,
      true
    );
  end if;

  -- Released clients should never send Google provider ids through ordinary
  -- deletion outboxes. Strip them defensively so only the authenticated Edge
  -- mutation boundary can alter Google ownership or preferences.
  foreach v_key in array array[
    'pendingDeletedEntryIds',
    'deletedEntryIds',
    'dismissedHealthEntryIds'
  ] loop
    if jsonb_typeof(v_settings -> v_key) = 'array' then
      select coalesce(jsonb_agg(item.value order by item.ordinality), '[]'::jsonb)
        into v_filtered_ids
        from jsonb_array_elements(v_settings -> v_key)
          with ordinality item(value, ordinality)
       where not (
         jsonb_typeof(item.value) = 'string'
         and (
           (item.value #>> '{}') like 'google-health:%'
           or (item.value #>> '{}') like 'health:google_health:%'
         )
       );
      v_settings := jsonb_set(v_settings, array[v_key], v_filtered_ids, true);
    end if;
  end loop;

  return jsonb_set(
    jsonb_set(
      jsonb_set(
        p_client_payload,
        '{entries}',
        v_client_entries || v_server_entries,
        true
      ),
      '{dailyMetricStatuses}',
      v_client_statuses,
      true
    ),
    '{settings}',
    v_settings,
    true
  );
end;
$$;

revoke all on function public.merge_google_health_server_snapshot(uuid, jsonb)
  from public, anon, authenticated, service_role;

-- Preserve the optimistic revision contract while making the server-owned
-- Google subset impossible for a stale/cache-safe client snapshot to erase.
create or replace function public.sync_user_snapshot(
  expected_revision bigint,
  new_payload jsonb,
  client_device_id text,
  client_schema_version integer
)
returns table (revision bigint, updated_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := (select auth.uid());
  next_revision bigint;
  current_revision bigint;
  changed_at timestamptz := now();
  sanitized_payload jsonb;
  snapshot_exists boolean := false;
begin
  if caller_id is null then
    raise exception using errcode = '42501', message = 'Authentication required';
  end if;
  if jsonb_typeof(new_payload) <> 'object' then
    raise exception using errcode = '22023', message = 'Snapshot payload must be a JSON object';
  end if;
  if client_schema_version < 1 then
    raise exception using errcode = '22023', message = 'Invalid schema version';
  end if;
  perform public.assert_google_health_privacy_client(
    caller_id,
    client_schema_version
  );

  -- Import reconciliation and account saves share this snapshot row lock. If
  -- an import committed first, this write sees its ownership rows; if this
  -- write committed first, the import observes a revision conflict and retries.
  select snapshot.revision
    into current_revision
    from public.user_snapshots snapshot
   where snapshot.user_id = caller_id
   for update;
  snapshot_exists := found;
  if snapshot_exists and current_revision is distinct from expected_revision then
    raise exception using errcode = 'P0001', message = 'snapshot_conflict';
  end if;

  sanitized_payload := public.merge_google_health_server_snapshot(
    caller_id,
    new_payload
  );
  if snapshot_exists then
    update public.user_snapshots snapshot
       set payload = sanitized_payload,
           revision = snapshot.revision + 1,
           device_id = client_device_id,
           schema_version = client_schema_version,
           updated_at = changed_at
     where snapshot.user_id = caller_id
     returning snapshot.revision into next_revision;
  else
    begin
      insert into public.user_snapshots (
        user_id, payload, revision, device_id, schema_version, updated_at
      ) values (
        caller_id,
        sanitized_payload,
        1,
        client_device_id,
        client_schema_version,
        changed_at
      )
      returning public.user_snapshots.revision into next_revision;
    exception when unique_violation then
      raise exception using errcode = 'P0001', message = 'snapshot_conflict';
    end;
  end if;

  insert into public.account_devices (user_id, device_id, platform, last_seen_at)
  values (caller_id, client_device_id, 'unknown', changed_at)
  on conflict (user_id, device_id) do update
    set last_seen_at = excluded.last_seen_at;

  return query select next_revision, changed_at;
end;
$$;

revoke all on function public.sync_user_snapshot(bigint, jsonb, text, integer)
  from public, anon;
grant execute on function public.sync_user_snapshot(bigint, jsonb, text, integer)
  to authenticated;

-- Repair snapshots already overwritten by a cache-safe client. This changes no
-- measurement: it only rematerialises the current server ownership records and
-- preference registry, then emits the normal revision notification.
with repaired as materialized (
  select
    snapshot.user_id,
    public.merge_google_health_server_snapshot(
      snapshot.user_id,
      snapshot.payload
    ) as payload
    from public.user_snapshots snapshot
   where exists (
     select 1
       from public.google_health_import_records owned
      where owned.user_id = snapshot.user_id
   )
   or exists (
     select 1
       from public.google_health_entry_preferences preference
      where preference.user_id = snapshot.user_id
   )
)
update public.user_snapshots snapshot
   set payload = repaired.payload,
       revision = snapshot.revision + 1,
       device_id = 'google-health-server',
       updated_at = now()
  from repaired
 where snapshot.user_id = repaired.user_id
   and snapshot.payload is distinct from repaired.payload;
