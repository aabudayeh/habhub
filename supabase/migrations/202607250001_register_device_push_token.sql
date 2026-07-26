-- A physical device keeps the same Expo push token when a user signs out and
-- another user signs in. Owner-only RLS correctly blocks a normal upsert from
-- taking over that existing row, so registration is performed by this narrow
-- security-definer function instead.
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

  delete from public.device_push_tokens where token = p_token;
  insert into public.device_push_tokens (
    token,
    user_id,
    platform,
    preferences,
    updated_at
  )
  values (
    p_token,
    caller,
    p_platform,
    coalesce(p_preferences, '{}'::jsonb),
    now()
  );
end;
$$;

revoke all on function public.register_device_push_token(text, text, jsonb)
  from public;
grant execute on function public.register_device_push_token(text, text, jsonb)
  to authenticated;
