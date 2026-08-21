-- Standards-based browser Push API subscriptions stay separate from Expo
-- tokens.  Endpoints and encryption keys are capabilities, so clients can
-- only manage them through narrowly-scoped SECURITY DEFINER functions.
create table if not exists public.web_push_subscriptions (
  endpoint text primary key
    check (
      char_length(endpoint) between 12 and 4096
      and endpoint ~ '^https://[^[:space:]]+$'
    ),
  user_id uuid not null references public.profiles(id) on delete cascade,
  p256dh text not null
    check (
      char_length(p256dh) between 40 and 200
      and p256dh ~ '^[A-Za-z0-9_-]+$'
    ),
  auth text not null
    check (
      char_length(auth) between 8 and 100
      and auth ~ '^[A-Za-z0-9_-]+$'
    ),
  expiration_time bigint,
  preferences jsonb not null default '{}'::jsonb
    check (
      jsonb_typeof(preferences) = 'object'
      and pg_catalog.pg_column_size(preferences) <= 16384
    ),
  updated_at timestamptz not null default now()
);

create index if not exists web_push_subscriptions_user_idx
  on public.web_push_subscriptions (user_id);

alter table public.web_push_subscriptions enable row level security;
revoke all on table public.web_push_subscriptions
  from public, anon, authenticated;
grant select, delete on table public.web_push_subscriptions to service_role;

