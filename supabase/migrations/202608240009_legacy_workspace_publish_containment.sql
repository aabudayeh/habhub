-- Already-loaded web clients use the pre-conditional activity protocol: a
-- direct upsert of the recent status matrix followed by an unconditional
-- commit_group_activity_version call. A private snapshot revision can advance
-- while that shared projection remains identical, so comparing account_revision
-- as ordinary data still rewrites every row and wakes every group member.
--
-- Keep account revisions causal without treating them as visible data. A
-- revision-only write is retained only when it makes an exact group projection
-- cross a privacy-cache fence. All other byte-equivalent status/entry updates
-- are cancelled before they create a tuple or an activity marker.
create or replace function public.touch_daily_metric_status_updated_at()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_crosses_privacy_fence boolean := false;
begin
  if (to_jsonb(new) - array['updated_at', 'account_revision'])
       is not distinct from
     (to_jsonb(old) - array['updated_at', 'account_revision']) then
    if coalesce(new.visibility, 'status') = 'group'
       and coalesce(new.account_revision, 0) > coalesce(old.account_revision, 0) then
      select exists (
        select 1
          from public.metric_privacy_cache_fences fence
         where fence.group_id = new.group_id
           and fence.metric_id = new.metric_id
           and fence.user_id = new.user_id
           and fence.revision >= coalesce(old.account_revision, 0)
           and new.account_revision > fence.revision
      ) into v_crosses_privacy_fence;
    end if;

    if not v_crosses_privacy_fence then
      return null;
    end if;
  end if;

  new.updated_at = statement_timestamp();
  return new;
end;
$$;

revoke all on function public.touch_daily_metric_status_updated_at()
  from public, anon, authenticated;

-- The original generic touch trigger runs alphabetically before the causal
-- revision guard on metric_entries. Move its replacement after that guard so
-- stale or foreign writes are still rejected before an equivalent update can
-- be discarded.
create or replace function public.touch_metric_entry_updated_at_if_changed()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_crosses_privacy_fence boolean := false;
begin
  if (to_jsonb(new) - array['updated_at', 'account_revision'])
       is not distinct from
     (to_jsonb(old) - array['updated_at', 'account_revision']) then
    if new.visibility::text = 'group'
       and coalesce(new.account_revision, 0) > coalesce(old.account_revision, 0) then
      select exists (
        select 1
          from public.metric_definitions definition
          join public.metric_privacy_cache_fences fence
            on fence.group_id = definition.group_id
           and fence.metric_id = definition.id
           and fence.user_id = new.user_id
         where definition.id = new.metric_id
           and definition.group_id is not null
           and fence.revision >= coalesce(old.account_revision, 0)
           and new.account_revision > fence.revision
      ) into v_crosses_privacy_fence;
    end if;

    if not v_crosses_privacy_fence then
      return null;
    end if;
  end if;

  new.updated_at = statement_timestamp();
  return new;
end;
$$;

drop trigger if exists entries_touch_updated_at on public.metric_entries;
drop trigger if exists metric_entries_z_touch_updated_at on public.metric_entries;
create trigger metric_entries_z_touch_updated_at
before update on public.metric_entries
for each row execute function public.touch_metric_entry_updated_at_if_changed();

revoke all on function public.touch_metric_entry_updated_at_if_changed()
  from public, anon, authenticated;

-- Persist a tiny per-member dirty marker across the two PostgREST transactions.
-- The table contains no tracker values and is not client-readable or writable.
-- Statement-level triggers below collapse a large status backfill to one marker
-- update per affected member/group rather than adding row-level write pressure.
create table if not exists public.group_activity_publish_state (
  group_id uuid not null,
  user_id uuid not null,
  change_sequence bigint not null default 0 check (change_sequence >= 0),
  committed_sequence bigint not null default 0 check (
    committed_sequence >= 0 and committed_sequence <= change_sequence
  ),
  earliest_changed_date date,
  changed_at timestamptz,
  committed_at timestamptz,
  primary key (group_id, user_id),
  foreign key (group_id, user_id)
    references public.group_members(group_id, user_id) on delete cascade
);

comment on table public.group_activity_publish_state is
  'Server-private material-change marker used to suppress unchanged legacy workspace activity commits.';

alter table public.group_activity_publish_state enable row level security;
revoke all on table public.group_activity_publish_state
  from public, anon, authenticated;

drop policy if exists group_activity_publish_state_no_client_access
  on public.group_activity_publish_state;
create policy group_activity_publish_state_no_client_access
  on public.group_activity_publish_state
  as restrictive
  for all
  to authenticated
  using (false)
  with check (false);

