-- A leaderboard timestamp describes when that member last published current
-- data, not when a selected historical measurement was recorded or when a
-- different member refreshed their screen.
alter table public.group_members
  add column if not exists last_data_synced_at timestamptz;

-- Preserve useful freshness for existing groups during the schema upgrade.
update public.group_members membership
set last_data_synced_at = published.synced_at
from (
  select group_id, user_id, max(updated_at) as synced_at
  from public.daily_metric_status
  group by group_id, user_id
) published
where membership.group_id = published.group_id
  and membership.user_id = published.user_id
  and (
    membership.last_data_synced_at is null
    or published.synced_at > membership.last_data_synced_at
  );

create or replace function public.commit_group_activity_version(
  p_group_id uuid,
  p_since_date date default (current_date - 120)
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  committed_version bigint;
  committed_at timestamptz := clock_timestamp();
begin
  if not exists (
    select 1
    from public.group_members membership
    where membership.group_id = p_group_id
      and membership.user_id = (select auth.uid())
      and membership.status = 'active'
  ) then
    raise exception 'Not authorized for this group';
  end if;

  insert into public.group_activity_versions (
    group_id,
    version,
    since_date,
    updated_at
  )
  values (p_group_id, 1, p_since_date, committed_at)
  on conflict (group_id) do update
    set version = public.group_activity_versions.version + 1,
        since_date = excluded.since_date,
        updated_at = excluded.updated_at
  returning version into committed_version;

  update public.group_members
  set last_data_synced_at = committed_at
  where group_id = p_group_id
    and user_id = (select auth.uid())
    and status = 'active';

  return committed_version;
end;
$$;

revoke all on function public.commit_group_activity_version(uuid, date)
  from public;
grant execute on function public.commit_group_activity_version(uuid, date)
  to authenticated;

