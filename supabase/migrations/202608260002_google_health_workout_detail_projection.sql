-- Preserve item-level Google Health workout detail for authorized group peers.
-- Food and Workout already projected their named rows. Active energy, duration,
-- and distance now use their own destination-scoped detail rows; linked values
-- are never embedded under the Workout parent's visibility. Passive step
-- estimates and raw sensor totals remain compact.

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
    nullif(
      (
        case when jsonb_typeof(source.entry -> 'submetricValues') = 'object'
          then case when source.entry ->> 'metricId' = 'workout'
            then (source.entry -> 'submetricValues')
              - 'exercise' - 'workout_duration' - 'workout_distance'
            else source.entry -> 'submetricValues'
          end
          else '{}'::jsonb
        end
      ),
      '{}'::jsonb
    ),
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
      source.entry ->> 'metricId' in (
        'food',
        'workout',
        'exercise',
        'workout_duration',
        'workout_distance'
      )
      or source.personal_metric ->> 'category' = 'gym'
    )
    and (
      nullif(source.entry ->> 'label', '') is not null
      or nullif(source.entry ->> 'note', '') is not null
      or jsonb_typeof(source.entry -> 'nutrition') = 'object'
      or jsonb_typeof(source.entry -> 'submetricValues') = 'object'
    )
    and (
      source.entry ->> 'metricId' <> 'exercise'
      or nullif(source.entry ->> 'label', '') is not null
    )
    and source.entry ->> 'label' is distinct from
      'Estimated unrecorded walking from steps'
    and coalesce(source.entry ->> 'sourceRecordId', '') !~
      '(^|:)step-fallback:'
  order by source.group_id, source.metric_id, source.entry_id, source.revision_at desc;

  -- A per-workout calorie is explanatory detail, not another additive Active
  -- energy contribution. Materialize it only in the destination group's
  -- explicitly configured, group-visible Active energy tracker. The private
  -- account snapshot carries the value; the shared Workout parent never does.
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
  select distinct on (membership.group_id, detail_definition.id, owned.entry_id)
    membership.group_id,
    detail_definition.id,
    public.google_health_projection_date(
      workout.entry ->> 'localDate',
      owned.local_date
    ),
    coalesce(
      existing.client_generated_id,
      'google-health-group-detail:' || membership.group_id::text || ':' ||
        md5((workout.entry ->> 'id') || ':exercise')
    ),
    workout.entry #> '{submetricValues,exercise}',
    public.google_health_projection_timestamp(
      workout.entry ->> 'recordedAt',
      owned.local_date::timestamptz
    ),
    'group'::public.entry_visibility,
    'imported',
    case
      when workout.entry ->> 'visibility' = 'group'
        then coalesce(nullif(workout.entry ->> 'label', ''), 'Workout energy')
      else 'Workout energy'
    end,
    case when workout.entry ->> 'visibility' = 'group'
      then nullif(workout.entry ->> 'note', '') else null end,
    null,
    null,
    null,
    workout.entry ->> 'sourceRecordId',
    case when workout.entry ->> 'visibility' = 'group'
      then nullif(workout.entry ->> 'sourceOrigin', '') else null end,
    public.google_health_projection_timestamp(
      workout.entry ->> 'sourceUpdatedAt',
      statement_timestamp()
    )
    from jsonb_array_elements(v_payload -> 'entries') workout(entry)
    join public.google_health_import_records owned
      on owned.user_id = p_user_id
     and owned.entry_id = workout.entry ->> 'id'
    join public.group_members membership
      on membership.user_id = p_user_id
     and membership.status = 'active'
    join public.metric_definitions detail_definition
      on detail_definition.group_id = membership.group_id
     and detail_definition.slug = 'exercise'
     and detail_definition.archived_at is null
    join lateral (
      select metric
        from jsonb_array_elements(v_payload -> 'metrics') metric
       where metric ->> 'id' = 'exercise'
       limit 1
    ) personal_detail on true
    left join public.google_health_entry_preferences preference
      on preference.user_id = p_user_id
     and preference.entry_id = left(
       regexp_replace(
         (workout.entry ->> 'sourceRecordId') || ':exercise',
         '[^A-Za-z0-9:._-]+',
         '-',
         'g'
       ),
       360
     )
    left join lateral (
      select entry.client_generated_id
        from public.metric_entries entry
       where entry.user_id = p_user_id
         and entry.metric_id = detail_definition.id
         and entry.source_provider = 'google_health'
         and entry.source_record_id = workout.entry ->> 'sourceRecordId'
       order by
         (entry.client_generated_id not like 'google-health-group%') desc,
         entry.updated_at desc
       limit 1
    ) existing on true
   where workout.entry ->> 'metricId' = 'workout'
     and workout.entry ->> 'sourceProvider' = 'google_health'
     and nullif(workout.entry ->> 'sourceRecordId', '') is not null
     and jsonb_typeof(workout.entry #> '{submetricValues,exercise}') = 'number'
     and (workout.entry #>> '{submetricValues,exercise}')::numeric > 0
     and coalesce(
       case when preference.dismissed then 'private' else preference.visibility end,
       personal_detail.metric ->> 'defaultVisibility'
     ) = 'group'
     and not exists (
       select 1
         from pg_temp.habhub_google_health_projection_raw desired
        where desired.group_id = membership.group_id
          and desired.metric_id = detail_definition.id
          and desired.source_record_id = workout.entry ->> 'sourceRecordId'
     )
   order by
     membership.group_id,
     detail_definition.id,
     owned.entry_id,
     public.google_health_projection_timestamp(
       workout.entry ->> 'sourceUpdatedAt',
       statement_timestamp()
     ) desc;

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
  'Service-role-only direct Google Health group projection with v2 privacy, causal revisions, destination-scoped workout detail rows, passive-estimate containment, and activity-version invalidation.';

-- Linked tracker values must never inherit the shared Workout parent's RLS
-- policy. Enforce this below every client and projector so an older or
-- malicious client cannot publish a private Active energy, Duration, or
-- Distance value inside a group-visible Workout row.
create or replace function public.sanitize_group_workout_entry_details()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_group_id uuid;
  v_slug text;
begin
  if jsonb_typeof(new.submetric_values) <> 'object' then
    return new;
  end if;
  select definition.group_id, definition.slug
    into v_group_id, v_slug
    from public.metric_definitions definition
   where definition.id = new.metric_id;
  if v_group_id is not null and v_slug = 'workout' then
    new.submetric_values := nullif(
      new.submetric_values - 'exercise' - 'workout_duration' - 'workout_distance',
      '{}'::jsonb
    );
  end if;
  return new;
end;
$$;

revoke all on function public.sanitize_group_workout_entry_details()
  from public, anon, authenticated;

drop trigger if exists sanitize_group_workout_entry_details
  on public.metric_entries;
create trigger sanitize_group_workout_entry_details
before insert or update on public.metric_entries
for each row execute function public.sanitize_group_workout_entry_details();

with sanitized as (
  update public.metric_entries entry
     set submetric_values = nullif(
       entry.submetric_values - 'exercise' - 'workout_duration' - 'workout_distance',
       '{}'::jsonb
     ),
         updated_at = statement_timestamp()
    from public.metric_definitions definition
   where definition.id = entry.metric_id
     and definition.group_id is not null
     and definition.slug = 'workout'
     and jsonb_typeof(entry.submetric_values) = 'object'
     and entry.submetric_values ?| array[
       'exercise',
       'workout_duration',
       'workout_distance'
     ]
  returning definition.group_id, entry.local_date
)
insert into public.group_activity_versions (
  group_id,
  version,
  since_date,
  updated_at
)
select
  sanitized.group_id,
  1,
  greatest(min(sanitized.local_date), current_date - 120),
  statement_timestamp()
  from sanitized
 group by sanitized.group_id
on conflict (group_id) do update
  set version = public.group_activity_versions.version + 1,
      since_date = least(
        public.group_activity_versions.since_date,
        excluded.since_date
      ),
      updated_at = excluded.updated_at;

-- Keep privacy mutations and their relational projection in one transaction.
-- If projection fails, the visibility/dismissal mutation rolls back instead of
-- leaving an already-private detail readable through an older shared parent.
create or replace function public.mutate_google_health_food_family_and_project(
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
  v_result jsonb;
  v_revision bigint;
begin
  v_result := public.mutate_google_health_food_family(
    p_user_id,
    p_entry_id,
    p_action,
    p_patch
  );
  select projection.revision
    into v_revision
    from public.project_google_health_group_data(
      p_user_id,
      (v_result ->> 'revision')::bigint
    ) projection;
  return jsonb_set(v_result, '{revision}', to_jsonb(v_revision), true);
end;
$$;

revoke all on function public.mutate_google_health_food_family_and_project(
  uuid,
  text,
  text,
  jsonb
) from public, anon, authenticated;
grant execute on function public.mutate_google_health_food_family_and_project(
  uuid,
  text,
  text,
  jsonb
) to service_role;

create or replace function public.update_google_health_metric_visibility_and_project(
  p_user_id uuid,
  p_metric_id text,
  p_visibility text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_result jsonb;
  v_revision bigint;
begin
  v_result := public.update_google_health_metric_visibility(
    p_user_id,
    p_metric_id,
    p_visibility
  );
  select projection.revision
    into v_revision
    from public.project_google_health_group_data(
      p_user_id,
      (v_result ->> 'revision')::bigint
    ) projection;
  return jsonb_set(v_result, '{revision}', to_jsonb(v_revision), true);
end;
$$;

revoke all on function public.update_google_health_metric_visibility_and_project(
  uuid,
  text,
  text
) from public, anon, authenticated;
grant execute on function public.update_google_health_metric_visibility_and_project(
  uuid,
  text,
  text
) to service_role;

-- Existing connected accounts need one ordinary sync through the revised
-- projector so historical workout details self-heal. Mark them due for the
-- existing one-account-per-worker catch-up queue; do not project or fan out
-- every account inside this migration.
update public.google_health_connections connection
   set next_catchup_at = least(
     connection.next_catchup_at,
     statement_timestamp()
   )
 where connection.status = 'connected'
   and connection.refresh_token_ciphertext is not null
   and connection.health_user_id is not null;
