-- Projection v2 may contain an authoritative local aggregate (for example a
-- Health Connect daily Steps COUNT_TOTAL) whose raw sensor rows are purposely
-- not copied into the shared activity log. Preserve that explicitly shared
-- compact value. Legacy clients remain server-derived from group-visible raw
-- rows and therefore cannot use this path.

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
  elsif coalesce(new.privacy_projection_version, 1) >= 2 then
    -- The v2 client has already aggregated exact-visible sources only. This
    -- also avoids a stale web fallback row overriding a phone Health total.
    new.exact_value := new.exact_value;
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
  else
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
  'Enforces visibility-safe daily projections; v2 compact exact values come from client-verified exact-visible sources.';
