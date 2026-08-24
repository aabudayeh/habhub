-- A Google Health import updates the private account snapshot while no client
-- may be open to publish the corresponding group read model. Project direct
-- tracker values from that same revision on the server so background imports
-- are visible immediately without widening any entry/status privacy policy.

create or replace function public.google_health_projection_date(
  p_value text,
  p_fallback date
)
returns date
language plpgsql
immutable
set search_path = ''
as $$
begin
  if coalesce(p_value, '') !~ '^\d{4}-\d{2}-\d{2}$' then
    return p_fallback;
  end if;
  begin
    return p_value::date;
  exception when others then
    return p_fallback;
  end;
end;
$$;

revoke all on function public.google_health_projection_date(text, date)
  from public, anon, authenticated;

create or replace function public.google_health_projection_timestamp(
  p_value text,
  p_fallback timestamptz
)
returns timestamptz
language plpgsql
immutable
set search_path = ''
as $$
begin
  if nullif(p_value, '') is null then
    return p_fallback;
  end if;
  begin
    return p_value::timestamptz;
  exception when others then
    return p_fallback;
  end;
end;
$$;

revoke all on function public.google_health_projection_timestamp(text, timestamptz)
  from public, anon, authenticated;

create or replace function public.google_health_goal_schedule_applies(
  p_metric jsonb,
  p_local_date date
)
returns boolean
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_schedule jsonb := coalesce(p_metric -> 'goalSchedule', '{}'::jsonb);
  v_mode text := coalesce(v_schedule ->> 'mode', 'daily');
  v_anchor date := public.google_health_projection_date(
    coalesce(v_schedule ->> 'anchorDate', p_metric ->> 'activeFrom'),
    p_local_date
  );
  v_end date := public.google_health_projection_date(
    v_schedule ->> 'endDate',
    null
  );
  v_interval integer := 1;
