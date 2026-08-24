-- Close the remaining causality and authorization edges in the legacy publish
-- containment ledger. A group checkpoint timestamp cannot acknowledge a
-- member mutation: the mutation may still be uncommitted when another writer
-- advances the checkpoint. Every dirty member sequence therefore owns one
-- version bump before it can be marked committed.

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
  -- Trusted service projections publish their own coherent version marker.
  if v_caller_id is null then
    return;
  end if;

  if p_group_id is null or p_user_id is distinct from v_caller_id then
    raise exception 'group_activity_publish_forbidden' using errcode = '42501';
  end if;

  -- The owner-only entry policies intentionally permit private account rows,
  -- but no removed/pending member may inject a group-visible projection by
  -- retaining an old metric UUID. This AFTER-trigger exception rolls the
  -- attempted shared mutation back atomically.
  if not exists (
    select 1
      from public.group_members membership
     where membership.group_id = p_group_id
       and membership.user_id = v_caller_id
       and membership.status = 'active'
  ) then
    raise exception 'group_membership_required' using errcode = '42501';
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

-- OLD and NEW identity columns are independently material. Joining transition
-- rows on the mutable daily-status primary key misses a date/metric/group move
-- entirely, leaving the old cached projection without an invalidation.
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
      select changed.group_id, changed.user_id,
             min(changed.local_date) as since_date
        from (
          select new_row.group_id, new_row.user_id, new_row.local_date
            from new_status_rows new_row
           where coalesce(new_row.visibility, 'status') <> 'private'
          union all
          select old_row.group_id, old_row.user_id, old_row.local_date
            from old_status_rows old_row
           where coalesce(old_row.visibility, 'status') <> 'private'
        ) changed
       group by changed.group_id, changed.user_id
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

revoke all on function public.mark_daily_status_publish_change()
  from public, anon, authenticated;

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

  -- Clean legacy retries avoid contending on the marker row.
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

  -- Serialize only a genuine pending change. A concurrent mutation blocks on
  -- this row, increments the sequence after this commit, and is consumed by
  -- its own subsequent commit request.
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

  -- Never infer causality from wall-clock order. The member's exact dirty
  -- sequence owns this checkpoint even when another writer just published a
  -- broader/newer group version.
  v_committed_version := public.commit_group_activity_version(
    p_group_id,
    v_effective_since
  );

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
  'Revision-checked material activity commit; each member dirty sequence causally owns one compact group-version invalidation.';

notify pgrst, 'reload schema';
