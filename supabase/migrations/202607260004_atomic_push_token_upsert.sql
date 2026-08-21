-- Several app surfaces may refresh the same device token at once immediately
-- after permission is granted. A single atomic upsert makes that harmless.
create or replace function public.register_device_push_token(
  p_token text,
  p_platform text,
  p_preferences jsonb default '{}'::jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  caller uuid := auth.uid();
  caller_name text;
begin
  if caller is null then
    raise exception 'Authentication required';
  end if;
  if nullif(trim(p_token), '') is null then
    raise exception 'Push token is required';
  end if;
  if p_platform not in ('android', 'ios') then
    raise exception 'Unsupported push platform';
  end if;

  caller_name := coalesce(
    nullif(auth.jwt() -> 'user_metadata' ->> 'display_name', ''),
    nullif(auth.jwt() -> 'user_metadata' ->> 'full_name', ''),
    nullif(auth.jwt() -> 'user_metadata' ->> 'name', ''),
    nullif(split_part(auth.jwt() ->> 'email', '@', 1), ''),
    'New member'
  );
  insert into public.profiles (id, display_name)
  values (caller, caller_name)
  on conflict (id) do nothing;

  insert into public.device_push_tokens (
    token,
    user_id,
    platform,
    preferences,
    updated_at
  )
  values (
    trim(p_token),
    caller,
    p_platform,
    coalesce(p_preferences, '{}'::jsonb),
    now()
  )
  on conflict (token) do update
  set
    user_id = excluded.user_id,
    platform = excluded.platform,
    preferences = excluded.preferences,
    updated_at = excluded.updated_at;
end;
$$;

revoke all on function public.register_device_push_token(text, text, jsonb)
  from public;
grant execute on function public.register_device_push_token(text, text, jsonb)
  to authenticated;

notify pgrst, 'reload schema';