begin
  if v_end is not null and p_local_date > v_end then
    return false;
  end if;
  if v_mode = 'once' then
    return p_local_date = v_anchor;
  end if;
  if v_mode = 'daily' then
    return p_local_date >= v_anchor;
  end if;
  if p_local_date < v_anchor then
    return false;
  end if;
  if v_mode = 'selected_days' then
    return exists (
      select 1
        from jsonb_array_elements(
          case when jsonb_typeof(v_schedule -> 'daysOfWeek') = 'array'
            then v_schedule -> 'daysOfWeek' else '[]'::jsonb end
        ) item
       where item #>> '{}' ~ '^\d+$'
         and (item #>> '{}')::integer = extract(dow from p_local_date)::integer
    );
  end if;
  if v_mode in ('every_other_day', 'interval_days') then
    if v_mode = 'every_other_day' then
      v_interval := 2;
    elsif coalesce(v_schedule ->> 'intervalDays', '') ~ '^\d+([.]\d+)?$' then
      v_interval := greatest(1, round((v_schedule ->> 'intervalDays')::numeric)::integer);
    end if;
    return mod(p_local_date - v_anchor, v_interval) = 0;
  end if;
  if v_mode = 'days_of_month' then
    return exists (
      select 1
        from jsonb_array_elements(
          case when jsonb_typeof(v_schedule -> 'daysOfMonth') = 'array'
            then v_schedule -> 'daysOfMonth' else '[]'::jsonb end
        ) item
       where item #>> '{}' ~ '^\d+$'
         and (item #>> '{}')::integer = extract(day from p_local_date)::integer
    );
  end if;
  -- Minimum-per-week/month trackers remain actionable on every day in their
  -- period. The ordinary client can later enrich the cross-day completion.
  return true;
end;
$$;

revoke all on function public.google_health_goal_schedule_applies(jsonb, date)
  from public, anon, authenticated;

create or replace function public.google_health_direct_goal_projection(
  p_metric jsonb,
  p_value numeric,
  p_visibility text,
  p_local_date date,
  p_tracked_periods jsonb
)
returns jsonb
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_metric_id text := coalesce(p_metric ->> 'id', '');
  v_kind text := coalesce(p_metric #>> '{goal,kind}', 'at_least');
  v_target numeric := 0;
  v_range_min numeric;
  v_range_max numeric;
  v_enabled boolean := coalesce(p_metric ->> 'goalEnabled', 'true') <> 'false';
  v_eligible boolean := false;
  v_reached boolean := false;
  v_score numeric := 0;
  v_progress numeric := 0;
  v_ratio numeric := 0;
  v_tolerance numeric := 0;
begin
  if v_kind not in ('at_least', 'at_most', 'exact', 'complete') then
    v_kind := 'at_least';
  end if;
  if jsonb_typeof(p_metric #> '{goal,target}') = 'number' then
    v_target := (p_metric #>> '{goal,target}')::numeric;
  end if;
  if jsonb_typeof(p_metric #> '{goalRange,min}') = 'number'
     and jsonb_typeof(p_metric #> '{goalRange,max}') = 'number' then
    v_range_min := (p_metric #>> '{goalRange,min}')::numeric;
    v_range_max := (p_metric #>> '{goalRange,max}')::numeric;
  end if;

  if jsonb_typeof(coalesce(p_tracked_periods, '{}'::jsonb) -> v_metric_id) = 'array' then
    select exists (
      select 1
        from jsonb_array_elements(p_tracked_periods -> v_metric_id) period
       where public.google_health_projection_date(period ->> 'from', p_local_date) <= p_local_date
         and (
           nullif(period ->> 'to', '') is null
           or public.google_health_projection_date(period ->> 'to', p_local_date) >= p_local_date
         )
    ) into v_eligible;
  else
    v_eligible :=
      coalesce(p_metric #>> '{sections,today}', 'true') <> 'false'
      and public.google_health_projection_date(p_metric ->> 'activeFrom', p_local_date) <= p_local_date;
  end if;
  v_eligible := v_eligible
    and public.google_health_goal_schedule_applies(p_metric, p_local_date);

  if v_enabled then
    if v_range_min is not null and v_range_max is not null then
      v_reached := p_value between v_range_min and v_range_max;
      if p_value > 0 then
        if v_reached then
          v_ratio := 1;
        elsif p_value < v_range_min then
          v_ratio := greatest(0, 1 - abs(p_value - v_range_min) / greatest(abs(v_range_min), 1));
        else
          v_ratio := greatest(0, 1 - abs(p_value - v_range_max) / greatest(abs(v_range_max), 1));
        end if;
      end if;
      v_score := least(1, v_ratio) * 100;
      v_progress := least(3, v_ratio) * 100;
    elsif v_kind = 'complete' then
      v_reached := p_value > 0;
      v_score := case when v_reached then 100 else 0 end;
      v_progress := v_score;
    else
      v_ratio := greatest(0, p_value) / greatest(abs(v_target), 0.0001);
      if v_kind = 'at_most' then
        v_reached := p_value > 0 and p_value <= v_target;
        v_score := case
          when p_value <= 0 then 0
          when p_value <= v_target then 100
          else greatest(0, 1 - (p_value - v_target) / greatest(abs(v_target), 0.0001)) * 100
        end;
      elsif v_kind = 'exact' then
        v_tolerance := case
          when coalesce(p_metric ->> 'unit', '') = 'kcal'
            then greatest(50, abs(v_target) * 0.05)
          when coalesce(p_metric ->> 'unit', '') = 'kg' then 0.2
          else greatest(0.1, abs(v_target) * 0.02)
        end;
        v_reached := abs(p_value - v_target) <= v_tolerance;
        v_score := greatest(0, 1 - abs(p_value - v_target) / greatest(abs(v_target), 0.0001)) * 100;
      else
        v_reached := p_value >= v_target;
        v_score := least(1, v_ratio) * 100;
      end if;
      if v_metric_id in ('food', 'deficit') then
        v_score := greatest(0, least(1, case when v_ratio <= 1 then v_ratio else 2 - v_ratio end)) * 100;
      end if;
      v_progress := least(3, v_ratio) * 100;
    end if;
  end if;
  if v_metric_id = 'weight' then
    v_reached := false;
  end if;

  if p_visibility = 'status' then
    v_score := floor(greatest(0, least(100, v_score)) / 25) * 25;
    v_progress := floor(greatest(0, least(300, v_progress)) / 25) * 25;
  else
    v_score := greatest(0, least(100, v_score));
    v_progress := greatest(0, least(300, v_progress));
  end if;

  return jsonb_build_object(
    'goalReached', v_reached,
    'scoreContribution', v_score,
    'goalProgress', v_progress,
    'goalKind', v_kind,
    'goalTarget', case when p_visibility = 'status' then null else to_jsonb(v_target) end,
    'goalEligible', v_eligible
  );
end;
$$;

revoke all on function public.google_health_direct_goal_projection(jsonb, numeric, text, date, jsonb)
  from public, anon, authenticated;

-- When a client eventually opens, hand a server-created detail row back to
-- its stable client id before the provider identity unique constraint runs.
-- This affects only the signed-in owner's Google row for the same group metric.
create or replace function public.handoff_google_health_server_detail_projection()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is not null
     and new.user_id = (select auth.uid())
     and new.source_provider = 'google_health'
     and new.source_record_id is not null
     and new.client_generated_id not like 'google-health-group:%' then
    insert into public.metric_entry_tombstones (
      group_id, user_id, client_generated_id, local_date, visibility, deleted_at
    )
    select
      definition.group_id,
      existing.user_id,
      existing.client_generated_id,
      existing.local_date,
      existing.visibility,
      statement_timestamp()
      from public.metric_entries existing
      join public.metric_definitions definition on definition.id = existing.metric_id
     where existing.user_id = new.user_id
       and existing.metric_id = new.metric_id
       and existing.source_provider = 'google_health'
       and existing.source_record_id = new.source_record_id
       and existing.client_generated_id like 'google-health-group:%'
       and existing.client_generated_id <> new.client_generated_id
       and definition.group_id is not null
    on conflict (user_id, client_generated_id) do update
      set group_id = excluded.group_id,
          local_date = excluded.local_date,
          visibility = case
            when public.metric_entry_tombstones.visibility::text = 'group'
              or excluded.visibility::text = 'group'
            then 'group'::public.entry_visibility
            else excluded.visibility
          end,
          deleted_at = excluded.deleted_at;

    delete from public.metric_entries existing
     where existing.user_id = new.user_id
       and existing.metric_id = new.metric_id
       and existing.source_provider = 'google_health'
       and existing.source_record_id = new.source_record_id
       and existing.client_generated_id like 'google-health-group:%'
       and existing.client_generated_id <> new.client_generated_id;
  end if;
  return new;
end;
$$;

revoke all on function public.handoff_google_health_server_detail_projection()
  from public, anon, authenticated;

drop trigger if exists metric_entries_a_handoff_google_health_projection
  on public.metric_entries;
create trigger metric_entries_a_handoff_google_health_projection
before insert on public.metric_entries
for each row execute function public.handoff_google_health_server_detail_projection();

create or replace function public.project_google_health_group_data(
  p_user_id uuid,
  p_snapshot_revision bigint
)
returns table (
  revision bigint,
  projected_entries integer,
  projected_statuses integer,
  removed_count integer,
  bumped_groups integer
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_payload jsonb;
  v_revision bigint;
  v_entry_changes integer := 0;
  v_status_changes integer := 0;
  v_removed integer := 0;
  v_bumped integer := 0;
  v_count integer := 0;
  v_group record;
begin
  if (select auth.role()) is distinct from 'service_role' then
    raise exception 'google_health_service_role_required' using errcode = '42501';
  end if;
  if p_user_id is null or p_snapshot_revision is null then
    raise exception 'invalid_google_health_group_projection' using errcode = '22023';
  end if;

  select snapshot.payload, snapshot.revision
    into v_payload, v_revision
    from public.user_snapshots snapshot
   where snapshot.user_id = p_user_id
   for update;
  if v_revision is null then
    raise exception 'google_health_snapshot_missing' using errcode = 'P0002';
  end if;
  if v_revision <> p_snapshot_revision then
    raise exception 'google_health_projection_conflict' using errcode = '40001';
  end if;
  if jsonb_typeof(coalesce(v_payload -> 'entries', '[]'::jsonb)) <> 'array'
     or jsonb_typeof(coalesce(v_payload -> 'metrics', '[]'::jsonb)) <> 'array' then
    raise exception 'google_health_snapshot_projection_invalid' using errcode = '22023';
  end if;

  create temporary table if not exists pg_temp.habhub_google_health_projection_entries (
    row_id bigint generated always as identity primary key,
    group_id uuid not null,
    metric_id uuid not null,
    metric_slug text not null,
    aggregation_method text not null,
    local_date date not null,
    recorded_at timestamptz not null,
    revision_at timestamptz not null,
    entry_id text not null,
    entry jsonb not null,
    personal_metric jsonb not null,
    numeric_value numeric not null,
    visibility text not null,
    source_provider text,
    provider_priority smallint not null,
    imported_identity boolean not null,
    owned_google boolean not null,
    step_exact_selected boolean not null default false,
    step_status_selected boolean not null default false,
    step_exact_without_google_selected boolean not null default false,
    step_status_without_google_selected boolean not null default false
  ) on commit drop;
  truncate pg_temp.habhub_google_health_projection_entries;

  create temporary table if not exists pg_temp.habhub_google_health_projection_status (
    group_id uuid not null,
    metric_id uuid not null,
    local_date date not null,
    goal_reached boolean not null,
    score_contribution numeric not null,
    goal_progress numeric not null,
    goal_kind text not null,
    goal_target numeric,
    visibility text not null,
    goal_eligible boolean not null,
    exact_value numeric,
    has_data boolean not null,
    source_provider text,
    primary key (group_id, metric_id, local_date)
  ) on commit drop;
  truncate pg_temp.habhub_google_health_projection_status;

  create temporary table if not exists pg_temp.habhub_google_health_projection_raw (
    group_id uuid not null,
    metric_id uuid not null,
    local_date date not null,
    client_generated_id text not null,
    value jsonb not null,
    recorded_at timestamptz not null,
    visibility public.entry_visibility not null,
    source text not null,
    label text,
    note text,
    nutrition jsonb,
    submetric_values jsonb,
    image_path text,
    source_record_id text not null,
    source_origin text,
    source_updated_at timestamptz,
    primary key (group_id, client_generated_id)
  ) on commit drop;
  truncate pg_temp.habhub_google_health_projection_raw;

  create temporary table if not exists pg_temp.habhub_google_health_projection_changed (
    group_id uuid not null,
    local_date date not null,
    primary key (group_id, local_date)
  ) on commit drop;
  truncate pg_temp.habhub_google_health_projection_changed;

  with snapshot_target_dates as (
    select distinct
      snapshot_entry ->> 'metricId' as metric_slug,
      public.google_health_projection_date(
        snapshot_entry ->> 'localDate',
        null
      ) as local_date
      from jsonb_array_elements(v_payload -> 'entries') snapshot_entry
     where nullif(snapshot_entry ->> 'metricId', '') is not null
       and public.google_health_projection_date(
         snapshot_entry ->> 'localDate',
         null
       ) is not null
  ), owned_targets as (
    select distinct
      owned.entry ->> 'metricId' as metric_slug,
      public.google_health_projection_date(
        owned.entry ->> 'localDate',
        owned.local_date
      ) as local_date
      from public.google_health_import_records owned
     where owned.user_id = p_user_id
       and nullif(owned.entry ->> 'metricId', '') is not null
    union
    -- The final Google contribution for a metric/date may have just been
    -- deleted by apply_google_health_import. Keep the old relational target in
    -- scope for this projection pass so remaining manual/native snapshot rows
    -- replace the mixed total instead of the entire daily status disappearing.
    select definition.slug, status.local_date
      from public.daily_metric_status status
      join public.metric_definitions definition on definition.id = status.metric_id
     where status.user_id = p_user_id
       and status.source_provider = 'google_health'
    union
    select definition.slug, entry.local_date
      from public.metric_entries entry
      join public.metric_definitions definition on definition.id = entry.metric_id
     where entry.user_id = p_user_id
       and entry.source_provider = 'google_health'
    union
    -- apply_google_health_import fences and removes changed Google-derived
    -- statuses before this projector runs. The fence intentionally carries no
    -- date, so rebuild every still-present shared snapshot date for that
    -- tracker at the just-fenced revision. Empty dates correctly stay deleted.
    select
      definition.slug,
      snapshot_target.local_date
      from public.metric_privacy_cache_fences fence
      join public.metric_definitions definition on definition.id = fence.metric_id
      join snapshot_target_dates snapshot_target
        on snapshot_target.metric_slug = definition.slug
     where fence.user_id = p_user_id
       and fence.revision >= v_revision
  ), snapshot_entries as (
    select entry
      from jsonb_array_elements(v_payload -> 'entries') entry
     where nullif(entry ->> 'id', '') is not null
       and nullif(entry ->> 'metricId', '') is not null
       and coalesce(entry ->> 'visibility', '') in ('private', 'status', 'group')
       and jsonb_typeof(entry -> 'value') in ('number', 'boolean')
  ), personal_metrics as (
    select metric
      from jsonb_array_elements(v_payload -> 'metrics') metric
     where nullif(metric ->> 'id', '') is not null
  )
  insert into pg_temp.habhub_google_health_projection_entries (
    group_id,
    metric_id,
    metric_slug,
    aggregation_method,
    local_date,
    recorded_at,
    revision_at,
    entry_id,
    entry,
    personal_metric,
    numeric_value,
    visibility,
    source_provider,
    provider_priority,
    imported_identity,
    owned_google
  )
  select
    membership.group_id,
    definition.id,
    definition.slug,
    definition.aggregation_method,
    target.local_date,
    public.google_health_projection_timestamp(
      snapshot_entry.entry ->> 'recordedAt',
      target.local_date::timestamptz
    ),
    public.google_health_projection_timestamp(
      coalesce(
        snapshot_entry.entry ->> 'sourceUpdatedAt',
        snapshot_entry.entry ->> 'recordedAt'
      ),
      target.local_date::timestamptz
    ),
    snapshot_entry.entry ->> 'id',
    snapshot_entry.entry,
    personal.metric,
    case jsonb_typeof(snapshot_entry.entry -> 'value')
      when 'boolean' then case
        when (snapshot_entry.entry ->> 'value')::boolean then 1 else 0 end
      else (snapshot_entry.entry ->> 'value')::numeric
    end,
    snapshot_entry.entry ->> 'visibility',
    nullif(snapshot_entry.entry ->> 'sourceProvider', ''),
    case
      when snapshot_entry.entry ->> 'sourceProvider' in ('health_connect', 'apple_health', 'healthkit') then 2
      when snapshot_entry.entry ->> 'sourceProvider' = 'google_health' then 1
      else 0
    end,
    snapshot_entry.entry ->> 'source' = 'imported'
      or nullif(snapshot_entry.entry ->> 'sourceProvider', '') is not null
      or nullif(snapshot_entry.entry ->> 'sourceRecordId', '') is not null
      or nullif(snapshot_entry.entry ->> 'sourceOrigin', '') is not null,
    exists (
      select 1
        from public.google_health_import_records owned
       where owned.user_id = p_user_id
         and owned.entry_id = snapshot_entry.entry ->> 'id'
    )
  from snapshot_entries snapshot_entry
  join owned_targets target
    on target.metric_slug = snapshot_entry.entry ->> 'metricId'
   and target.local_date = public.google_health_projection_date(
     snapshot_entry.entry ->> 'localDate',
     null
   )
  join personal_metrics personal
    on personal.metric ->> 'id' = target.metric_slug
  join public.group_members membership
    on membership.user_id = p_user_id
   and membership.status = 'active'
  join public.metric_definitions definition
    on definition.group_id = membership.group_id
   and definition.slug = target.metric_slug
   and definition.archived_at is null
   and definition.data_type::text not in ('text', 'photo', 'calculated');

  -- Steps are a daily total. Mirror the client authority rule instead of
  -- summing native, manual, and Google aggregates from the same day.
  with ranked as (
    select
      source.row_id,
      source.group_id,
      source.metric_id,
      source.local_date,
      source.imported_identity,
      row_number() over (
        partition by source.group_id, source.metric_id, source.local_date, source.imported_identity
        order by
          case when source.imported_identity then source.provider_priority else 0 end desc,
          source.revision_at desc,
          source.entry_id desc
      ) as stream_rank
      from pg_temp.habhub_google_health_projection_entries source
     where source.metric_slug = 'steps'
       and source.visibility = 'group'
  ), chosen as (
    select row_id
      from (
        select
          winner.row_id,
          row_number() over (
            partition by winner.group_id, winner.metric_id, winner.local_date
            order by winner.revision_at desc, winner.imported_identity desc, winner.entry_id desc
          ) as final_rank
        from (
          select ranked.*, source.revision_at, source.entry_id
            from ranked
            join pg_temp.habhub_google_health_projection_entries source using (row_id)
           where ranked.stream_rank = 1
        ) winner
      ) final
     where final.final_rank = 1
  )
  update pg_temp.habhub_google_health_projection_entries target
     set step_exact_selected = true
    from chosen
   where target.row_id = chosen.row_id;

  with ranked as (
    select
      source.row_id,
      source.group_id,
      source.metric_id,
      source.local_date,
      source.imported_identity,
      row_number() over (
        partition by source.group_id, source.metric_id, source.local_date, source.imported_identity
        order by
          case when source.imported_identity then source.provider_priority else 0 end desc,
          source.revision_at desc,
          source.entry_id desc
      ) as stream_rank
      from pg_temp.habhub_google_health_projection_entries source
     where source.metric_slug = 'steps'
       and source.visibility in ('group', 'status')
  ), chosen as (
    select row_id
      from (
        select
          winner.row_id,
          row_number() over (
            partition by winner.group_id, winner.metric_id, winner.local_date
            order by winner.revision_at desc, winner.imported_identity desc, winner.entry_id desc
          ) as final_rank
        from (
          select ranked.*, source.revision_at, source.entry_id
            from ranked
            join pg_temp.habhub_google_health_projection_entries source using (row_id)
           where ranked.stream_rank = 1
        ) winner
      ) final
     where final.final_rank = 1
  )
  update pg_temp.habhub_google_health_projection_entries target
     set step_status_selected = true
    from chosen
   where target.row_id = chosen.row_id;

  with ranked as (
    select
      source.row_id,
      source.group_id,
      source.metric_id,
      source.local_date,
      source.imported_identity,
      row_number() over (
        partition by source.group_id, source.metric_id, source.local_date, source.imported_identity
        order by
          case when source.imported_identity then source.provider_priority else 0 end desc,
          source.revision_at desc,
          source.entry_id desc
      ) as stream_rank
      from pg_temp.habhub_google_health_projection_entries source
     where source.metric_slug = 'steps'
       and source.visibility = 'group'
       and not source.owned_google
  ), chosen as (
    select row_id
      from (
        select
          winner.row_id,
          row_number() over (
            partition by winner.group_id, winner.metric_id, winner.local_date
            order by winner.revision_at desc, winner.imported_identity desc, winner.entry_id desc
          ) as final_rank
        from (
          select ranked.*, source.revision_at, source.entry_id
            from ranked
            join pg_temp.habhub_google_health_projection_entries source using (row_id)
           where ranked.stream_rank = 1
        ) winner
      ) final
     where final.final_rank = 1
  )
  update pg_temp.habhub_google_health_projection_entries target
     set step_exact_without_google_selected = true
    from chosen
   where target.row_id = chosen.row_id;

  with ranked as (
    select
      source.row_id,
      source.group_id,
      source.metric_id,
      source.local_date,
      source.imported_identity,
      row_number() over (
        partition by source.group_id, source.metric_id, source.local_date, source.imported_identity
        order by
          case when source.imported_identity then source.provider_priority else 0 end desc,
          source.revision_at desc,
          source.entry_id desc
      ) as stream_rank
      from pg_temp.habhub_google_health_projection_entries source
     where source.metric_slug = 'steps'
       and source.visibility in ('group', 'status')
       and not source.owned_google
  ), chosen as (
    select row_id
      from (
        select
          winner.row_id,
          row_number() over (
            partition by winner.group_id, winner.metric_id, winner.local_date
            order by winner.revision_at desc, winner.imported_identity desc, winner.entry_id desc
          ) as final_rank
        from (
          select ranked.*, source.revision_at, source.entry_id
            from ranked
            join pg_temp.habhub_google_health_projection_entries source using (row_id)
           where ranked.stream_rank = 1
        ) winner
      ) final
     where final.final_rank = 1
  )
  update pg_temp.habhub_google_health_projection_entries target
     set step_status_without_google_selected = true
    from chosen
   where target.row_id = chosen.row_id;

  with aggregated as (
    select
      source.group_id,
      source.metric_id,
      source.metric_slug,
      source.aggregation_method,
      source.local_date,
      source.personal_metric,
      case source.aggregation_method
        when 'average' then avg(source.numeric_value) filter (
          where source.visibility = 'group'
            and (source.metric_slug <> 'steps' or source.step_exact_selected)
        )
        when 'latest' then (array_agg(source.numeric_value order by source.recorded_at desc, source.entry_id desc) filter (
          where source.visibility = 'group'
            and (source.metric_slug <> 'steps' or source.step_exact_selected)
        ))[1]
        when 'max' then max(source.numeric_value) filter (
          where source.visibility = 'group'
            and (source.metric_slug <> 'steps' or source.step_exact_selected)
        )
        when 'min' then min(source.numeric_value) filter (
          where source.visibility = 'group'
            and (source.metric_slug <> 'steps' or source.step_exact_selected)
        )
        else sum(source.numeric_value) filter (
          where source.visibility = 'group'
            and (source.metric_slug <> 'steps' or source.step_exact_selected)
        )
      end as exact_value,
      case source.aggregation_method
        when 'average' then avg(source.numeric_value) filter (
          where source.visibility in ('group', 'status')
            and (source.metric_slug <> 'steps' or source.step_status_selected)
        )
        when 'latest' then (array_agg(source.numeric_value order by source.recorded_at desc, source.entry_id desc) filter (
          where source.visibility in ('group', 'status')
            and (source.metric_slug <> 'steps' or source.step_status_selected)
        ))[1]
        when 'max' then max(source.numeric_value) filter (
          where source.visibility in ('group', 'status')
            and (source.metric_slug <> 'steps' or source.step_status_selected)
        )
        when 'min' then min(source.numeric_value) filter (
          where source.visibility in ('group', 'status')
            and (source.metric_slug <> 'steps' or source.step_status_selected)
        )
        else sum(source.numeric_value) filter (
          where source.visibility in ('group', 'status')
            and (source.metric_slug <> 'steps' or source.step_status_selected)
        )
      end as status_value,
      case source.aggregation_method
        when 'average' then avg(source.numeric_value) filter (
          where source.visibility = 'group'
            and not source.owned_google
            and (source.metric_slug <> 'steps' or source.step_exact_without_google_selected)
        )
        when 'latest' then (array_agg(source.numeric_value order by source.recorded_at desc, source.entry_id desc) filter (
          where source.visibility = 'group'
            and not source.owned_google
            and (source.metric_slug <> 'steps' or source.step_exact_without_google_selected)
        ))[1]
        when 'max' then max(source.numeric_value) filter (
          where source.visibility = 'group'
            and not source.owned_google
            and (source.metric_slug <> 'steps' or source.step_exact_without_google_selected)
        )
        when 'min' then min(source.numeric_value) filter (
          where source.visibility = 'group'
            and not source.owned_google
            and (source.metric_slug <> 'steps' or source.step_exact_without_google_selected)
        )
        else sum(source.numeric_value) filter (
          where source.visibility = 'group'
            and not source.owned_google
            and (source.metric_slug <> 'steps' or source.step_exact_without_google_selected)
        )
      end as exact_without_google,
      case source.aggregation_method
        when 'average' then avg(source.numeric_value) filter (
          where source.visibility in ('group', 'status')
            and not source.owned_google
            and (source.metric_slug <> 'steps' or source.step_status_without_google_selected)
        )
        when 'latest' then (array_agg(source.numeric_value order by source.recorded_at desc, source.entry_id desc) filter (
          where source.visibility in ('group', 'status')
            and not source.owned_google
            and (source.metric_slug <> 'steps' or source.step_status_without_google_selected)
        ))[1]
        when 'max' then max(source.numeric_value) filter (
          where source.visibility in ('group', 'status')
            and not source.owned_google
            and (source.metric_slug <> 'steps' or source.step_status_without_google_selected)
        )
        when 'min' then min(source.numeric_value) filter (
          where source.visibility in ('group', 'status')
            and not source.owned_google
            and (source.metric_slug <> 'steps' or source.step_status_without_google_selected)
        )
        else sum(source.numeric_value) filter (
          where source.visibility in ('group', 'status')
            and not source.owned_google
            and (source.metric_slug <> 'steps' or source.step_status_without_google_selected)
        )
      end as status_without_google
    from pg_temp.habhub_google_health_projection_entries source
    group by
      source.group_id,
      source.metric_id,
      source.metric_slug,
      source.aggregation_method,
      source.local_date,
      source.personal_metric
  ), prepared as (
    select
      aggregated.*,
      case when aggregated.exact_value is not null then 'group' else 'status' end as projected_visibility,
      coalesce(aggregated.exact_value, aggregated.status_value) as projected_value,
      case
        when aggregated.exact_value is not null then aggregated.exact_without_google
        else aggregated.status_without_google
      end as projected_without_google
    from aggregated
    -- `owned_targets` also carries the just-removed final Google contribution.
    -- In that case the remaining manual/native aggregate is still a desired
    -- row, now with null Google provenance.
    where coalesce(aggregated.exact_value, aggregated.status_value) is not null
  ), with_goal as (
    select
      prepared.*,
      public.google_health_direct_goal_projection(
        prepared.personal_metric,
        prepared.projected_value,
        prepared.projected_visibility,
        prepared.local_date,
        coalesce(v_payload -> 'trackedGoalPeriods', '{}'::jsonb)
      ) as goal_projection
    from prepared
  )
  insert into pg_temp.habhub_google_health_projection_status (
    group_id,
    metric_id,
    local_date,
    goal_reached,
    score_contribution,
    goal_progress,
    goal_kind,
    goal_target,
    visibility,
    goal_eligible,
    exact_value,
    has_data,
    source_provider
  )
  select
    projected.group_id,
    projected.metric_id,
    projected.local_date,
    (projected.goal_projection ->> 'goalReached')::boolean,
    (projected.goal_projection ->> 'scoreContribution')::numeric,
    (projected.goal_projection ->> 'goalProgress')::numeric,
    projected.goal_projection ->> 'goalKind',
    case when jsonb_typeof(projected.goal_projection -> 'goalTarget') = 'number'
      then (projected.goal_projection ->> 'goalTarget')::numeric else null end,
    projected.projected_visibility,
    (projected.goal_projection ->> 'goalEligible')::boolean,
    case when projected.projected_visibility = 'group' then projected.exact_value else null end,
    true,
    case when projected.projected_value is distinct from projected.projected_without_google
      then 'google_health' else null end
  from with_goal projected;

  insert into pg_temp.habhub_google_health_projection_raw (
    group_id,
    metric_id,
    local_date,
    client_generated_id,
    value,
    recorded_at,
    visibility,
    source,
    label,
    note,
    nutrition,
    submetric_values,
    image_path,
    source_record_id,
    source_origin,
    source_updated_at
  )
  select distinct on (source.group_id, source.metric_id, source.entry_id)
    source.group_id,
    source.metric_id,
    source.local_date,
    coalesce(
      existing.client_generated_id,
      'google-health-group:' || source.group_id::text || ':' || md5(source.entry_id)
    ),
    source.entry -> 'value',
    source.recorded_at,
    'group'::public.entry_visibility,
    coalesce(nullif(source.entry ->> 'source', ''), 'imported'),
    nullif(source.entry ->> 'label', ''),
    nullif(source.entry ->> 'note', ''),
    case when jsonb_typeof(source.entry -> 'nutrition') = 'object'
      then source.entry -> 'nutrition' else null end,
    case when jsonb_typeof(source.entry -> 'submetricValues') = 'object'
      then source.entry -> 'submetricValues' else null end,
    nullif(source.entry ->> 'imageStoragePath', ''),
    coalesce(
      nullif(source.entry ->> 'sourceRecordId', ''),
      'google-health:' || source.entry_id
    ),
    nullif(source.entry ->> 'sourceOrigin', ''),
    public.google_health_projection_timestamp(
      source.entry ->> 'sourceUpdatedAt',
      source.revision_at
    )
  from pg_temp.habhub_google_health_projection_entries source
  left join lateral (
    select entry.client_generated_id
      from public.metric_entries entry
     where entry.user_id = p_user_id
       and entry.metric_id = source.metric_id
       and entry.source_provider = 'google_health'
       and entry.source_record_id = coalesce(
         nullif(source.entry ->> 'sourceRecordId', ''),
         'google-health:' || source.entry_id
       )
     order by
       (entry.client_generated_id not like 'google-health-group:%') desc,
       entry.updated_at desc
     limit 1
  ) existing on true
  where source.owned_google
    and source.visibility = 'group'
    and (
      source.entry ->> 'metricId' in ('food', 'workout')
      or source.personal_metric ->> 'category' = 'gym'
    )
    and (
      nullif(source.entry ->> 'label', '') is not null
      or nullif(source.entry ->> 'note', '') is not null
      or jsonb_typeof(source.entry -> 'nutrition') = 'object'
      or jsonb_typeof(source.entry -> 'submetricValues') = 'object'
    )
  order by source.group_id, source.metric_id, source.entry_id, source.revision_at desc;

  -- Record every relational difference before mutation. Repeated hourly syncs
  -- with unchanged provider data therefore do not bump group activity.
  insert into pg_temp.habhub_google_health_projection_changed (group_id, local_date)
  select distinct definition.group_id, existing.local_date
    from public.metric_entries existing
    join public.metric_definitions definition on definition.id = existing.metric_id
   where existing.user_id = p_user_id
     and existing.source_provider = 'google_health'
     and not exists (
       select 1
         from pg_temp.habhub_google_health_projection_raw desired
        where desired.metric_id = existing.metric_id
          and desired.client_generated_id = existing.client_generated_id
     )
  on conflict do nothing;

  insert into pg_temp.habhub_google_health_projection_changed (group_id, local_date)
  select distinct desired.group_id, desired.local_date
    from pg_temp.habhub_google_health_projection_raw desired
    left join public.metric_entries existing
      on existing.user_id = p_user_id
     and existing.client_generated_id = desired.client_generated_id
   where existing.id is null
      or (
        existing.metric_id,
        existing.value,
        existing.local_date,
        existing.recorded_at,
        existing.visibility,
        existing.source,
        existing.label,
        existing.note,
        existing.nutrition,
        existing.submetric_values,
        existing.image_path,
        existing.source_provider,
        existing.source_record_id,
        existing.source_origin,
        existing.source_updated_at,
        existing.account_revision
      ) is distinct from (
        desired.metric_id,
        desired.value,
        desired.local_date,
        desired.recorded_at,
        desired.visibility,
        desired.source,
        desired.label,
        desired.note,
        desired.nutrition,
        desired.submetric_values,
        desired.image_path,
        'google_health'::text,
        desired.source_record_id,
        desired.source_origin,
        desired.source_updated_at,
        v_revision
      )
  on conflict do nothing;

  insert into pg_temp.habhub_google_health_projection_changed (group_id, local_date)
  select distinct existing.group_id, existing.local_date
    from public.daily_metric_status existing
   where existing.user_id = p_user_id
     and existing.source_provider = 'google_health'
     and not exists (
       select 1
         from pg_temp.habhub_google_health_projection_status desired
        where desired.group_id = existing.group_id
          and desired.metric_id = existing.metric_id
          and desired.local_date = existing.local_date
     )
  on conflict do nothing;

  insert into pg_temp.habhub_google_health_projection_changed (group_id, local_date)
  select distinct desired.group_id, desired.local_date
    from pg_temp.habhub_google_health_projection_status desired
    left join public.daily_metric_status existing
      on existing.group_id = desired.group_id
     and existing.metric_id = desired.metric_id
     and existing.user_id = p_user_id
     and existing.local_date = desired.local_date
   where existing.group_id is null
      or (
        existing.goal_reached,
        existing.score_contribution,
        existing.goal_progress,
        existing.goal_kind,
        existing.goal_target,
        existing.visibility,
        existing.goal_eligible,
        existing.exact_value,
        existing.has_data,
        existing.privacy_projection_version,
        existing.source_provider,
        existing.account_revision
      ) is distinct from (
        desired.goal_reached,
        desired.score_contribution,
        desired.goal_progress,
        desired.goal_kind,
        desired.goal_target,
        desired.visibility,
        desired.goal_eligible,
        desired.exact_value,
        desired.has_data,
        2::smallint,
        desired.source_provider,
        v_revision
      )
  on conflict do nothing;

  -- A status downgrade needs a durable cache fence. If other dates remain
  -- exact-visible, advance the account revision once so their freshly
  -- projected rows are causally newer than that fence.
  insert into public.metric_privacy_cache_fences (
    group_id, metric_id, user_id, revision
  )
  select distinct
    existing.group_id,
    existing.metric_id,
    p_user_id,
    greatest(v_revision, 1)
  from public.daily_metric_status existing
  left join pg_temp.habhub_google_health_projection_status desired
    on desired.group_id = existing.group_id
   and desired.metric_id = existing.metric_id
   and desired.local_date = existing.local_date
  where existing.user_id = p_user_id
    and existing.visibility = 'group'
    and existing.exact_value is not null
    and coalesce(desired.visibility, 'private') <> 'group'
  on conflict (group_id, metric_id, user_id) do update
    set revision = excluded.revision
    where public.metric_privacy_cache_fences.revision < excluded.revision;

  if exists (
    select 1
      from pg_temp.habhub_google_health_projection_status desired
      join public.metric_privacy_cache_fences fence
        on fence.group_id = desired.group_id
       and fence.metric_id = desired.metric_id
       and fence.user_id = p_user_id
     where desired.visibility = 'group'
       and fence.revision >= v_revision
  ) then
    update public.user_snapshots snapshot
       set revision = snapshot.revision + 1,
           device_id = 'google-health-group-projection',
           updated_at = statement_timestamp()
     where snapshot.user_id = p_user_id
       and snapshot.revision = v_revision
     returning snapshot.revision into v_revision;
    if v_revision is null then
      raise exception 'google_health_projection_conflict' using errcode = '40001';
    end if;
    insert into pg_temp.habhub_google_health_projection_changed (group_id, local_date)
    select distinct desired.group_id, desired.local_date
      from pg_temp.habhub_google_health_projection_status desired
    on conflict do nothing;
  end if;

  insert into public.metric_entry_tombstones (
    group_id, user_id, client_generated_id, local_date, visibility, deleted_at
  )
  select
    definition.group_id,
    p_user_id,
    existing.client_generated_id,
    existing.local_date,
    existing.visibility,
    statement_timestamp()
  from public.metric_entries existing
  join public.metric_definitions definition on definition.id = existing.metric_id
  where existing.user_id = p_user_id
    and existing.source_provider = 'google_health'
    and not exists (
      select 1
        from pg_temp.habhub_google_health_projection_raw desired
       where desired.metric_id = existing.metric_id
         and desired.client_generated_id = existing.client_generated_id
    )
  on conflict (user_id, client_generated_id) do update
    set group_id = excluded.group_id,
        local_date = excluded.local_date,
        visibility = case
          when public.metric_entry_tombstones.visibility::text = 'group'
            or excluded.visibility::text = 'group'
          then 'group'::public.entry_visibility
          else excluded.visibility
        end,
        deleted_at = excluded.deleted_at;

  delete from public.metric_entries existing
   where existing.user_id = p_user_id
     and existing.source_provider = 'google_health'
     and not exists (
       select 1
         from pg_temp.habhub_google_health_projection_raw desired
        where desired.metric_id = existing.metric_id
          and desired.client_generated_id = existing.client_generated_id
     );
  get diagnostics v_count = row_count;
  v_removed := v_removed + v_count;

  insert into public.metric_entries (
    client_generated_id,
    metric_id,
    user_id,
    value,
    local_date,
    recorded_at,
    visibility,
    source,
    label,
    note,
    nutrition,
    submetric_values,
    image_path,
    source_provider,
    source_record_id,
    source_origin,
    source_updated_at,
    account_revision,
    updated_at
  )
  select
    desired.client_generated_id,
    desired.metric_id,
    p_user_id,
    desired.value,
    desired.local_date,
    desired.recorded_at,
    desired.visibility,
    desired.source,
    desired.label,
    desired.note,
    desired.nutrition,
    desired.submetric_values,
    desired.image_path,
    'google_health',
    desired.source_record_id,
    desired.source_origin,
    desired.source_updated_at,
    v_revision,
    statement_timestamp()
  from pg_temp.habhub_google_health_projection_raw desired
  on conflict (user_id, client_generated_id) do update
    set metric_id = excluded.metric_id,
        value = excluded.value,
        local_date = excluded.local_date,
        recorded_at = excluded.recorded_at,
        visibility = excluded.visibility,
        source = excluded.source,
        label = excluded.label,
        note = excluded.note,
        nutrition = excluded.nutrition,
        submetric_values = excluded.submetric_values,
        image_path = excluded.image_path,
        source_provider = excluded.source_provider,
        source_record_id = excluded.source_record_id,
        source_origin = excluded.source_origin,
        source_updated_at = excluded.source_updated_at,
        account_revision = excluded.account_revision,
        updated_at = excluded.updated_at
    where (
      public.metric_entries.metric_id,
      public.metric_entries.value,
      public.metric_entries.local_date,
      public.metric_entries.recorded_at,
      public.metric_entries.visibility,
      public.metric_entries.source,
      public.metric_entries.label,
      public.metric_entries.note,
      public.metric_entries.nutrition,
      public.metric_entries.submetric_values,
      public.metric_entries.image_path,
      public.metric_entries.source_provider,
      public.metric_entries.source_record_id,
      public.metric_entries.source_origin,
      public.metric_entries.source_updated_at,
      public.metric_entries.account_revision
    ) is distinct from (
      excluded.metric_id,
      excluded.value,
      excluded.local_date,
      excluded.recorded_at,
      excluded.visibility,
      excluded.source,
      excluded.label,
      excluded.note,
      excluded.nutrition,
      excluded.submetric_values,
      excluded.image_path,
      excluded.source_provider,
      excluded.source_record_id,
      excluded.source_origin,
      excluded.source_updated_at,
      excluded.account_revision
    );
  get diagnostics v_entry_changes = row_count;

  delete from public.metric_entry_tombstones tombstone
   where tombstone.user_id = p_user_id
     and exists (
       select 1
         from pg_temp.habhub_google_health_projection_raw desired
        where desired.client_generated_id = tombstone.client_generated_id
     );

  delete from public.daily_metric_status existing
   where existing.user_id = p_user_id
     and existing.source_provider = 'google_health'
     and not exists (
       select 1
         from pg_temp.habhub_google_health_projection_status desired
        where desired.group_id = existing.group_id
          and desired.metric_id = existing.metric_id
          and desired.local_date = existing.local_date
     );
  get diagnostics v_count = row_count;
  v_removed := v_removed + v_count;

  insert into public.daily_metric_status (
    group_id,
    metric_id,
    user_id,
    local_date,
    goal_reached,
    score_contribution,
    goal_progress,
    goal_kind,
    goal_target,
    visibility,
    goal_eligible,
    exact_value,
    has_data,
    privacy_projection_version,
    source_provider,
    account_revision,
    updated_at
  )
  select
    desired.group_id,
    desired.metric_id,
    p_user_id,
    desired.local_date,
    desired.goal_reached,
    desired.score_contribution,
    desired.goal_progress,
    desired.goal_kind,
    desired.goal_target,
    desired.visibility,
    desired.goal_eligible,
    desired.exact_value,
    desired.has_data,
    2,
    desired.source_provider,
    v_revision,
    statement_timestamp()
  from pg_temp.habhub_google_health_projection_status desired
  on conflict (group_id, metric_id, user_id, local_date) do update
    set goal_reached = excluded.goal_reached,
        score_contribution = excluded.score_contribution,
        goal_progress = excluded.goal_progress,
        goal_kind = excluded.goal_kind,
        goal_target = excluded.goal_target,
        visibility = excluded.visibility,
        goal_eligible = excluded.goal_eligible,
        exact_value = excluded.exact_value,
        has_data = excluded.has_data,
        privacy_projection_version = excluded.privacy_projection_version,
        source_provider = excluded.source_provider,
        account_revision = excluded.account_revision,
        updated_at = excluded.updated_at
    where (
      public.daily_metric_status.goal_reached,
      public.daily_metric_status.score_contribution,
      public.daily_metric_status.goal_progress,
      public.daily_metric_status.goal_kind,
      public.daily_metric_status.goal_target,
      public.daily_metric_status.visibility,
      public.daily_metric_status.goal_eligible,
      public.daily_metric_status.exact_value,
      public.daily_metric_status.has_data,
      public.daily_metric_status.privacy_projection_version,
      public.daily_metric_status.source_provider,
      public.daily_metric_status.account_revision
    ) is distinct from (
      excluded.goal_reached,
      excluded.score_contribution,
      excluded.goal_progress,
      excluded.goal_kind,
      excluded.goal_target,
      excluded.visibility,
      excluded.goal_eligible,
      excluded.exact_value,
      excluded.has_data,
      excluded.privacy_projection_version,
      excluded.source_provider,
      excluded.account_revision
    );
  get diagnostics v_status_changes = row_count;

  for v_group in
    select changed.group_id, min(changed.local_date) as since_date
      from pg_temp.habhub_google_health_projection_changed changed
     group by changed.group_id
  loop
    insert into public.group_activity_versions (
      group_id, version, since_date, updated_at
    ) values (
      v_group.group_id,
      1,
      greatest(v_group.since_date, current_date - 120),
      statement_timestamp()
    )
    on conflict (group_id) do update
      set version = public.group_activity_versions.version + 1,
          since_date = least(
            public.group_activity_versions.since_date,
            excluded.since_date
          ),
          updated_at = excluded.updated_at;
    v_bumped := v_bumped + 1;
  end loop;

  return query select
    v_revision,
    v_entry_changes,
    v_status_changes,
    v_removed,
    v_bumped;
end;
$$;

revoke all on function public.project_google_health_group_data(uuid, bigint)
  from public, anon, authenticated;
grant execute on function public.project_google_health_group_data(uuid, bigint)
  to service_role;

comment on function public.project_google_health_group_data(uuid, bigint) is
  'Service-role-only direct Google Health group projection with v2 privacy, causal revisions, detail-row containment, and activity-version invalidation.';
