-- Durable personal reminder queue for standards-based Web Push. Native builds
-- retain their on-device alarms; installed PWAs mirror the same schedules here
-- because browsers suspend page JavaScript in the background.
create table if not exists public.web_personal_notification_schedule (
  user_id uuid not null references public.profiles(id) on delete cascade,
  schedule_key text not null
    check (char_length(schedule_key) between 5 and 500),
  category text not null
    check (category in ('tracker', 'todo', 'calendar', 'cycle', 'gym', 'timer', 'fasting')),
  scheduled_for timestamptz not null,
  expires_at timestamptz not null,
  title text not null check (char_length(title) between 1 and 120),
  body text not null check (char_length(body) <= 500),
  data jsonb not null default '{}'::jsonb
    check (
      jsonb_typeof(data) = 'object'
      and pg_catalog.pg_column_size(data) <= 8192
    ),
  attempt_count integer not null default 0 check (attempt_count between 0 and 1000),
  next_attempt_at timestamptz not null,
  lease_owner uuid,
  lease_until timestamptz,
  dispatched_at timestamptz,
  last_error text,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  primary key (user_id, schedule_key),
  check (expires_at > scheduled_for)
);

create index if not exists web_personal_notification_due_idx
  on public.web_personal_notification_schedule (next_attempt_at, scheduled_for)
  where dispatched_at is null;

create table if not exists public.web_personal_notification_acceptances (
  user_id uuid not null,
  schedule_key text not null,
  endpoint text not null references public.web_push_subscriptions(endpoint)
    on delete cascade,
  accepted_at timestamptz not null default clock_timestamp(),
  primary key (user_id, schedule_key, endpoint),
  foreign key (user_id, schedule_key)
    references public.web_personal_notification_schedule(user_id, schedule_key)
    on delete cascade
);

alter table public.web_personal_notification_schedule enable row level security;
alter table public.web_personal_notification_acceptances enable row level security;
revoke all on table public.web_personal_notification_schedule
  from public, anon, authenticated;
revoke all on table public.web_personal_notification_acceptances
  from public, anon, authenticated;
grant select, insert, update, delete on table public.web_personal_notification_schedule
  to service_role;
grant select, insert, delete on table public.web_personal_notification_acceptances
  to service_role;

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
       or coalesce(v_data ->> 'route', '') !~ '^/[^[:space:]]{0,1000}$' then
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

create or replace function public.claim_due_web_personal_notifications(
  p_limit integer,
  p_lease_owner uuid
)
returns table (
  user_id uuid,
  schedule_key text,
  category text,
  title text,
  body text,
  data jsonb,
  expires_at timestamptz,
  attempt_count integer
)
language sql
security definer
set search_path = ''
as $$
  with selected as (
    select scheduled.user_id, scheduled.schedule_key
      from public.web_personal_notification_schedule scheduled
     where scheduled.dispatched_at is null
       and scheduled.next_attempt_at <= clock_timestamp()
       and scheduled.scheduled_for <= clock_timestamp()
       and scheduled.expires_at > clock_timestamp()
       and (scheduled.lease_until is null or scheduled.lease_until < clock_timestamp())
     order by scheduled.next_attempt_at, scheduled.scheduled_for, scheduled.schedule_key
     for update skip locked
     limit greatest(1, least(coalesce(p_limit, 50), 100))
  ), claimed as (
    update public.web_personal_notification_schedule scheduled
       set lease_owner = p_lease_owner,
           lease_until = clock_timestamp() + interval '2 minutes',
           attempt_count = scheduled.attempt_count + 1,
           last_error = null,
           updated_at = clock_timestamp()
      from selected
     where scheduled.user_id = selected.user_id
       and scheduled.schedule_key = selected.schedule_key
    returning scheduled.user_id, scheduled.schedule_key, scheduled.category,
      scheduled.title, scheduled.body, scheduled.data, scheduled.expires_at,
      scheduled.attempt_count
  )
  select * from claimed;
$$;

revoke all on function public.claim_due_web_personal_notifications(integer, uuid)
  from public, anon, authenticated;
grant execute on function public.claim_due_web_personal_notifications(integer, uuid)
  to service_role;

-- Keep the established account-wide disable RPC while including future PWA
-- reminders. It remains the privacy fence used by old and new clients.
create or replace function public.delete_all_own_push_tokens(
  p_expected_user_id uuid
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_device_deleted integer := 0;
  v_web_deleted integer := 0;
  v_schedule_deleted integer := 0;
begin
  if v_user_id is null then
    raise exception 'Authentication required.' using errcode = '42501';
  end if;
  if v_user_id <> p_expected_user_id then
    raise exception 'Authenticated account changed during push disable.'
      using errcode = '42501';
  end if;
  delete from public.device_push_tokens token where token.user_id = v_user_id;
  get diagnostics v_device_deleted = row_count;
  delete from public.web_push_subscriptions subscription
   where subscription.user_id = v_user_id;
  get diagnostics v_web_deleted = row_count;
  delete from public.web_personal_notification_schedule scheduled
   where scheduled.user_id = v_user_id;
  get diagnostics v_schedule_deleted = row_count;
  return v_device_deleted + v_web_deleted + v_schedule_deleted;
end;
$$;

revoke all on function public.delete_all_own_push_tokens(uuid)
  from public, anon;
grant execute on function public.delete_all_own_push_tokens(uuid)
  to authenticated;

create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;

create or replace function public.invoke_web_personal_notification_worker()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_url text;
  v_secret text;
begin
  select secret.decrypted_secret into v_url
    from vault.decrypted_secrets secret
   where secret.name = 'web_personal_notification_worker_url'
   order by secret.created_at desc limit 1;
  select secret.decrypted_secret into v_secret
    from vault.decrypted_secrets secret
   where secret.name = 'web_personal_notification_worker_secret'
   order by secret.created_at desc limit 1;
  if nullif(v_url, '') is null or nullif(v_secret, '') is null then return; end if;
  perform net.http_post(
    url := v_url,
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || v_secret,
      'Content-Type', 'application/json'
    ),
    body := '{"limit":50}'::jsonb,
    timeout_milliseconds := 15000
  );
end;
$$;

revoke all on function public.invoke_web_personal_notification_worker()
  from public, anon, authenticated;
grant execute on function public.invoke_web_personal_notification_worker()
  to service_role;

select cron.unschedule(jobid)
  from cron.job
 where jobname = 'web-personal-notifications-every-minute';
select cron.schedule(
  'web-personal-notifications-every-minute',
  '* * * * *',
  'select public.invoke_web_personal_notification_worker()'
);

notify pgrst, 'reload schema';