create or replace function public.mark_group_activity_publish_change(
  p_group_id uuid,
  p_user_id uuid,
  p_since_date date
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller_id uuid := (select auth.uid());
begin
  -- Service-owned projections (for example Google Health) publish their own
  -- coherent version marker. Only authenticated legacy/client writes need the
  -- two-transaction dirty ledger.
  if v_caller_id is null
     or p_group_id is null
     or p_user_id is distinct from v_caller_id then
    return;
  end if;

  if not exists (
    select 1
      from public.group_members membership
     where membership.group_id = p_group_id
       and membership.user_id = v_caller_id
       and membership.status = 'active'
  ) then
    return;
  end if;

  insert into public.group_activity_publish_state as publish_state (
    group_id,
    user_id,
    change_sequence,
    committed_sequence,
    earliest_changed_date,
    changed_at
  ) values (
    p_group_id,
    v_caller_id,
    1,
    0,
    p_since_date,
    clock_timestamp()
  )
  on conflict (group_id, user_id) do update
    set change_sequence = publish_state.change_sequence + 1,
        earliest_changed_date = case
          when publish_state.change_sequence = publish_state.committed_sequence
          then excluded.earliest_changed_date
          else least(
            publish_state.earliest_changed_date,
            excluded.earliest_changed_date
          )
        end,
        changed_at = excluded.changed_at;
end;
$$;

revoke all on function public.mark_group_activity_publish_change(uuid, uuid, date)
  from public, anon, authenticated;

create or replace function public.mark_daily_status_publish_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_changed record;
begin
  if (select auth.uid()) is null then
    return null;
  end if;

  if tg_op = 'INSERT' then
    for v_changed in
      select row.group_id, row.user_id, min(row.local_date) as since_date
        from new_status_rows row
       where coalesce(row.visibility, 'status') <> 'private'
       group by row.group_id, row.user_id
    loop
      perform public.mark_group_activity_publish_change(
        v_changed.group_id, v_changed.user_id, v_changed.since_date
      );
    end loop;
  elsif tg_op = 'UPDATE' then
    for v_changed in
      select new_row.group_id, new_row.user_id,
             min(new_row.local_date) as since_date
        from new_status_rows new_row
        join old_status_rows old_row
          on old_row.group_id = new_row.group_id
         and old_row.metric_id = new_row.metric_id
         and old_row.user_id = new_row.user_id
         and old_row.local_date = new_row.local_date
       where coalesce(new_row.visibility, 'status') <> 'private'
          or coalesce(old_row.visibility, 'status') <> 'private'
       group by new_row.group_id, new_row.user_id
    loop
      perform public.mark_group_activity_publish_change(
        v_changed.group_id, v_changed.user_id, v_changed.since_date
      );
    end loop;
  else
    for v_changed in
      select row.group_id, row.user_id, min(row.local_date) as since_date
        from old_status_rows row
       where coalesce(row.visibility, 'status') <> 'private'
       group by row.group_id, row.user_id
    loop
      perform public.mark_group_activity_publish_change(
        v_changed.group_id, v_changed.user_id, v_changed.since_date
      );
    end loop;
  end if;

  return null;
end;
$$;

create or replace function public.mark_metric_entry_publish_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_changed record;
begin
  if (select auth.uid()) is null then
    return null;
  end if;

  if tg_op = 'INSERT' then
    for v_changed in
      select definition.group_id, row.user_id, min(row.local_date) as since_date
        from new_entry_rows row
        join public.metric_definitions definition on definition.id = row.metric_id
       where definition.group_id is not null
         and row.visibility::text = 'group'
       group by definition.group_id, row.user_id
    loop
      perform public.mark_group_activity_publish_change(
        v_changed.group_id, v_changed.user_id, v_changed.since_date
      );
    end loop;
  elsif tg_op = 'UPDATE' then
    for v_changed in
      select affected.group_id, affected.user_id,
             min(affected.local_date) as since_date
        from (
          select new_definition.group_id, new_row.user_id,
                 new_row.local_date
            from new_entry_rows new_row
            join public.metric_definitions new_definition
              on new_definition.id = new_row.metric_id
           where new_definition.group_id is not null
             and new_row.visibility::text = 'group'
          union all
          select old_definition.group_id, old_row.user_id,
                 old_row.local_date
            from old_entry_rows old_row
            join public.metric_definitions old_definition
              on old_definition.id = old_row.metric_id
           where old_definition.group_id is not null
             and old_row.visibility::text = 'group'
        ) affected
       group by affected.group_id, affected.user_id
    loop
      perform public.mark_group_activity_publish_change(
        v_changed.group_id, v_changed.user_id, v_changed.since_date
      );
    end loop;
  else
    for v_changed in
      select definition.group_id, row.user_id, min(row.local_date) as since_date
        from old_entry_rows row
        join public.metric_definitions definition on definition.id = row.metric_id
       where definition.group_id is not null
         and row.visibility::text = 'group'
       group by definition.group_id, row.user_id
    loop
      perform public.mark_group_activity_publish_change(
        v_changed.group_id, v_changed.user_id, v_changed.since_date
      );
    end loop;
  end if;

  return null;
end;
$$;

create or replace function public.mark_metric_entry_tombstone_publish_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_changed record;
begin
  if (select auth.uid()) is null then
    return null;
  end if;

  if tg_op = 'INSERT' then
    for v_changed in
      select row.group_id, row.user_id, min(row.local_date) as since_date
        from new_tombstone_rows row
       where row.visibility::text = 'group'
       group by row.group_id, row.user_id
    loop
      perform public.mark_group_activity_publish_change(
        v_changed.group_id, v_changed.user_id, v_changed.since_date
      );
    end loop;
  elsif tg_op = 'UPDATE' then
    for v_changed in
      select affected.group_id, affected.user_id,
             min(affected.local_date) as since_date
        from (
          select new_row.group_id, new_row.user_id, new_row.local_date
            from new_tombstone_rows new_row
           where new_row.visibility::text = 'group'
          union all
          select old_row.group_id, old_row.user_id, old_row.local_date
            from old_tombstone_rows old_row
           where old_row.visibility::text = 'group'
        ) affected
       group by affected.group_id, affected.user_id
    loop
      perform public.mark_group_activity_publish_change(
        v_changed.group_id, v_changed.user_id, v_changed.since_date
      );
    end loop;
  else
    for v_changed in
      select row.group_id, row.user_id, min(row.local_date) as since_date
        from old_tombstone_rows row
       where row.visibility::text = 'group'
       group by row.group_id, row.user_id
    loop
      perform public.mark_group_activity_publish_change(
        v_changed.group_id, v_changed.user_id, v_changed.since_date
      );
    end loop;
  end if;

  return null;
end;
$$;

revoke all on function public.mark_daily_status_publish_change()
  from public, anon, authenticated;
revoke all on function public.mark_metric_entry_publish_change()
  from public, anon, authenticated;
revoke all on function public.mark_metric_entry_tombstone_publish_change()
  from public, anon, authenticated;

drop trigger if exists daily_status_mark_publish_insert
  on public.daily_metric_status;
create trigger daily_status_mark_publish_insert
after insert on public.daily_metric_status
referencing new table as new_status_rows
for each statement execute function public.mark_daily_status_publish_change();

drop trigger if exists daily_status_mark_publish_update
  on public.daily_metric_status;
create trigger daily_status_mark_publish_update
after update on public.daily_metric_status
referencing old table as old_status_rows new table as new_status_rows
for each statement execute function public.mark_daily_status_publish_change();

drop trigger if exists daily_status_mark_publish_delete
  on public.daily_metric_status;
create trigger daily_status_mark_publish_delete
after delete on public.daily_metric_status
referencing old table as old_status_rows
for each statement execute function public.mark_daily_status_publish_change();

drop trigger if exists metric_entries_mark_publish_insert
  on public.metric_entries;
create trigger metric_entries_mark_publish_insert
after insert on public.metric_entries
referencing new table as new_entry_rows
for each statement execute function public.mark_metric_entry_publish_change();

drop trigger if exists metric_entries_mark_publish_update
  on public.metric_entries;
create trigger metric_entries_mark_publish_update
after update on public.metric_entries
referencing old table as old_entry_rows new table as new_entry_rows
for each statement execute function public.mark_metric_entry_publish_change();

drop trigger if exists metric_entries_mark_publish_delete
  on public.metric_entries;
create trigger metric_entries_mark_publish_delete
after delete on public.metric_entries
referencing old table as old_entry_rows
for each statement execute function public.mark_metric_entry_publish_change();

drop trigger if exists metric_entry_tombstones_mark_publish_insert
  on public.metric_entry_tombstones;
create trigger metric_entry_tombstones_mark_publish_insert
after insert on public.metric_entry_tombstones
referencing new table as new_tombstone_rows
for each statement execute function public.mark_metric_entry_tombstone_publish_change();

drop trigger if exists metric_entry_tombstones_mark_publish_update
  on public.metric_entry_tombstones;
create trigger metric_entry_tombstones_mark_publish_update
after update on public.metric_entry_tombstones
referencing old table as old_tombstone_rows new table as new_tombstone_rows
for each statement execute function public.mark_metric_entry_tombstone_publish_change();

drop trigger if exists metric_entry_tombstones_mark_publish_delete
  on public.metric_entry_tombstones;
create trigger metric_entry_tombstones_mark_publish_delete
after delete on public.metric_entry_tombstones
referencing old table as old_tombstone_rows
for each statement execute function public.mark_metric_entry_tombstone_publish_change();

-- Keep the revision-bearing overload (the only one granted to clients) causal,
-- but advance the compact group version only when one of this member's shared
-- tables materially changed. A same-or-newer version written by another safe
-- server path can acknowledge the marker only when its history window covers
-- the marker's earliest date.
create or replace function public.commit_group_activity_version(
  p_group_id uuid,
  p_since_date date,
  p_expected_revision bigint
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller_id uuid := (select auth.uid());
  v_state public.group_activity_publish_state%rowtype;
  v_checkpoint public.group_activity_versions%rowtype;
  v_effective_since date;
  v_committed_version bigint;
  v_already_announced boolean := false;
  v_last_data_synced_at timestamptz;
  v_now timestamptz := clock_timestamp();
begin
  perform public.assert_account_snapshot_revision(
    v_caller_id,
    p_expected_revision
  );

  select membership.last_data_synced_at
    into v_last_data_synced_at
    from public.group_members membership
   where membership.group_id = p_group_id
     and membership.user_id = v_caller_id
     and membership.status = 'active';
  if not found then
    raise exception 'group_membership_required' using errcode = '42501';
  end if;

  -- Most legacy calls are clean. Inspect without a row lock first so a retry
  -- storm cannot serialize thousands of requests on one marker tuple.
  select publish_state.*
    into v_state
    from public.group_activity_publish_state publish_state
   where publish_state.group_id = p_group_id
     and publish_state.user_id = v_caller_id;

  if v_state.group_id is null
     or v_state.change_sequence = v_state.committed_sequence then
    select checkpoint.*
      into v_checkpoint
      from public.group_activity_versions checkpoint
     where checkpoint.group_id = p_group_id;
    if v_last_data_synced_at is null
       or v_last_data_synced_at < v_now - interval '1 minute' then
      perform public.touch_group_member_data_freshness(p_group_id);
    end if;
    return coalesce(v_checkpoint.version, 0);
  end if;

  -- A real change is consumed exactly once. Re-read under the per-member lock
  -- because another concurrent commit may have acknowledged the same marker
  -- after the optimistic check above.
  select publish_state.*
    into v_state
    from public.group_activity_publish_state publish_state
   where publish_state.group_id = p_group_id
     and publish_state.user_id = v_caller_id
   for update;

  select checkpoint.*
    into v_checkpoint
    from public.group_activity_versions checkpoint
   where checkpoint.group_id = p_group_id;
  v_committed_version := coalesce(v_checkpoint.version, 0);

  if v_state.group_id is null
     or v_state.change_sequence = v_state.committed_sequence then
    if v_last_data_synced_at is null
       or v_last_data_synced_at < v_now - interval '1 minute' then
      perform public.touch_group_member_data_freshness(p_group_id);
    end if;
    return v_committed_version;
  end if;

  v_effective_since := least(
    coalesce(p_since_date, current_date),
    coalesce(v_state.earliest_changed_date, p_since_date, current_date)
  );
  v_already_announced := v_checkpoint.group_id is not null
    and v_checkpoint.updated_at >= v_state.changed_at
    and v_checkpoint.since_date <= v_effective_since;

  if not v_already_announced then
    v_committed_version := public.commit_group_activity_version(
      p_group_id,
      v_effective_since
    );
  else
    if v_last_data_synced_at is null
       or v_last_data_synced_at < v_now - interval '1 minute' then
      perform public.touch_group_member_data_freshness(p_group_id);
    end if;
  end if;

  update public.group_activity_publish_state publish_state
     set committed_sequence = v_state.change_sequence,
         earliest_changed_date = null,
         committed_at = clock_timestamp()
   where publish_state.group_id = p_group_id
     and publish_state.user_id = v_caller_id;

  return v_committed_version;
end;
$$;

revoke all on function public.commit_group_activity_version(uuid, date, bigint)
  from public, anon, authenticated;
grant execute on function public.commit_group_activity_version(uuid, date, bigint)
  to authenticated;

comment on function public.commit_group_activity_version(uuid, date, bigint) is
  'Revision-checked activity commit that suppresses unchanged legacy full-workspace publishes while preserving every material shared mutation.';

notify pgrst, 'reload schema';
