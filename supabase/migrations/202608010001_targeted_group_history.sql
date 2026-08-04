-- Keep leaderboard history complete without downloading unbounded raw logs.
-- Daily status rows are the compact group read model used for rankings;
-- individual shared entries and media remain a bounded recent cache.

create or replace function public.get_group_activity_snapshot(
  p_group_id uuid,
  p_since_date date default (current_date - 120)
)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select jsonb_build_object(
    'version',
      coalesce(
        (
          select version
          from public.group_activity_versions
          where group_id = p_group_id
        ),
        0
      ),
    'updated_at',
      (
        select updated_at
        from public.group_activity_versions
        where group_id = p_group_id
      ),
    'since_date', p_since_date,
    'entries_since_date', greatest(p_since_date, current_date - 120),
    'statuses_since_date', p_since_date,
    'metrics',
      coalesce(
        (
          select jsonb_agg(
            jsonb_build_object('id', definition.id, 'slug', definition.slug)
            order by definition.slug
          )
          from public.metric_definitions definition
          where definition.group_id = p_group_id
        ),
        '[]'::jsonb
      ),
    'entries',
      coalesce(
        (
          select jsonb_agg(to_jsonb(entry) order by entry.recorded_at, entry.id)
          from public.metric_entries entry
          join public.metric_definitions definition
            on definition.id = entry.metric_id
          where definition.group_id = p_group_id
            and entry.local_date >= greatest(p_since_date, current_date - 120)
        ),
        '[]'::jsonb
      ),
    'statuses',
      coalesce(
        (
          select jsonb_agg(
            to_jsonb(status) || jsonb_build_object(
              'exact_value',
              case
                when status.user_id = (select auth.uid())
                  or status.visibility::text = 'group'
                then status.exact_value
                else null
              end
            )
            order by status.local_date, status.metric_id, status.user_id
          )
          from public.daily_metric_status status
          where status.group_id = p_group_id
            and (
              status.user_id = (select auth.uid())
              or coalesce(status.visibility::text, 'status') <> 'private'
            )
            and status.local_date >= p_since_date
        ),
        '[]'::jsonb
      ),
    'tombstones',
      coalesce(
        (
          select jsonb_agg(
            jsonb_build_object(
              'user_id', tombstone.user_id,
              'client_generated_id', tombstone.client_generated_id,
              'local_date', tombstone.local_date,
              'deleted_at', tombstone.deleted_at
            )
            order by tombstone.deleted_at, tombstone.client_generated_id
          )
          from public.metric_entry_tombstones tombstone
          where tombstone.group_id = p_group_id
            and tombstone.local_date >= greatest(p_since_date, current_date - 120)
        ),
        '[]'::jsonb
      )
  )
  where public.is_group_member(p_group_id);
$$;

revoke all on function public.get_group_activity_snapshot(uuid, date)
  from public;
grant execute on function public.get_group_activity_snapshot(uuid, date)
  to authenticated;

-- Preserve the earliest changed summary date in each coherent commit marker.
-- Unlike raw entries, compact status history is intentionally not truncated.
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
  values (p_group_id, 1, p_since_date, now())
  on conflict (group_id) do update
    set version = public.group_activity_versions.version + 1,
        since_date = excluded.since_date,
        updated_at = excluded.updated_at
  returning version into committed_version;

  return committed_version;
end;
$$;

revoke all on function public.commit_group_activity_version(uuid, date)
  from public;
grant execute on function public.commit_group_activity_version(uuid, date)
  to authenticated;
