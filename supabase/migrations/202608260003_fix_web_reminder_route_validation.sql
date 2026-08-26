-- PostgreSQL rejects counted regular-expression repetitions above its supported
-- bound. Validate reminder routes with ordinary string predicates so schedule
-- replacement cannot fail with SQLSTATE 2201B.
create or replace function public.replace_own_web_notification_schedule(
  p_expected_user_id uuid,
  p_events jsonb default '[]'::jsonb
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_event jsonb;
  v_keys text[] := array[]::text[];
  v_key text;
  v_category text;
  v_scheduled_for timestamptz;
  v_title text;
  v_body text;
  v_data jsonb;
  v_route text;
  v_count integer := 0;
begin
  if v_user_id is null or v_user_id <> p_expected_user_id then
    raise exception 'Authenticated account changed during reminder scheduling.'
      using errcode = '42501';
  end if;
  if jsonb_typeof(coalesce(p_events, '[]'::jsonb)) <> 'array'
     or jsonb_array_length(coalesce(p_events, '[]'::jsonb)) > 68
     or pg_catalog.pg_column_size(coalesce(p_events, '[]'::jsonb)) > 262144 then
    raise exception 'The Web reminder schedule is invalid or too large.'
      using errcode = '22023';
  end if;

  for v_event in
    select item.value from jsonb_array_elements(coalesce(p_events, '[]'::jsonb)) item
  loop
    if jsonb_typeof(v_event) <> 'object' then
      raise exception 'Every Web reminder must be an object.' using errcode = '22023';
    end if;
    v_key := nullif(v_event ->> 'scheduleKey', '');
    v_category := nullif(v_event ->> 'category', '');
    v_title := nullif(btrim(v_event ->> 'title'), '');
    v_body := coalesce(v_event ->> 'body', '');
    v_data := coalesce(v_event -> 'data', '{}'::jsonb);
    v_route := coalesce(v_data ->> 'route', '');
    begin
      v_scheduled_for := (v_event ->> 'scheduledAt')::timestamptz;
    exception when others then
      raise exception 'A Web reminder has an invalid scheduled time.'
        using errcode = '22023';
    end;
    if v_key is null or char_length(v_key) not between 5 and 500
       or v_key = any(v_keys)
       or v_category not in ('tracker', 'todo', 'calendar', 'cycle', 'gym', 'timer', 'fasting')
       or v_scheduled_for < clock_timestamp() - interval '5 minutes'
       or v_scheduled_for > clock_timestamp() + interval '370 days'
       or v_title is null or char_length(v_title) > 120
       or char_length(v_body) > 500
       or jsonb_typeof(v_data) <> 'object'
       or pg_catalog.pg_column_size(v_data) > 8192
       or char_length(v_route) not between 1 and 1001
       or pg_catalog.left(v_route, 1) <> '/'
       or v_route ~ '[[:space:]]' then
      raise exception 'A Web reminder contains invalid fields.' using errcode = '22023';
    end if;
    v_keys := array_append(v_keys, v_key);
    insert into public.web_personal_notification_schedule as existing (
      user_id, schedule_key, category, scheduled_for, expires_at,
      title, body, data, next_attempt_at, updated_at
    ) values (
      v_user_id, v_key, v_category, v_scheduled_for,
      v_scheduled_for + interval '24 hours', v_title, v_body, v_data,
      v_scheduled_for, clock_timestamp()
    )
    on conflict (user_id, schedule_key) do update
       set category = excluded.category,
           scheduled_for = excluded.scheduled_for,
           expires_at = excluded.expires_at,
           title = excluded.title,
           body = excluded.body,
           data = excluded.data,
           next_attempt_at = case
             when existing.dispatched_at is null then excluded.scheduled_for
             else existing.next_attempt_at
           end,
           lease_owner = case when existing.dispatched_at is null then null else existing.lease_owner end,
           lease_until = case when existing.dispatched_at is null then null else existing.lease_until end,
           updated_at = clock_timestamp();
    v_count := v_count + 1;
  end loop;

  delete from public.web_personal_notification_schedule scheduled
   where scheduled.user_id = v_user_id
     and scheduled.dispatched_at is null
     and not (scheduled.schedule_key = any(v_keys));
  delete from public.web_personal_notification_schedule scheduled
   where scheduled.user_id = v_user_id
     and scheduled.dispatched_at < clock_timestamp() - interval '7 days';
  return v_count;
end;
$$;

revoke all on function public.replace_own_web_notification_schedule(uuid, jsonb)
  from public, anon;
grant execute on function public.replace_own_web_notification_schedule(uuid, jsonb)
  to authenticated;
