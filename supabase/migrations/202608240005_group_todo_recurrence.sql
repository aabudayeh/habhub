-- Shared cadence belongs to the group task. Reminder times intentionally do
-- not: those stay in each member's private account snapshot.
create or replace function public.valid_group_todo_recurrence(value jsonb)
returns boolean
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_mode text;
  v_item jsonb;
  v_anchor_date date;
  v_end_date date;
begin
  if value is null then return true; end if;
  if jsonb_typeof(value) <> 'object' or pg_catalog.octet_length(value::text) > 1024 then
    return false;
  end if;
  if value - array[
    'mode', 'daysOfWeek', 'minimumCompletions', 'intervalDays',
    'daysOfMonth', 'anchorDate', 'endDate'
  ]::text[] <> '{}'::jsonb then
    return false;
  end if;
  v_mode := value ->> 'mode';
  if v_mode not in (
    'once', 'daily', 'selected_days', 'every_other_day', 'interval_days',
    'days_of_month', 'weekly_min', 'monthly_min'
  ) then return false; end if;
  if value ? 'anchorDate' and coalesce(value ->> 'anchorDate', '') !~ '^\d{4}-\d{2}-\d{2}$' then
    return false;
  end if;
  if value ? 'endDate' and coalesce(value ->> 'endDate', '') !~ '^\d{4}-\d{2}-\d{2}$' then
    return false;
  end if;
  if value ? 'anchorDate' then
    v_anchor_date := (value ->> 'anchorDate')::date;
    if pg_catalog.to_char(v_anchor_date, 'YYYY-MM-DD') <> (value ->> 'anchorDate') then
      return false;
    end if;
  end if;
  if value ? 'endDate' then
    v_end_date := (value ->> 'endDate')::date;
    if pg_catalog.to_char(v_end_date, 'YYYY-MM-DD') <> (value ->> 'endDate') then
      return false;
    end if;
  end if;
  if value ? 'endDate' and value ? 'anchorDate'
     and v_end_date < v_anchor_date then
    return false;
  end if;
  if value ? 'intervalDays' and (
    jsonb_typeof(value -> 'intervalDays') <> 'number'
    or (value ->> 'intervalDays')::numeric <> pg_catalog.trunc((value ->> 'intervalDays')::numeric)
    or (value ->> 'intervalDays')::numeric not between 1 and 366
  ) then return false; end if;
  if v_mode = 'interval_days' and not (value ? 'intervalDays') then return false; end if;
  if value ? 'minimumCompletions' and (
    jsonb_typeof(value -> 'minimumCompletions') <> 'number'
    or (value ->> 'minimumCompletions')::numeric <> pg_catalog.trunc((value ->> 'minimumCompletions')::numeric)
    or (value ->> 'minimumCompletions')::numeric not between 1 and 366
  ) then return false; end if;
  if v_mode in ('weekly_min', 'monthly_min') and not (value ? 'minimumCompletions') then
    return false;
  end if;
  if value ? 'daysOfWeek' then
    if jsonb_typeof(value -> 'daysOfWeek') <> 'array'
       or jsonb_array_length(value -> 'daysOfWeek') not between 1 and 7 then
      return false;
    end if;
    for v_item in
      select element from jsonb_array_elements(value -> 'daysOfWeek') as requested(element)
    loop
      if jsonb_typeof(v_item) <> 'number'
         or v_item::text::numeric <> pg_catalog.trunc(v_item::text::numeric)
         or v_item::text::numeric not between 0 and 6 then
        return false;
      end if;
    end loop;
  end if;
  if v_mode = 'selected_days' and not (value ? 'daysOfWeek') then return false; end if;
  if value ? 'daysOfMonth' then
    if jsonb_typeof(value -> 'daysOfMonth') <> 'array'
       or jsonb_array_length(value -> 'daysOfMonth') not between 1 and 31 then
      return false;
    end if;
    for v_item in
      select element from jsonb_array_elements(value -> 'daysOfMonth') as requested(element)
    loop
      if jsonb_typeof(v_item) <> 'number'
         or v_item::text::numeric <> pg_catalog.trunc(v_item::text::numeric)
         or v_item::text::numeric not between 1 and 31 then
        return false;
      end if;
    end loop;
  end if;
  if v_mode = 'days_of_month' and not (value ? 'daysOfMonth') then return false; end if;
  return true;
exception when invalid_text_representation
            or numeric_value_out_of_range
            or invalid_datetime_format
            or datetime_field_overflow then
  return false;
end;
$$;

revoke all on function public.valid_group_todo_recurrence(jsonb)
  from public, anon, authenticated;

alter table public.group_todos
  add column if not exists recurrence jsonb;

alter table public.group_todos
  drop constraint if exists group_todos_recurrence_shape;
alter table public.group_todos
  add constraint group_todos_recurrence_shape
  check (public.valid_group_todo_recurrence(recurrence));

-- Keep the original RPC intact for installed clients. It deliberately leaves
-- recurrence unchanged on edits, so an older APK cannot erase a newer cadence.
create or replace function public.save_group_todo_v2(
  p_todo_id uuid,
  p_group_id uuid,
  p_parent_id uuid,
  p_title text,
  p_description text,
  p_labels text[],
  p_priority text,
  p_due_at timestamptz,
  p_recurrence jsonb,
  p_completion_mode text
)
returns public.group_todos
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_saved public.group_todos;
begin
  if not public.valid_group_todo_recurrence(p_recurrence) then
    raise exception 'Invalid group to-do recurrence.' using errcode = '22023';
  end if;
  v_saved := public.save_group_todo(
    p_todo_id,
    p_group_id,
    p_parent_id,
    p_title,
    p_description,
    p_labels,
    p_priority,
    p_due_at,
    p_completion_mode
  );
  update public.group_todos
     set recurrence = p_recurrence,
         updated_at = now()
   where id = v_saved.id and group_id = p_group_id
   returning * into v_saved;
  return v_saved;
end;
$$;

revoke all on function public.save_group_todo_v2(
  uuid, uuid, uuid, text, text, text[], text, timestamptz, jsonb, text
) from public, anon, authenticated;
grant execute on function public.save_group_todo_v2(
  uuid, uuid, uuid, text, text, text[], text, timestamptz, jsonb, text
) to authenticated;
