-- RLS prevents a peer from fetching a newly restricted row, but that peer may
-- still have an older exact group-visible row in its offline cache.  A
-- permanent, date-free revision fence lets clients discard only rows written
-- at or before the restriction revision.  No date, value, goal, target, or
-- has-data signal is exposed, and a later re-share has a greater account
-- revision so it remains visible.

create table if not exists public.metric_privacy_cache_fences (
  group_id uuid not null references public.groups(id) on delete cascade,
  metric_id uuid not null references public.metric_definitions(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  revision bigint not null check (revision > 0),
  primary key (group_id, metric_id, user_id)
);

comment on table public.metric_privacy_cache_fences is
  'Date-free account-revision fences that invalidate previously cached exact tracker projections.';
comment on column public.metric_privacy_cache_fences.revision is
  'Highest owner account revision at which exact group sharing was withdrawn.';

create index if not exists metric_privacy_cache_fences_user_group_idx
  on public.metric_privacy_cache_fences (user_id, group_id);

-- Tombstones are intentionally read without a date bound below.  Keep that
-- precise deletion stream ordered/indexable without scanning entry history.
create index if not exists metric_entry_tombstones_group_deleted_idx
  on public.metric_entry_tombstones (
    group_id,
    deleted_at,
    client_generated_id
  ) include (user_id, visibility);

alter table public.metric_privacy_cache_fences enable row level security;

-- Make the API surface explicit: active members may read only the metadata
-- selected by RLS, while all writes stay confined to the trigger/RPC paths.
revoke all on table public.metric_privacy_cache_fences
  from public, anon, authenticated;
grant select on table public.metric_privacy_cache_fences
  to authenticated;

drop policy if exists metric_privacy_cache_fences_active_member_read
  on public.metric_privacy_cache_fences;
create policy metric_privacy_cache_fences_active_member_read
  on public.metric_privacy_cache_fences
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.group_members membership
      where membership.group_id = metric_privacy_cache_fences.group_id
        and membership.user_id = (select auth.uid())
        and membership.status = 'active'
    )
  );

-- There are intentionally no client INSERT, UPDATE, or DELETE policies.
-- Authenticated owners advance fences through the revision-checked RPC below;
-- compatible and legacy projection writes are covered by server triggers.

