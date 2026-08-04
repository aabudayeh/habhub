-- Lightweight presence lets group screens show recent member freshness
-- without reloading or rewriting tracker history.
alter table public.group_members
  add column if not exists last_seen_at timestamptz not null default now();

create index if not exists group_members_group_last_seen_idx
  on public.group_members (group_id, last_seen_at desc)
  where status = 'active';

create or replace function public.touch_group_member_presence(
  p_group_id uuid
)
returns timestamptz
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  touched_at timestamptz;
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;

  update public.group_members
  set last_seen_at = now()
  where group_id = p_group_id
    and user_id = auth.uid()
    and status = 'active'
  returning last_seen_at into touched_at;

  if touched_at is null then
    raise exception 'Active group membership required';
  end if;

  return touched_at;
end;
$$;

revoke all on function public.touch_group_member_presence(uuid) from public;
grant execute on function public.touch_group_member_presence(uuid) to authenticated;