create or replace function public.register_web_push_subscription(
  p_endpoint text,
  p_p256dh text,
  p_auth text,
  p_expiration_time bigint default null,
  p_preferences jsonb default '{}'::jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := (select auth.uid());
  caller_name text;
  normalized_endpoint text := nullif(trim(p_endpoint), '');
  normalized_p256dh text := nullif(trim(p_p256dh), '');
  normalized_auth text := nullif(trim(p_auth), '');
  normalized_preferences jsonb := coalesce(p_preferences, '{}'::jsonb);
  affected_rows integer := 0;
begin
  if caller_id is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  if normalized_endpoint is null
     or char_length(normalized_endpoint) not between 12 and 4096
     or normalized_endpoint !~ '^https://[^[:space:]]+$' then
    raise exception 'A valid HTTPS Web Push endpoint is required'
      using errcode = '22023';
  end if;
  if normalized_p256dh is null
     or char_length(normalized_p256dh) not between 40 and 200
     or normalized_p256dh !~ '^[A-Za-z0-9_-]+$' then
    raise exception 'A valid Web Push p256dh key is required'
      using errcode = '22023';
  end if;
  if normalized_auth is null
     or char_length(normalized_auth) not between 8 and 100
     or normalized_auth !~ '^[A-Za-z0-9_-]+$' then
    raise exception 'A valid Web Push auth key is required'
      using errcode = '22023';
  end if;
  if jsonb_typeof(normalized_preferences) <> 'object' then
    raise exception 'Web Push preferences must be a JSON object'
      using errcode = '22023';
  end if;
  if pg_catalog.pg_column_size(normalized_preferences) > 16384 then
    raise exception 'Web Push preferences exceed the 16 KiB limit'
      using errcode = '22023';
  end if;
  if p_expiration_time is not null and p_expiration_time <= 0 then
    raise exception 'Web Push expiration time must be positive'
      using errcode = '22023';
  end if;

  caller_name := coalesce(
    nullif(auth.jwt() -> 'user_metadata' ->> 'display_name', ''),
    nullif(auth.jwt() -> 'user_metadata' ->> 'full_name', ''),
    nullif(auth.jwt() -> 'user_metadata' ->> 'name', ''),
    nullif(split_part(auth.jwt() ->> 'email', '@', 1), ''),
    'New member'
  );
  insert into public.profiles (id, display_name)
  values (caller_id, left(caller_name, 80))
  on conflict (id) do nothing;
  -- Serialize subscription changes for this account so concurrent calls cannot
  -- evade the bounded fan-out enforced below.
  perform 1
  from public.profiles profile
  where profile.id = caller_id
  for update;

  insert into public.web_push_subscriptions (
    endpoint,
    user_id,
    p256dh,
    auth,
    expiration_time,
    preferences,
    updated_at
  )
  values (
    normalized_endpoint,
    caller_id,
    normalized_p256dh,
    normalized_auth,
    p_expiration_time,
    normalized_preferences,
    now()
  )
  on conflict (endpoint) do update
  set
    user_id = excluded.user_id,
    p256dh = excluded.p256dh,
    auth = excluded.auth,
    expiration_time = excluded.expiration_time,
    preferences = excluded.preferences,
    updated_at = excluded.updated_at
  where public.web_push_subscriptions.user_id = caller_id
     or (
       public.web_push_subscriptions.p256dh = excluded.p256dh
       and public.web_push_subscriptions.auth = excluded.auth
     );
  get diagnostics affected_rows = row_count;
  if affected_rows = 0 then
    raise exception 'This Web Push endpoint belongs to another account'
      using errcode = '42501';
  end if;

  -- A user can reasonably have several installed browsers/devices, but not an
  -- unbounded collection of endpoints. Retain the 20 most recently refreshed.
  delete from public.web_push_subscriptions subscription
  where subscription.user_id = caller_id
    and subscription.endpoint in (
      select older.endpoint
      from public.web_push_subscriptions older
      where older.user_id = caller_id
      order by older.updated_at desc, older.endpoint
      offset 20
    );
end;
$$;

revoke all on function public.register_web_push_subscription(
  text,
  text,
  text,
  bigint,
  jsonb
) from public, anon;
grant execute on function public.register_web_push_subscription(
  text,
  text,
  text,
  bigint,
  jsonb
) to authenticated;

create or replace function public.own_web_push_subscription_exists(
  p_endpoint text
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select (select auth.uid()) is not null
    and exists (
      select 1
      from public.web_push_subscriptions subscription
      where subscription.user_id = (select auth.uid())
        and subscription.endpoint = nullif(trim(p_endpoint), '')
    );
$$;

revoke all on function public.own_web_push_subscription_exists(text)
  from public, anon;
grant execute on function public.own_web_push_subscription_exists(text)
  to authenticated;

create or replace function public.delete_own_web_push_subscription(
  p_expected_user_id uuid,
  p_endpoint text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := (select auth.uid());
begin
  if caller_id is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  if caller_id <> p_expected_user_id then
    raise exception 'Authenticated account changed during Web Push cleanup.'
      using errcode = '42501';
  end if;
  delete from public.web_push_subscriptions subscription
  where subscription.user_id = caller_id
    and subscription.endpoint = nullif(trim(p_endpoint), '');
end;
$$;

revoke all on function public.delete_own_web_push_subscription(uuid, text)
  from public, anon;
grant execute on function public.delete_own_web_push_subscription(uuid, text)
  to authenticated;

-- The notification master switch is deliberately account-wide.  Keep the
-- established function name for old native clients while clearing both token
-- transports for new clients.
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
begin
  if v_user_id is null then
    raise exception 'Authentication required.' using errcode = '42501';
  end if;
  if v_user_id <> p_expected_user_id then
    raise exception 'Authenticated account changed during push disable.'
      using errcode = '42501';
  end if;
  delete from public.device_push_tokens token
  where token.user_id = v_user_id;
  get diagnostics v_device_deleted = row_count;
  delete from public.web_push_subscriptions subscription
  where subscription.user_id = v_user_id;
  get diagnostics v_web_deleted = row_count;
  return v_device_deleted + v_web_deleted;
end;
$$;

revoke all on function public.delete_all_own_push_tokens(uuid)
  from public, anon;
grant execute on function public.delete_all_own_push_tokens(uuid)
  to authenticated;

notify pgrst, 'reload schema';