create or replace function public.advance_metric_privacy_cache_fence_internal(
  p_group_id uuid,
  p_metric_id uuid,
  p_user_id uuid,
  p_revision bigint
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  advanced boolean := false;
begin
  if p_revision is null or p_revision <= 0 then
    return false;
  end if;

  -- Fail closed on inconsistent identities.  This is an internal function,
  -- but validating every foreign-key relationship makes future trigger use
  -- safe as well.
  if not exists (
    select 1
    from public.metric_definitions definition
    where definition.id = p_metric_id
      and definition.group_id = p_group_id
      and definition.archived_at is null
  ) or not exists (
    select 1
    from public.group_members membership
    where membership.group_id = p_group_id
      and membership.user_id = p_user_id
      and membership.status = 'active'
  ) then
    return false;
  end if;

  with advanced_fence as (
    insert into public.metric_privacy_cache_fences (
      group_id,
      metric_id,
      user_id,
      revision
    ) values (
      p_group_id,
      p_metric_id,
      p_user_id,
      p_revision
    )
    on conflict (group_id, metric_id, user_id) do update
      set revision = excluded.revision
      where public.metric_privacy_cache_fences.revision < excluded.revision
    returning true
  )
  select coalesce(bool_or(true), false)
    into advanced
    from advanced_fence;

  if advanced then
    -- Signal peers only when the monotonic fence actually advanced.  Repeated
    -- historical rows and retrying the same account revision are no-ops.
    insert into public.group_activity_versions (
      group_id,
      version,
      since_date,
      updated_at
    ) values (
      p_group_id,
      1,
      current_date,
      statement_timestamp()
    )
    on conflict (group_id) do update
      set version = public.group_activity_versions.version + 1,
          since_date = excluded.since_date,
          updated_at = excluded.updated_at;
  end if;

  return advanced;
end;
$$;

revoke all on function public.advance_metric_privacy_cache_fence_internal(uuid, uuid, uuid, bigint)
  from public, anon, authenticated;

-- Resolve a usable privacy event revision.  Current clients stamp every
-- projection row.  The account snapshot revision wins because the private
-- snapshot CAS is committed before relational rows are rewritten; a legacy
-- row may still carry an older or missing projection revision.
create or replace function public.metric_privacy_event_revision(
  p_user_id uuid,
  p_row_revision bigint
)
returns bigint
language sql
stable
security definer
set search_path = ''
as $$
  select nullif(
    greatest(
      coalesce(p_row_revision, 0),
      coalesce(
        (
          select snapshot.revision
          from public.user_snapshots snapshot
          where snapshot.user_id = p_user_id
        ),
        0
      )
    ),
    0
  );
$$;

revoke all on function public.metric_privacy_event_revision(uuid, bigint)
  from public, anon, authenticated;

-- Transition-table triggers collapse a historical rewrite to one fence
-- attempt per owner/tracker/revision rather than one write per daily row.
create or replace function public.fence_nonexact_metric_entry_updates()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  restricted record;
begin
  for restricted in
    select
      definition.group_id,
      new_row.metric_id,
      new_row.user_id,
      max(public.metric_privacy_event_revision(
        new_row.user_id,
        new_row.account_revision
      )) as revision
    from new_rows new_row
    join old_rows old_row on old_row.id = new_row.id
    join public.metric_definitions definition
      on definition.id = new_row.metric_id
    where old_row.visibility::text = 'group'
      and new_row.visibility::text <> 'group'
      and definition.group_id is not null
    group by definition.group_id, new_row.metric_id, new_row.user_id
  loop
    perform public.advance_metric_privacy_cache_fence_internal(
      restricted.group_id,
      restricted.metric_id,
      restricted.user_id,
      restricted.revision
    );
  end loop;
  return null;
end;
$$;

create or replace function public.fence_nonexact_daily_status_updates()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  restricted record;
begin
  for restricted in
    select
      new_row.group_id,
      new_row.metric_id,
      new_row.user_id,
      max(public.metric_privacy_event_revision(
        new_row.user_id,
        new_row.account_revision
      )) as revision
    from new_rows new_row
    join old_rows old_row
      on old_row.group_id = new_row.group_id
     and old_row.metric_id = new_row.metric_id
     and old_row.user_id = new_row.user_id
     and old_row.local_date = new_row.local_date
    where coalesce(old_row.visibility::text, 'status') = 'group'
      and coalesce(new_row.visibility::text, 'status') <> 'group'
    group by new_row.group_id, new_row.metric_id, new_row.user_id
  loop
    perform public.advance_metric_privacy_cache_fence_internal(
      restricted.group_id,
      restricted.metric_id,
      restricted.user_id,
      restricted.revision
    );
  end loop;
  return null;
end;
$$;

-- Progress photos use one canonical group tracker.  A photo that leaves exact
-- group visibility must fence the same `progress_photo` cache key used by the
-- app, including old photos beyond the server's bounded photo list.
create or replace function public.fence_nonexact_photo_updates()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  restricted record;
begin
  for restricted in
    select
      new_row.group_id,
      definition.id as metric_id,
      new_row.owner_user_id as user_id,
      max(public.metric_privacy_event_revision(
        new_row.owner_user_id,
        new_row.account_revision
      )) as revision
    from new_rows new_row
    join old_rows old_row on old_row.id = new_row.id
    join public.metric_definitions definition
      on definition.group_id = new_row.group_id
     and definition.slug = 'progress_photo'
     and definition.archived_at is null
    where old_row.visibility::text = 'group'
      and new_row.visibility::text <> 'group'
      and new_row.group_id is not null
    group by new_row.group_id, definition.id, new_row.owner_user_id
  loop
    perform public.advance_metric_privacy_cache_fence_internal(
      restricted.group_id,
      restricted.metric_id,
      restricted.user_id,
      restricted.revision
    );
  end loop;
  return null;
end;
$$;

revoke all on function public.fence_nonexact_metric_entry_updates()
  from public, anon, authenticated;
revoke all on function public.fence_nonexact_daily_status_updates()
  from public, anon, authenticated;
revoke all on function public.fence_nonexact_photo_updates()
  from public, anon, authenticated;

drop trigger if exists metric_entries_fence_nonexact_update
  on public.metric_entries;
create trigger metric_entries_fence_nonexact_update
after update on public.metric_entries
referencing old table as old_rows new table as new_rows
for each statement execute function public.fence_nonexact_metric_entry_updates();

drop trigger if exists daily_status_fence_nonexact_update
  on public.daily_metric_status;
create trigger daily_status_fence_nonexact_update
after update on public.daily_metric_status
referencing old table as old_rows new table as new_rows
for each statement execute function public.fence_nonexact_daily_status_updates();

drop trigger if exists photo_updates_fence_nonexact_update
  on public.photo_updates;
create trigger photo_updates_fence_nonexact_update
after update on public.photo_updates
referencing old table as old_rows new table as new_rows
for each statement execute function public.fence_nonexact_photo_updates();

-- Explicit default-visibility changes may have no row in the client's bounded
-- publish window.  A private account outbox calls this idempotent RPC with the
-- current account revision, covering that zero-row case without allowing a
-- stale device to advance group-visible metadata.
create or replace function public.advance_metric_privacy_cache_fences(
  p_group_id uuid,
  p_metric_ids uuid[],
  p_expected_revision bigint
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := (select auth.uid());
  metric_id_to_fence uuid;
  requested_count integer;
  authorized_count integer;
begin
  if caller_id is null or not exists (
    select 1
    from public.group_members membership
    where membership.group_id = p_group_id
      and membership.user_id = caller_id
      and membership.status = 'active'
  ) then
    raise exception 'metric_privacy_fence_forbidden' using errcode = '42501';
  end if;

  perform public.assert_account_snapshot_revision(
    caller_id,
    p_expected_revision
  );

  select count(*)
    into requested_count
    from (
      select distinct requested.metric_id
      from unnest(coalesce(p_metric_ids, array[]::uuid[]))
        as requested(metric_id)
    ) requested_metrics;

  select count(*)
    into authorized_count
    from (
      select distinct requested.metric_id
      from unnest(coalesce(p_metric_ids, array[]::uuid[]))
        as requested(metric_id)
      join public.metric_definitions definition
        on definition.id = requested.metric_id
       and definition.group_id = p_group_id
       and definition.archived_at is null
    ) authorized_metrics;

  if requested_count <> authorized_count then
    raise exception 'metric_privacy_fence_metric_mismatch'
      using errcode = '22023';
  end if;

  for metric_id_to_fence in
    select distinct requested.metric_id
    from unnest(coalesce(p_metric_ids, array[]::uuid[]))
      as requested(metric_id)
  loop
    perform public.advance_metric_privacy_cache_fence_internal(
      p_group_id,
      metric_id_to_fence,
      caller_id,
      p_expected_revision
    );
  end loop;
end;
$$;

revoke all on function public.advance_metric_privacy_cache_fences(uuid, uuid[], bigint)
  from public, anon;
grant execute on function public.advance_metric_privacy_cache_fences(uuid, uuid[], bigint)
  to authenticated;

-- Private status rows remain owner-only.  Use an explicit active-membership
-- predicate so pending and removed members cannot read either status data or
-- infer that a private row exists.
drop policy if exists daily_status_member_read
  on public.daily_metric_status;
create policy daily_status_member_read
  on public.daily_metric_status
  for select
  to authenticated
  using (
    user_id = (select auth.uid())
    or (
      coalesce(visibility::text, 'status') <> 'private'
      and exists (
        select 1
        from public.group_members membership
        where membership.group_id = daily_metric_status.group_id
          and membership.user_id = (select auth.uid())
          and membership.status = 'active'
      )
    )
  );

-- Keep the existing MVCC-consistent snapshot and append only a date-free
-- owner/tracker/revision fence.  All row values continue to be filtered by the
-- caller's RLS context because this function remains SECURITY INVOKER.
-- The fence and an authorized status-only row from the same revision coexist:
-- clients discard exact/group rows at or below the fence, retain status-only
-- rows at the fence revision, and discard older status projections.  The
-- fence therefore revokes values without hiding the newly authorized
-- `Goal met` / `In progress` projection.
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
            and definition.archived_at is null
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
            and definition.archived_at is null
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
          join public.metric_definitions definition
            on definition.id = status.metric_id
          where status.group_id = p_group_id
            and definition.group_id = p_group_id
            and definition.archived_at is null
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
          -- Deletions are durable across the raw-entry 120-day window.  Only
          -- the opaque row identity is returned, so this does not reveal its
          -- date, value, tracker, target, or deletion time to a new peer.
          select jsonb_agg(
            jsonb_build_object(
              'user_id', tombstone.user_id,
              'client_generated_id', tombstone.client_generated_id
            )
            order by tombstone.deleted_at, tombstone.client_generated_id
          )
          from public.metric_entry_tombstones tombstone
          where tombstone.group_id = p_group_id
        ),
        '[]'::jsonb
      ),
    'privacy_fences',
      coalesce(
        (
          select jsonb_agg(
            jsonb_build_object(
              'user_id', fence.user_id,
              'metric_id', fence.metric_id,
              'revision', fence.revision
            )
            order by fence.user_id, fence.metric_id
          )
          from public.metric_privacy_cache_fences fence
          where fence.group_id = p_group_id
        ),
        '[]'::jsonb
      )
  )
  where public.is_group_member(p_group_id);
$$;

revoke all on function public.get_group_activity_snapshot(uuid, date)
  from public, anon;
grant execute on function public.get_group_activity_snapshot(uuid, date)
  to authenticated;
