-- Empty daily snapshots used to look like status-only measurements, causing
-- leaderboards to display "goal days" instead of exact shared values.
alter table public.daily_metric_status
  add column if not exists has_data boolean not null default false;

comment on column public.daily_metric_status.has_data is
  'True only when this daily snapshot represents a real measurement or calculated result.';

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

  if shared_entry_exists then
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
  end if;

  new.has_data :=
    new.exact_value is not null or shared_entry_exists or status_entry_exists;
  return new;
end;
$$;

drop trigger if exists daily_metric_status_fill_shared_value
  on public.daily_metric_status;
create trigger daily_metric_status_fill_shared_value
before insert or update on public.daily_metric_status
for each row execute function public.fill_daily_metric_shared_value();

-- Repair existing group-visible history immediately. Status-only/private rows
-- remain without an exact value.
with shared_values as (
  select
    entry.metric_id,
    entry.user_id,
    entry.local_date,
    case definition.aggregation_method
      when 'average' then avg(
        case jsonb_typeof(entry.value)
          when 'number' then (entry.value #>> '{}')::numeric
          when 'boolean' then case when (entry.value #>> '{}')::boolean then 1 else 0 end
          else null
        end
      )
      when 'latest' then (
        array_agg(
          case jsonb_typeof(entry.value)
            when 'number' then (entry.value #>> '{}')::numeric
            when 'boolean' then case when (entry.value #>> '{}')::boolean then 1 else 0 end
            else null
          end
          order by entry.recorded_at desc
        )
      )[1]
      when 'max' then max(
        case jsonb_typeof(entry.value)
          when 'number' then (entry.value #>> '{}')::numeric
          when 'boolean' then case when (entry.value #>> '{}')::boolean then 1 else 0 end
          else null
        end
      )
      when 'min' then min(
        case jsonb_typeof(entry.value)
          when 'number' then (entry.value #>> '{}')::numeric
          when 'boolean' then case when (entry.value #>> '{}')::boolean then 1 else 0 end
          else null
        end
      )
      else sum(
        case jsonb_typeof(entry.value)
          when 'number' then (entry.value #>> '{}')::numeric
          when 'boolean' then case when (entry.value #>> '{}')::boolean then 1 else 0 end
          else null
        end
      )
    end as exact_value
  from public.metric_entries entry
  join public.metric_definitions definition on definition.id = entry.metric_id
  where entry.visibility = 'group'
  group by
    entry.metric_id,
    entry.user_id,
    entry.local_date,
    definition.aggregation_method
)
update public.daily_metric_status status
set
  exact_value = shared_values.exact_value,
  has_data = true
from shared_values
where status.metric_id = shared_values.metric_id
  and status.user_id = shared_values.user_id
  and status.local_date = shared_values.local_date;

update public.daily_metric_status status
set has_data = true
where status.exact_value is not null
   or exists (
     select 1
     from public.metric_entries entry
     where entry.metric_id = status.metric_id
       and entry.user_id = status.user_id
       and entry.local_date = status.local_date
       and entry.visibility in ('group', 'status')
   );
