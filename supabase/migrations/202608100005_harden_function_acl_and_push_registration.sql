-- Supabase grants function EXECUTE to anon/authenticated through default
-- privileges.  Earlier migrations revoked PUBLIC, but an explicit anon grant
-- still left every public RPC (including SECURITY DEFINER helpers) exposed to
-- unauthenticated requests.  The app has a credential-free local demo, so no
-- database function needs to be callable before authentication.
revoke all privileges on all functions in schema public from public, anon;

-- Keep future functions private by default.  Client-facing RPC migrations must
-- opt authenticated users in explicitly, as the existing migrations do.
alter default privileges in schema public
  revoke execute on functions from public, anon;

-- Trigger functions and revision helpers are implementation details.  They run
-- as the table/function owner and do not need to be callable through PostgREST.
revoke all on function public.touch_updated_at() from authenticated;
revoke all on function public.handle_new_user() from authenticated;
revoke all on function public.handle_new_group() from authenticated;
revoke all on function public.fill_daily_metric_shared_value()
  from authenticated;
revoke all on function public.broadcast_account_snapshot_revision()
  from authenticated;
revoke all on function public.broadcast_group_activity_version()
  from authenticated;
revoke all on function public.broadcast_group_chat_commit()
  from authenticated;
revoke all on function public.enforce_account_profile_revision()
  from authenticated;
revoke all on function public.enforce_group_configuration_fence()
  from authenticated;
revoke all on function public.enforce_group_projection_revision()
  from authenticated;
revoke all on function public.assert_account_snapshot_revision(uuid, bigint)
  from authenticated;
revoke all on function public.prepare_profile_deletion()
  from authenticated;

-- These pre-atomic overloads are no longer called by the current client.  Do
-- not leave a path that can bypass the current revision-fenced RPCs.
revoke all on function public.create_group_with_metrics(text, jsonb, text)
  from authenticated;
revoke all on function public.join_group_with_code(text)
  from authenticated;
revoke all on function public.delete_group_metric_entries(text[])
  from authenticated;
revoke all on function public.commit_group_activity_version(uuid, date)
  from authenticated;

