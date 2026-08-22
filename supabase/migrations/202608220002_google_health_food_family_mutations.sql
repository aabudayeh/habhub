-- A Google nutrition record materialises as one Food entry plus privacy-safe
-- nutrient sidecars.  The provider external id is their immutable family key;
-- mutating only the Food row would otherwise let reconciliation resurrect
-- dismissed nutrients or leave them on the Food row's old display day.
create index if not exists google_health_import_records_entry_idx
  on public.google_health_import_records (user_id, entry_id);

create or replace function public.mutate_google_health_food_family(
  p_user_id uuid,
  p_entry_id text,
  p_action text,
  p_patch jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_target public.google_health_import_records%rowtype;
  v_preference public.google_health_entry_preferences%rowtype;
  v_result jsonb;
  v_family_ids text[] := array[]::text[];
  v_sidecar_ids text[] := array[]::text[];
  v_external_count integer := 0;
  v_family_count integer := 0;
  v_parent_count integer := 0;
  v_payload jsonb;
  v_original_payload jsonb;
  v_entries jsonb;
  v_settings jsonb;
  v_registry jsonb;
  v_override jsonb;
  v_revision bigint;
  v_recorded_at timestamptz;
  v_display_date date;
  v_clear_time boolean := false;
  v_entry_id text;
begin
  if (select auth.role()) is distinct from 'service_role' then
    raise exception 'google_health_service_role_required' using errcode = '42501';
  end if;
  if not public.google_health_runtime_enabled() then
    raise exception 'google_health_feature_disabled' using errcode = '55000';
  end if;
  if p_user_id is null
     or nullif(p_entry_id, '') is null
     or length(p_entry_id) > 360
     or p_action not in ('update', 'dismiss')
     or jsonb_typeof(coalesce(p_patch, '{}'::jsonb)) <> 'object' then
    raise exception 'invalid_google_health_entry_mutation' using errcode = '22023';
  end if;

  -- Follow the same account lock order as the canonical mutator.  Holding the
  -- snapshot row before inspecting ownership prevents a concurrent import
  -- from swapping the Food family between discovery and mutation.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_user_id::text, 744218)
  );
  select snapshot.payload, snapshot.revision
    into v_payload, v_revision
    from public.user_snapshots snapshot
   where snapshot.user_id = p_user_id
   for update;
  if v_revision is null then
    raise exception 'google_health_snapshot_missing' using errcode = 'P0002';
  end if;

  select count(distinct owned.external_id)::integer
    into v_external_count
    from public.google_health_import_records owned
   where owned.user_id = p_user_id
     and owned.entry_id = p_entry_id;
  if v_external_count > 1 then
    raise exception 'google_health_entry_ownership_ambiguous' using errcode = '55000';
  end if;

  select * into v_target
    from public.google_health_import_records owned
   where owned.user_id = p_user_id
     and owned.entry_id = p_entry_id
   order by owned.updated_at desc, owned.external_id
   limit 1
   for update;
  select * into v_preference
    from public.google_health_entry_preferences preference
   where preference.user_id = p_user_id
     and preference.entry_id = p_entry_id
   for update;

  -- A completed dismissal has no remaining ownership row.  Delegate to the
  -- canonical preference-backed path so a retry is a harmless no-op; a truly
  -- unknown id still receives its ordinary not-found error.
  if v_target.entry_id is null then
    v_result := public.mutate_google_health_entry(
      p_user_id,
      p_entry_id,
      p_action,
      coalesce(p_patch, '{}'::jsonb)
    );
    return v_result || case when p_action = 'dismiss'
      then jsonb_build_object('dismissedEntryIds', jsonb_build_array(p_entry_id))
      else jsonb_build_object('updatedEntryIds', jsonb_build_array(p_entry_id))
    end;
  end if;
  if coalesce(v_target.entry ->> 'sourceProvider', '') <> 'google_health' then
    raise exception 'google_health_entry_not_found' using errcode = 'P0002';
  end if;

  -- Non-Food entries retain the existing single-entry semantics.
  if coalesce(v_target.entry ->> 'metricId', '') <> 'food' then
    v_result := public.mutate_google_health_entry(
      p_user_id,
      p_entry_id,
      p_action,
      coalesce(p_patch, '{}'::jsonb)
    );
    return v_result || case when p_action = 'dismiss'
      then jsonb_build_object('dismissedEntryIds', jsonb_build_array(p_entry_id))
      else jsonb_build_object('updatedEntryIds', jsonb_build_array(p_entry_id))
    end;
  end if;

  -- Bound corrupted/provider-hostile families before doing any work.  The
  -- canonical nutrition surface is far below 128 rows.  Food sorts last so a
  -- cascading dismissal always removes projections before their parent.
  select coalesce(
           array_agg(family.entry_id order by family.parent_order, family.entry_id),
           array[]::text[]
         )
    into v_family_ids
    from (
      select
        owned.entry_id,
        case when owned.entry ->> 'metricId' = 'food' then 1 else 0 end as parent_order
        from public.google_health_import_records owned
       where owned.user_id = p_user_id
         and owned.external_id = v_target.external_id
       order by parent_order, owned.entry_id
       limit 129
    ) family;
  v_family_count := cardinality(v_family_ids);
  if v_family_count > 128 then
    raise exception 'google_health_food_family_too_large' using errcode = '54000';
  end if;
  if v_family_count = 0 or not (p_entry_id = any(v_family_ids)) then
    raise exception 'google_health_food_family_missing' using errcode = '55000';
  end if;
  select count(*)::integer
    into v_parent_count
    from public.google_health_import_records owned
   where owned.user_id = p_user_id
     and owned.external_id = v_target.external_id
     and owned.entry ->> 'metricId' = 'food';
  if v_parent_count <> 1 or exists (
    select 1
      from public.google_health_import_records owned
     where owned.user_id = p_user_id
       and owned.external_id = v_target.external_id
       and coalesce(owned.entry ->> 'sourceProvider', '') <> 'google_health'
  ) then
    raise exception 'google_health_food_family_invalid' using errcode = '55000';
  end if;

  if p_action = 'dismiss' then
    foreach v_entry_id in array v_family_ids loop
      v_result := public.mutate_google_health_entry(
        p_user_id,
        v_entry_id,
        'dismiss',
        '{}'::jsonb
      );
    end loop;
    return v_result || jsonb_build_object(
      'dismissedEntryId', p_entry_id,
      'dismissedEntryIds', to_jsonb(v_family_ids)
    );
  end if;

  -- Food remains the canonical validation/mutation boundary.  In particular,
  -- visibility is changed only on the requested Food entry.  After that
  -- succeeds, only an explicitly paired time/date edit is mirrored below.
  v_result := public.mutate_google_health_entry(
    p_user_id,
    p_entry_id,
    'update',
    coalesce(p_patch, '{}'::jsonb)
  );
  if not (coalesce(p_patch, '{}'::jsonb) ? 'recordedAtOverride') then
    return v_result || jsonb_build_object(
      'updatedEntryIds', jsonb_build_array(p_entry_id)
    );
  end if;

  select coalesce(array_agg(family.entry_id order by family.entry_id), array[]::text[])
    into v_sidecar_ids
    from unnest(v_family_ids) family(entry_id)
   where family.entry_id <> p_entry_id;
  if cardinality(v_sidecar_ids) = 0 then
    return v_result || jsonb_build_object(
      'updatedEntryIds', jsonb_build_array(p_entry_id)
    );
  end if;

  v_clear_time := jsonb_typeof(p_patch -> 'recordedAtOverride') = 'null';
  if v_clear_time then
    if exists (
      select 1
        from public.google_health_import_records owned
       where owned.user_id = p_user_id
         and owned.external_id = v_target.external_id
         and owned.entry_id = any(v_sidecar_ids)
         and nullif(owned.entry ->> 'sourceRecordedAt', '') is null
    ) then
      raise exception 'google_health_family_source_time_missing' using errcode = '55000';
    end if;
    v_recorded_at := null;
    v_display_date := null;
  else
    -- The canonical Food mutation above already validated format, pairing,
    -- and calendar casts.  Keep explicit casts here for durable preferences.
    v_recorded_at := (p_patch ->> 'recordedAtOverride')::timestamptz;
    v_display_date := (p_patch ->> 'localDate')::date;
  end if;

  update public.google_health_import_records owned
     set entry = case when v_clear_time then
           (owned.entry - 'recordedAtOverride') || jsonb_build_object(
             'recordedAt', owned.entry ->> 'sourceRecordedAt',
             'localDate', owned.local_date::text
           )
         else owned.entry || jsonb_build_object(
           'recordedAtOverride', p_patch ->> 'recordedAtOverride',
           'recordedAt', p_patch ->> 'recordedAtOverride',
           'localDate', p_patch ->> 'localDate'
         ) end,
         updated_at = now()
   where owned.user_id = p_user_id
     and owned.external_id = v_target.external_id
     and owned.entry_id = any(v_sidecar_ids);

  insert into public.google_health_entry_preferences (
    user_id, entry_id, metric_id, data_type, source_local_date, visibility,
    recorded_at_override, display_local_date, dismissed, updated_at
  )
  select
    p_user_id,
    owned.entry_id,
    owned.entry ->> 'metricId',
    owned.data_type,
    owned.local_date,
    null,
    v_recorded_at,
    v_display_date,
    false,
    now()
    from public.google_health_import_records owned
   where owned.user_id = p_user_id
     and owned.external_id = v_target.external_id
     and owned.entry_id = any(v_sidecar_ids)
  on conflict (user_id, entry_id) do update
    set metric_id = excluded.metric_id,
        data_type = excluded.data_type,
        source_local_date = excluded.source_local_date,
        recorded_at_override = excluded.recorded_at_override,
        display_local_date = excluded.display_local_date,
        updated_at = excluded.updated_at;

  -- Mirror the durable server registry and embedded snapshot entries in one
  -- revision.  Existing sidecar visibility/dismissal choices are preserved.
  select snapshot.payload, snapshot.revision
    into v_payload, v_revision
    from public.user_snapshots snapshot
   where snapshot.user_id = p_user_id
   for update;
  v_original_payload := v_payload;
  v_entries := case when jsonb_typeof(v_payload -> 'entries') = 'array'
    then v_payload -> 'entries' else '[]'::jsonb end;
  v_settings := case when jsonb_typeof(v_payload -> 'settings') = 'object'
    then v_payload -> 'settings' else '{}'::jsonb end;
  v_registry := case when jsonb_typeof(v_settings -> 'googleHealthEntryOverrides') = 'object'
    then v_settings -> 'googleHealthEntryOverrides' else '{}'::jsonb end;
  foreach v_entry_id in array v_sidecar_ids loop
    v_override := case when jsonb_typeof(v_registry -> v_entry_id) = 'object'
      then v_registry -> v_entry_id else '{}'::jsonb end;
    if v_clear_time then
      v_override := v_override - 'recordedAtOverride' - 'localDate';
    else
      v_override := v_override || jsonb_build_object(
        'recordedAtOverride', p_patch ->> 'recordedAtOverride',
        'localDate', p_patch ->> 'localDate'
      );
    end if;
    v_registry := jsonb_set(v_registry, array[v_entry_id], v_override, true);
  end loop;
  v_settings := jsonb_set(
    v_settings,
    '{googleHealthEntryOverrides}',
    v_registry,
    true
  );
  select coalesce(jsonb_agg(
      coalesce((
        select owned.entry
          from public.google_health_import_records owned
         where owned.user_id = p_user_id
           and owned.external_id = v_target.external_id
           and owned.entry_id = item.entry ->> 'id'
         limit 1
      ), item.entry)
      order by item.ordinality
    ), '[]'::jsonb)
    into v_entries
    from jsonb_array_elements(v_entries) with ordinality item(entry, ordinality);
  v_payload := jsonb_set(
    jsonb_set(v_payload, '{entries}', v_entries, true),
    '{settings}', v_settings, true
  );
  if v_payload is distinct from v_original_payload then
    update public.user_snapshots snapshot
       set payload = v_payload,
           revision = snapshot.revision + 1,
           device_id = 'google-health-server',
           updated_at = now()
     where snapshot.user_id = p_user_id
     returning snapshot.revision into v_revision;
  end if;

  perform public.purge_google_health_group_projections(
    p_user_id,
    v_family_ids,
    v_revision,
    false
  );
  return v_result || jsonb_build_object(
    'updatedEntryIds', to_jsonb(v_family_ids),
    'revision', v_revision
  );
end;
$$;

revoke all on function public.mutate_google_health_food_family(uuid, text, text, jsonb)
  from public, anon, authenticated;
grant execute on function public.mutate_google_health_food_family(uuid, text, text, jsonb)
  to service_role;
