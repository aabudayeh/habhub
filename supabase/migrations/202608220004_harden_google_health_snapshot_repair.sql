-- Keep a dismissed Google measurement hidden even if an older or partially
-- completed write left its ownership row behind. The preference registry is
-- the fail-closed authority for user dismissal intent.
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
         and not exists (
           select 1
             from public.google_health_entry_preferences preference
            where preference.user_id = owned.user_id
              and preference.entry_id = owned.entry_id
              and preference.dismissed = true
         )
       order by owned.entry_id, owned.updated_at desc, owned.external_id
    ) authoritative;

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

-- Serialize the one-time forward repair with all ordinary snapshot writers.
-- Every supported Google import/mutation also updates and locks this table, so
-- the helper below observes one coherent ownership/preferences generation.
lock table public.user_snapshots in share row exclusive mode;

-- Re-evaluate the helper from the UPDATE target's current payload. In
-- particular, do not replay a payload materialized before the row was locked.
update public.user_snapshots snapshot
   set payload = public.merge_google_health_server_snapshot(
         snapshot.user_id,
         snapshot.payload
       ),
       revision = snapshot.revision + 1,
       device_id = 'google-health-server',
       updated_at = now()
 where (
   exists (
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
 and snapshot.payload is distinct from
   public.merge_google_health_server_snapshot(
     snapshot.user_id,
     snapshot.payload
   );