-- Joining should be as resilient as group creation when an otherwise valid
-- auth account is missing its public profile projection (for example after a
-- partial restore).  Repair the projection inside the same transaction before
-- the group_members foreign key is evaluated.
create or replace function public.request_group_membership(code text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := (select auth.uid());
  caller_name text;
  target public.groups%rowtype;
  requested_status text;
begin
  if caller_id is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  select *
    into target
    from public.groups
   where upper(invite_code) = upper(trim(code));
  if target.id is null then
    raise exception 'Invalid invite code' using errcode = '22023';
  end if;

  caller_name := coalesce(
    nullif(trim(auth.jwt() -> 'user_metadata' ->> 'display_name'), ''),
    nullif(trim(auth.jwt() -> 'user_metadata' ->> 'full_name'), ''),
    nullif(trim(auth.jwt() -> 'user_metadata' ->> 'name'), ''),
    nullif(split_part(auth.jwt() ->> 'email', '@', 1), ''),
    'HabHub member'
  );
  insert into public.profiles (id, display_name)
  values (caller_id, left(caller_name, 80))
  on conflict (id) do nothing;

  requested_status := case
    when coalesce(
      (target.settings ->> 'requireMemberApproval')::boolean,
      false
    ) then 'pending'
    else 'active'
  end;
  insert into public.group_members (group_id, user_id, role, status)
  values (target.id, caller_id, 'member', requested_status)
  on conflict (group_id, user_id) do update
  set status = case
    when public.group_members.status = 'active' then 'active'
    else excluded.status
  end;

  select membership.status
    into requested_status
    from public.group_members membership
   where membership.group_id = target.id
     and membership.user_id = caller_id;
  return jsonb_build_object(
    'groupId', target.id,
    'groupName', target.name,
    'status', requested_status
  );
end;
$$;

revoke all on function public.request_group_membership(text)
  from public, anon;
grant execute on function public.request_group_membership(text)
  to authenticated;

-- Presence is useful, but repeated lifecycle callbacks should not rewrite the
-- same account-device row every few seconds.  A changed platform/label is
-- immediate; an unchanged heartbeat is durable at most once per ten minutes.
create or replace function public.register_account_device(
  client_device_id text,
  client_platform text,
  client_label text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := (select auth.uid());
  normalized_device_id text := nullif(trim(client_device_id), '');
  normalized_label text := nullif(trim(client_label), '');
begin
  if caller_id is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  if normalized_device_id is null then
    raise exception 'Device id is required' using errcode = '22023';
  end if;
  if client_platform not in ('ios', 'android', 'web', 'unknown') then
    raise exception 'Unsupported platform' using errcode = '22023';
  end if;

  insert into public.account_devices (
    user_id,
    device_id,
    platform,
    label,
    last_seen_at
  )
  values (
    caller_id,
    normalized_device_id,
    client_platform,
    normalized_label,
    now()
  )
  on conflict (user_id, device_id) do update
  set
    platform = excluded.platform,
    label = coalesce(excluded.label, public.account_devices.label),
    last_seen_at = excluded.last_seen_at
  where public.account_devices.platform is distinct from excluded.platform
     or (
       excluded.label is not null
       and public.account_devices.label is distinct from excluded.label
     )
     or public.account_devices.last_seen_at < now() - interval '10 minutes';
end;
$$;

revoke all on function public.register_account_device(text, text, text)
  from public, anon;
grant execute on function public.register_account_device(text, text, text)
  to authenticated;

-- Push registration is idempotent and may legitimately be retried.  Avoid
-- taking a write lock and emitting WAL for an identical registration more than
-- once per day; preference, owner, platform, or token changes still persist
-- immediately.
create or replace function public.register_device_push_token(
  p_token text,
  p_platform text,
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
  normalized_token text := nullif(trim(p_token), '');
  normalized_preferences jsonb := coalesce(p_preferences, '{}'::jsonb);
begin
  if caller_id is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  if normalized_token is null then
    raise exception 'Push token is required' using errcode = '22023';
  end if;
  if p_platform not in ('android', 'ios') then
    raise exception 'Unsupported push platform' using errcode = '22023';
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

  insert into public.device_push_tokens (
    token,
    user_id,
    platform,
    preferences,
    updated_at
  )
  values (
    normalized_token,
    caller_id,
    p_platform,
    normalized_preferences,
    now()
  )
  on conflict (token) do update
  set
    user_id = excluded.user_id,
    platform = excluded.platform,
    preferences = excluded.preferences,
    updated_at = excluded.updated_at
  where public.device_push_tokens.user_id is distinct from excluded.user_id
     or public.device_push_tokens.platform is distinct from excluded.platform
     or public.device_push_tokens.preferences is distinct from excluded.preferences
     or public.device_push_tokens.updated_at < now() - interval '1 day';
end;
$$;

revoke all on function public.register_device_push_token(text, text, jsonb)
  from public, anon;
grant execute on function public.register_device_push_token(text, text, jsonb)
  to authenticated;

-- These are small workspace invalidation streams.  Activity values stay on the
-- compact version/broadcast path, while photo, group settings, and shared
-- profile changes need a realtime signal so peers can refresh without polling.
do $$
declare
  relation_name text;
begin
  foreach relation_name in array array[
    'photo_updates',
    'groups',
    'profiles'
  ]
  loop
    if not exists (
      select 1
        from pg_catalog.pg_publication_tables publication_table
       where publication_table.pubname = 'supabase_realtime'
         and publication_table.schemaname = 'public'
         and publication_table.tablename = relation_name
    ) then
      begin
        execute format(
          'alter publication supabase_realtime add table public.%I',
          relation_name
        );
      exception when duplicate_object then
        null;
      end;
    end if;
  end loop;
end;
$$;

notify pgrst, 'reload schema';
