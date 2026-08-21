-- Daily status rows are directly readable by active group members. Enforce
-- disclosure at the database boundary so an older client cannot publish an
-- aggregate that includes status-only/private inputs or an invertible status
-- percentage/target pair.

alter table public.daily_metric_status
  add column if not exists privacy_projection_version smallint
    not null default 1
    check (privacy_projection_version between 1 and 2);

comment on column public.daily_metric_status.privacy_projection_version is
  'Version 2 proves the client derived compact exact values from exact-visible sources only.';

-- A migration has no authenticated account identity, so the normal per-user
-- revision fence cannot authorize this one-time invariant repair.
alter table public.daily_metric_status
  disable trigger daily_metric_status_enforce_account_revision;

update public.daily_metric_status
set
  -- Existing values were produced before projection v2 and cannot prove that
  -- private/status contributions were excluded. Clear them fail-closed; an
  -- updated client will republish a verified v2 value from group-only inputs.
  exact_value = null,
  goal_target = case
    when coalesce(visibility::text, 'status') = 'status' then null
    else goal_target
  end,
  score_contribution = case
    when coalesce(visibility::text, 'status') = 'status'
      then floor(greatest(0, least(100, score_contribution)) / 25) * 25
    else score_contribution
  end,
  goal_progress = case
    when coalesce(visibility::text, 'status') = 'status' and goal_progress is not null
      then floor(greatest(0, least(300, goal_progress)) / 25) * 25
    else goal_progress
  end
where
  exact_value is not null
  or (coalesce(visibility::text, 'status') = 'status' and goal_target is not null)
  or (
    coalesce(visibility::text, 'status') = 'status'
    and score_contribution <> floor(greatest(0, least(100, score_contribution)) / 25) * 25
  )
  or (
    coalesce(visibility::text, 'status') = 'status'
    and goal_progress is not null
    and goal_progress <> floor(greatest(0, least(300, goal_progress)) / 25) * 25
  );

alter table public.daily_metric_status
  enable trigger daily_metric_status_enforce_account_revision;

create or replace function public.fill_daily_metric_shared_value()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  shared_value numeric;
  shared_entry_exists boolean;
  status_entry_exists boolean;
begin
  select exists (
    select 1
    from public.metric_entries entry
    where entry.metric_id = new.metric_id
      and entry.user_id = new.user_id
      and entry.local_date = new.local_date
      and entry.visibility = 'group'
  ) into shared_entry_exists;

  select exists (
    select 1
    from public.metric_entries entry
    where entry.metric_id = new.metric_id
      and entry.user_id = new.user_id
      and entry.local_date = new.local_date
      and entry.visibility = 'status'
  ) into status_entry_exists;

  if coalesce(new.visibility::text, 'status') <> 'group' then
    new.exact_value := null;
  elsif shared_entry_exists then
    select case definition.aggregation_method
      when 'average' then avg(values.numeric_value)
      when 'latest' then
        (array_agg(values.numeric_value order by values.recorded_at desc))[1]
      when 'max' then max(values.numeric_value)
      when 'min' then min(values.numeric_value)
      else sum(values.numeric_value)
    end
    into shared_value
    from public.metric_definitions definition
    join (
      select
        entry.metric_id,
        entry.recorded_at,
        case jsonb_typeof(entry.value)
          when 'number' then (entry.value #>> '{}')::numeric
          when 'boolean' then
            case when (entry.value #>> '{}')::boolean then 1 else 0 end
          else null
        end as numeric_value
      from public.metric_entries entry
      where entry.metric_id = new.metric_id
        and entry.user_id = new.user_id
        and entry.local_date = new.local_date
        and entry.visibility = 'group'
    ) values on values.metric_id = definition.id
    where definition.id = new.metric_id
    group by definition.aggregation_method;

    new.exact_value := shared_value;
  elsif coalesce(new.privacy_projection_version, 1) < 2 then
    -- Calculated/fallback values may depend on profile data or differently
    -- visible trackers. Reject unverified compact values from older clients.
    new.exact_value := null;
  end if;

  if coalesce(new.visibility::text, 'status') = 'status' then
    new.goal_target := null;
    new.score_contribution :=
      floor(greatest(0, least(100, new.score_contribution)) / 25) * 25;
    if new.goal_progress is not null then
      new.goal_progress :=
        floor(greatest(0, least(300, new.goal_progress)) / 25) * 25;
    end if;
  end if;

  new.has_data :=
    coalesce(new.has_data, false)
    or new.exact_value is not null
    or shared_entry_exists
    or status_entry_exists;
  return new;
end;
$$;

revoke all on function public.fill_daily_metric_shared_value() from public;
revoke all on function public.fill_daily_metric_shared_value() from anon;
revoke all on function public.fill_daily_metric_shared_value() from authenticated;

comment on function public.fill_daily_metric_shared_value() is
  'Enforces visibility-safe daily group projections and derives exact values only from exact-visible source rows.';
