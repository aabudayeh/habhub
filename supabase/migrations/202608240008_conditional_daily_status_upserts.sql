-- Avoid rewriting the entire recent leaderboard matrix when only one tracker
-- changed. The client intentionally republishes a small two-day projection so
-- reconnects and time-derived metrics self-heal, but ordinary PostgREST upsert
-- updates every conflicting row. That churns daily_metric_status, runs its
-- privacy/revision triggers, and wakes Realtime even when the projection is
-- byte-for-byte equivalent.
--
-- This remains SECURITY INVOKER: the existing INSERT/UPDATE RLS policies and
-- all privacy/revision triggers are still authoritative. Only a materially
-- changed projection performs an UPDATE. A newer account_revision alone is not
-- normally material. It is material when it carries an exact re-share past a
-- privacy cache fence: without that narrow exception, peers would keep hiding
-- an otherwise unchanged group-visible row behind the older fence forever.
create or replace function public.upsert_daily_metric_status_rows_if_changed(
  p_rows jsonb
)
returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_changed integer := 0;
begin
  if p_rows is null or pg_catalog.jsonb_typeof(p_rows) <> 'array' then
    raise exception 'Daily status rows must be a JSON array.'
      using errcode = '22023';
  end if;
  if pg_catalog.jsonb_array_length(p_rows) > 500 then
    raise exception 'Daily status batch exceeds 500 rows.'
      using errcode = '22023';
  end if;

  with incoming as (
    select row.*
      from pg_catalog.jsonb_to_recordset(p_rows) as row(
        group_id uuid,
        metric_id uuid,
        user_id uuid,
        local_date date,
        goal_reached boolean,
        score_contribution numeric,
        goal_progress numeric,
        goal_kind text,
        goal_target numeric,
        visibility text,
        goal_eligible boolean,
        exact_value numeric,
        has_data boolean,
        account_revision bigint,
        privacy_projection_version smallint,
        source_provider text
      )
  ), changed as (
    insert into public.daily_metric_status as current_status (
      group_id,
      metric_id,
      user_id,
      local_date,
      goal_reached,
      score_contribution,
      goal_progress,
      goal_kind,
      goal_target,
      visibility,
      goal_eligible,
      exact_value,
      has_data,
      account_revision,
      privacy_projection_version,
      source_provider
    )
    select
      incoming.group_id,
      incoming.metric_id,
      incoming.user_id,
      incoming.local_date,
      incoming.goal_reached,
      incoming.score_contribution,
      incoming.goal_progress,
      incoming.goal_kind,
      incoming.goal_target,
      incoming.visibility,
      incoming.goal_eligible,
      incoming.exact_value,
      incoming.has_data,
      incoming.account_revision,
      incoming.privacy_projection_version,
      incoming.source_provider
    from incoming
    on conflict (group_id, metric_id, user_id, local_date) do update
      set goal_reached = excluded.goal_reached,
          score_contribution = excluded.score_contribution,
          goal_progress = excluded.goal_progress,
          goal_kind = excluded.goal_kind,
          goal_target = excluded.goal_target,
          visibility = excluded.visibility,
          goal_eligible = excluded.goal_eligible,
          exact_value = excluded.exact_value,
          has_data = excluded.has_data,
          account_revision = excluded.account_revision,
          privacy_projection_version = excluded.privacy_projection_version,
          source_provider = excluded.source_provider
    where (
      row(
        current_status.goal_reached,
        current_status.score_contribution,
        current_status.goal_progress,
        current_status.goal_kind,
        current_status.goal_target,
        current_status.visibility,
        current_status.goal_eligible,
        current_status.exact_value,
        current_status.has_data,
        current_status.privacy_projection_version,
        current_status.source_provider
      ) is distinct from row(
        excluded.goal_reached,
        excluded.score_contribution,
        excluded.goal_progress,
        excluded.goal_kind,
        excluded.goal_target,
        excluded.visibility,
        excluded.goal_eligible,
        excluded.exact_value,
        excluded.has_data,
        excluded.privacy_projection_version,
        excluded.source_provider
      )
      or (
        excluded.visibility = 'group'
        and excluded.account_revision > coalesce(current_status.account_revision, 0)
        and exists (
          select 1
            from public.metric_privacy_cache_fences fence
           where fence.group_id = current_status.group_id
             and fence.metric_id = current_status.metric_id
             and fence.user_id = current_status.user_id
             and fence.revision >= coalesce(current_status.account_revision, 0)
             and excluded.account_revision > fence.revision
        )
      )
    )
    returning 1
  )
  select pg_catalog.count(*)::integer into v_changed from changed;

  return v_changed;
end;
$$;

revoke all on function public.upsert_daily_metric_status_rows_if_changed(jsonb)
  from public, anon, authenticated;
grant execute on function public.upsert_daily_metric_status_rows_if_changed(jsonb)
  to authenticated, service_role;

comment on function public.upsert_daily_metric_status_rows_if_changed(jsonb) is
  'RLS-preserving conditional upsert for compact leaderboard status batches; returns materially inserted or updated row count.';

-- A successful no-change pass is still useful freshness information, but it
-- must not increment group_activity_versions and wake every peer into another
-- no-op refresh. The owner identity is taken only from the authenticated JWT;
-- callers cannot stamp another member or a pending/removed membership. A
-- server-side one-minute floor also contains accidental retry loops.
create or replace function public.touch_group_member_data_freshness(
  p_group_id uuid
)
returns timestamptz
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller_id uuid := (select auth.uid());
  v_previous timestamptz;
  v_touched_at timestamptz := clock_timestamp();
begin
  if v_caller_id is null or p_group_id is null then
    raise exception 'group_membership_required' using errcode = '42501';
  end if;

  select membership.last_data_synced_at
    into v_previous
    from public.group_members membership
   where membership.group_id = p_group_id
     and membership.user_id = v_caller_id
     and membership.status = 'active'
   for update;
  if not found then
    raise exception 'group_membership_required' using errcode = '42501';
  end if;

  if v_previous is null or v_previous < v_touched_at - interval '1 minute' then
    update public.group_members membership
       set last_data_synced_at = v_touched_at
     where membership.group_id = p_group_id
       and membership.user_id = v_caller_id;
  else
    v_touched_at := v_previous;
  end if;
  return v_touched_at;
end;
$$;

revoke all on function public.touch_group_member_data_freshness(uuid)
  from public, anon, authenticated;
grant execute on function public.touch_group_member_data_freshness(uuid)
  to authenticated;

comment on function public.touch_group_member_data_freshness(uuid) is
  'Rate-limited freshness stamp for the authenticated active member after a successful no-change activity publish.';

notify pgrst, 'reload schema';
