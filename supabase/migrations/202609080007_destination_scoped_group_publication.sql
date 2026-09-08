-- Personal entries have one source identity but may have several explicitly
-- shared destinations. Keep existing owner/client uniqueness and row UUIDs;
-- namespace only the projection identity, never the personal source record.
create or replace function public.group_projection_destination(p_id text)
returns uuid language sql immutable strict parallel safe set search_path = ''
as $$
  select case when p_id ~* '^habhub-group:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}:.+$'
    then substring(p_id from 14 for 36)::uuid else null end
$$;

create or replace function public.group_projection_source_id(p_id text)
returns text language sql immutable strict parallel safe set search_path = ''
as $$
  select case when public.group_projection_destination(p_id) is not null
    then substring(p_id from 51) else p_id end
$$;

create or replace function public.group_projection_identity(p_group_id uuid, p_id text)
returns text language sql immutable strict parallel safe set search_path = ''
as $$
  select 'habhub-group:' || p_group_id::text || ':' || public.group_projection_source_id(p_id)
$$;

-- Parsing alone is not permission. Every use below also matches the actual
-- relational destination and owner; malformed/reserved-looking IDs stay raw.
revoke all on function public.group_projection_destination(text),
  public.group_projection_source_id(text), public.group_projection_identity(uuid, text)
  from public, anon;
grant execute on function public.group_projection_destination(text),
  public.group_projection_source_id(text), public.group_projection_identity(uuid, text)
  to authenticated, service_role;

create or replace function public.enforce_group_projection_identity()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare
  v_group uuid;
  v_old_group uuid;
  v_requested_group uuid;
  v_google_owned boolean := false;
begin
  if tg_table_name = 'metric_entries' then
    select definition.group_id into v_group
      from public.metric_definitions definition where definition.id = new.metric_id;
    if tg_op = 'UPDATE' then
      select definition.group_id into v_old_group
        from public.metric_definitions definition where definition.id = old.metric_id;
      if new.user_id is distinct from old.user_id or v_group is distinct from v_old_group then
        raise exception 'group_projection_destination_immutable' using errcode = '42501';
      end if;
    end if;
    -- Google has an established server-only destination projection. Do not
    -- rename its row IDs or compete with its source-record deduplication.
    v_google_owned := new.source_provider = 'google_health'
       or new.client_generated_id like 'google-health:%'
       or new.client_generated_id like 'google-health-group:%'
       or new.client_generated_id like 'google-health-group-detail:%';
  else
    v_group := new.group_id;
    if tg_op = 'UPDATE' and (
      new.owner_user_id is distinct from old.owner_user_id
      or new.group_id is distinct from old.group_id
    ) then
      raise exception 'group_projection_destination_immutable' using errcode = '42501';
    end if;
  end if;
  if v_group is null or new.client_generated_id is null then return new; end if;
  if auth.uid() is not null and not exists (
    select 1 from public.group_members member
     where member.group_id = v_group and member.user_id = auth.uid() and member.status = 'active'
  ) then
    raise exception 'active_group_publication_required' using errcode = '42501';
  end if;
  v_requested_group := public.group_projection_destination(new.client_generated_id);
  if v_requested_group is not null and v_requested_group <> v_group then
    raise exception 'group_projection_identity_mismatch' using errcode = '22023';
  end if;
  if coalesce(v_google_owned, false) then return new; end if;
  new.client_generated_id := public.group_projection_identity(v_group, new.client_generated_id);
  return new;
end;
$$;
revoke all on function public.enforce_group_projection_identity() from public, anon, authenticated;

create trigger a0_metric_entries_scope_identity
before insert or update on public.metric_entries
for each row execute function public.enforce_group_projection_identity();
create trigger a0_photo_updates_scope_identity
before insert or update on public.photo_updates
for each row execute function public.enforce_group_projection_identity();

-- Keep namespace-only migration updates invisible to modification timestamps
-- and workspace notifications. Real content/privacy writes retain all guards.
create or replace function public.touch_metric_entry_updated_at_if_changed()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_crosses_privacy_fence boolean := false;
begin
  -- A service migration changes only the projection namespace, not the log.
  if auth.uid() is null
     and public.group_projection_destination(new.client_generated_id) is not null
     and public.group_projection_source_id(new.client_generated_id) = public.group_projection_source_id(old.client_generated_id)
     and (to_jsonb(new) - array['client_generated_id', 'updated_at'])
       is not distinct from (to_jsonb(old) - array['client_generated_id', 'updated_at']) then
    new.updated_at := old.updated_at;
    return new;
  end if;
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

create or replace function public.broadcast_group_workspace_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_group_id uuid := case when tg_op = 'DELETE'
    then old.group_id else new.group_id end;
begin
  if tg_table_name = 'photo_updates' and tg_op = 'UPDATE' and auth.uid() is null then
    if public.group_projection_destination(new.client_generated_id) is not null
       and public.group_projection_source_id(new.client_generated_id) = public.group_projection_source_id(old.client_generated_id)
       and (to_jsonb(new) - 'client_generated_id') is not distinct from (to_jsonb(old) - 'client_generated_id') then
      return new;
    end if;
  end if;
  if v_group_id is not null then
    begin
      perform realtime.send(
        jsonb_build_object('entity', tg_table_name, 'operation', tg_op),
        'workspace_updated',
        'group:' || v_group_id::text || ':workspace',
        true
      );
    exception when others then
      raise warning 'HabHub workspace broadcast failed for %', tg_table_name;
    end;
  end if;
  if tg_op = 'DELETE' then return old; else return new; end if;
end;
$$;


-- In-place rekeying preserves canonical metric-entry UUID social targets.
-- Photo engagement intentionally keeps its original source ID inside its
-- existing group namespace; its resolvers are upgraded below, not its rows.
update public.metric_entries entry
   set client_generated_id = public.group_projection_identity(definition.group_id, entry.client_generated_id)
  from public.metric_definitions definition
 where definition.id = entry.metric_id and definition.group_id is not null
   and entry.source_provider is distinct from 'google_health'
   and entry.client_generated_id not like 'google-health:%'
   and entry.client_generated_id not like 'google-health-group:%'
   and entry.client_generated_id not like 'google-health-group-detail:%'
   and public.group_projection_destination(entry.client_generated_id) is null;
update public.photo_updates photo
   set client_generated_id = public.group_projection_identity(photo.group_id, photo.client_generated_id)
 where photo.group_id is not null and photo.client_generated_id is not null
   and public.group_projection_destination(photo.client_generated_id) is null;
update public.metric_entry_tombstones tombstone
   set client_generated_id = public.group_projection_identity(tombstone.group_id, tombstone.client_generated_id)
 where tombstone.client_generated_id not like 'google-health:%'
   and tombstone.client_generated_id not like 'google-health-group:%'
   and tombstone.client_generated_id not like 'google-health-group-detail:%'
   and public.group_projection_destination(tombstone.client_generated_id) is null;

create index metric_entries_owner_source_projection_idx
  on public.metric_entries (user_id, public.group_projection_source_id(client_generated_id));
create index photo_updates_owner_source_projection_idx
  on public.photo_updates (owner_user_id, public.group_projection_source_id(client_generated_id));
create index photo_updates_group_source_projection_idx
  on public.photo_updates (group_id, public.group_projection_source_id(client_generated_id));
create index metric_entries_metric_source_projection_idx
  on public.metric_entries (metric_id, public.group_projection_source_id(client_generated_id));
create index metric_tombstones_owner_source_projection_idx
  on public.metric_entry_tombstones (user_id, public.group_projection_source_id(client_generated_id));

-- Keep the canonical deletion/tombstone/empty-summary transaction. A raw
-- source ID withdraws that owner's copies everywhere; a scoped ID affects
-- exactly one destination. Equality, not wildcard suffix matching, is used.
do $patch$
declare v_definition text; v_old text := 'entry.client_generated_id = any(p_client_generated_ids)';
begin
  select pg_catalog.pg_get_functiondef('public.delete_group_metric_entries(text[])'::regprocedure)
    into v_definition;
  if (length(v_definition) - length(replace(v_definition, v_old, ''))) / length(v_old) <> 1 then
    raise exception 'Unexpected canonical entry deletion definition';
  end if;
  execute replace(v_definition, v_old, $replacement$(
        entry.client_generated_id = any(p_client_generated_ids)
        or public.group_projection_source_id(entry.client_generated_id) = any(array(
          select requested from unnest(p_client_generated_ids) requested
           where public.group_projection_destination(requested) is null
        ))
      )$replacement$);
end;
$patch$;

create or replace function public.delete_group_metric_entries(
  p_client_generated_ids text[], p_expected_revision bigint
)
returns table(deleted_client_generated_id text, deleted_local_date date)
language plpgsql security definer set search_path = ''
as $$
begin
  perform public.assert_account_snapshot_revision(auth.uid(), p_expected_revision);
  if cardinality(coalesce(p_client_generated_ids, array[]::text[])) > 1000 then
    raise exception 'At most 1000 source deletions per request' using errcode = '22023';
  end if;
  return query
    with requested as materialized (
      select distinct requested_id from unnest(coalesce(p_client_generated_ids, array[]::text[])) requested(requested_id)
       where requested_id is not null and btrim(requested_id) <> ''
    ), removed as materialized (
      select deletion.* from public.delete_group_metric_entries(array(select requested_id from requested)) deletion
    )
    select requested.requested_id, min(removed.deleted_local_date)
      from requested left join removed on
        removed.deleted_client_generated_id = requested.requested_id
        or (public.group_projection_destination(requested.requested_id) is null
            and public.group_projection_source_id(removed.deleted_client_generated_id) = requested.requested_id)
     group by requested.requested_id;
end;
$$;

create or replace function public.clear_group_metric_entry_tombstones(
  p_client_generated_ids text[], p_expected_revision bigint
)
returns void language plpgsql security definer set search_path = ''
as $$
begin
  perform public.assert_account_snapshot_revision(auth.uid(), p_expected_revision);
  if cardinality(coalesce(p_client_generated_ids, array[]::text[])) > 1000 then
    raise exception 'At most 1000 source IDs per request' using errcode = '22023';
  end if;
  delete from public.metric_entry_tombstones tombstone
   where tombstone.user_id = auth.uid()
     and (tombstone.client_generated_id = any(p_client_generated_ids)
       or public.group_projection_source_id(tombstone.client_generated_id) = any(array(
         select requested from unnest(p_client_generated_ids) requested
          where public.group_projection_destination(requested) is null
       )));
end;
$$;

create or replace function public.delete_group_photo_updates(
  p_client_generated_ids text[], p_group_id uuid, p_expected_revision bigint
)
returns text[] language plpgsql security definer set search_path = ''
as $$
declare v_ids text[];
begin
  perform public.assert_account_snapshot_revision(auth.uid(), p_expected_revision);
  if cardinality(coalesce(p_client_generated_ids, array[]::text[])) > 1000 then
    raise exception 'At most 1000 photo source IDs per request' using errcode = '22023';
  end if;
  with removed as (
    delete from public.photo_updates photo
     where photo.owner_user_id = auth.uid()
       and (p_group_id is null or photo.group_id = p_group_id)
       and (photo.client_generated_id = any(p_client_generated_ids)
         or public.group_projection_source_id(photo.client_generated_id) = any(array(
           select requested from unnest(p_client_generated_ids) requested
            where public.group_projection_destination(requested) is null
         )))
    returning photo.client_generated_id
  ) select coalesce(array_agg(client_generated_id), array[]::text[]) into v_ids from removed;
  return v_ids;
end;
$$;

-- A tracker restriction belongs to the account, not its selected workspace.
-- Remove exact relational/media access atomically, including historical rows
-- outside the client's bounded ordinary publish window; preserve source data
-- in the private account snapshot. An allowed status-only projection can then
-- be republished by the normal causal queue without leaking exact history.
alter table public.metric_privacy_cache_fences
  add column withdrawal_revision bigint not null default 0
    check (withdrawal_revision >= 0 and withdrawal_revision <= revision);
comment on column public.metric_privacy_cache_fences.withdrawal_revision is
  'Highest revision whose explicit account-wide relational withdrawal completed; contains no health value, date or history metadata.';

create or replace function public.enforce_group_exact_projection_privacy()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare v_group uuid; v_metric uuid; v_user uuid;
begin
  if new.visibility::text <> 'group' then return new; end if;
  if tg_table_name = 'metric_entries' then
    v_metric := new.metric_id; v_user := new.user_id;
    select definition.group_id into v_group from public.metric_definitions definition where definition.id = v_metric;
  elsif tg_table_name = 'daily_metric_status' then
    v_metric := new.metric_id; v_user := new.user_id; v_group := new.group_id;
  else
    v_user := new.owner_user_id; v_group := new.group_id;
    select definition.id into v_metric from public.metric_definitions definition
     where definition.group_id = v_group and definition.slug = 'progress_photo' and definition.archived_at is null;
  end if;
  if exists (
    select 1 from public.metric_privacy_cache_fences fence
     where fence.group_id = v_group and fence.metric_id = v_metric and fence.user_id = v_user
       and (new.account_revision is null or new.account_revision <= fence.revision)
  ) then
    -- Acknowledge older clients safely instead of entering a retry loop. The
    -- next normal committed account revision can repair permitted exact rows.
    -- Fresh status-only summaries are intentionally not downgraded here.
    new.visibility := 'private';
  end if;
  return new;
end;
$$;
revoke all on function public.enforce_group_exact_projection_privacy() from public, anon, authenticated;
create trigger a1_metric_entries_exact_privacy before insert or update on public.metric_entries
for each row execute function public.enforce_group_exact_projection_privacy();
create trigger a1_daily_status_exact_privacy before insert or update on public.daily_metric_status
for each row execute function public.enforce_group_exact_projection_privacy();
create trigger a1_photo_updates_exact_privacy before insert or update on public.photo_updates
for each row execute function public.enforce_group_exact_projection_privacy();

create or replace function public.advance_metric_privacy_cache_fences(
  p_group_id uuid, p_metric_ids uuid[], p_expected_revision bigint
)
returns void language plpgsql security definer set search_path = ''
as $$
declare v_user uuid := auth.uid(); v_target record; v_requested integer; v_authorized integer; v_withdraw boolean;
begin
  if v_user is null or not public.is_group_member(p_group_id) then
    raise exception 'metric_privacy_fence_forbidden' using errcode = '42501';
  end if;
  perform public.assert_account_snapshot_revision(v_user, p_expected_revision);
  if cardinality(coalesce(p_metric_ids, array[]::uuid[])) > 1000 then
    raise exception 'At most 1000 tracker restrictions per request' using errcode = '22023';
  end if;
  select count(distinct requested) into v_requested from unnest(coalesce(p_metric_ids, array[]::uuid[])) requested;
  select count(distinct definition.id) into v_authorized from public.metric_definitions definition
   where definition.id = any(p_metric_ids) and definition.group_id = p_group_id and definition.archived_at is null;
  if v_requested <> v_authorized then
    raise exception 'metric_privacy_fence_metric_mismatch' using errcode = '22023';
  end if;
  for v_target in
    select distinct target.id, target.group_id, target.slug
      from public.metric_definitions source
      join public.metric_definitions target on target.slug = source.slug and target.archived_at is null
      join public.group_members member on member.group_id = target.group_id
       and member.user_id = v_user and member.status = 'active'
     where source.id = any(p_metric_ids) and source.group_id = p_group_id and source.archived_at is null
     order by target.group_id, target.id
  loop
    perform public.advance_metric_privacy_cache_fence_internal(v_target.group_id, v_target.id, v_user, p_expected_revision);
    -- A legacy row-level privacy trigger may already have advanced the fence
    -- without withdrawing other historical rows. Track explicit withdrawal
    -- independently; lock/mark it in this transaction before touching values.
    v_withdraw := false;
    update public.metric_privacy_cache_fences fence
       set withdrawal_revision = p_expected_revision
     where fence.group_id = v_target.group_id and fence.metric_id = v_target.id and fence.user_id = v_user
       and fence.revision = p_expected_revision and fence.withdrawal_revision < p_expected_revision
    returning true into v_withdraw;
    if coalesce(v_withdraw, false) then
      update public.metric_entries set visibility = 'private', account_revision = p_expected_revision
       where user_id = v_user and metric_id = v_target.id and visibility::text = 'group'
         and (account_revision is null or account_revision <= p_expected_revision);
      update public.daily_metric_status set visibility = 'private', account_revision = p_expected_revision
       where user_id = v_user and group_id = v_target.group_id and metric_id = v_target.id
         and visibility::text <> 'private' and (account_revision is null or account_revision <= p_expected_revision);
      if v_target.slug = 'progress_photo' then
        update public.photo_updates set visibility = 'private', account_revision = p_expected_revision
         where owner_user_id = v_user and group_id = v_target.group_id and visibility::text = 'group'
           and (account_revision is null or account_revision <= p_expected_revision);
      end if;
    end if;
  end loop;
end;
$$;

revoke all on function public.delete_group_metric_entries(text[], bigint),
  public.clear_group_metric_entry_tombstones(text[], bigint),
  public.delete_group_photo_updates(text[], uuid, bigint),
  public.advance_metric_privacy_cache_fences(uuid, uuid[], bigint)
  from public, anon, service_role;
grant execute on function public.delete_group_metric_entries(text[], bigint),
  public.clear_group_metric_entry_tombstones(text[], bigint),
  public.delete_group_photo_updates(text[], uuid, bigint),
  public.advance_metric_privacy_cache_fences(uuid, uuid[], bigint)
  to authenticated;

-- Narrow, count-checked replacements preserve the current social policy,
-- moderation, challenge and notification logic. Legacy photo social IDs stay
-- source IDs in their group; metric social IDs stay relational entry UUIDs.
do $patch$
declare v_signature text; v_definition text; v_old text; v_new text;
begin
  foreach v_signature in array array[
    'public.resolve_group_social_metric_entry_id(uuid,text)',
    'public.valid_group_social_target(uuid,text,text)',
    'public.resolve_group_social_notification_target(uuid,text,text)'
  ] loop
    select pg_catalog.pg_get_functiondef(v_signature::regprocedure) into v_definition;
    v_old := case when v_signature like '%resolve_group_social_metric_entry_id%'
      then 'entry.client_generated_id = p_target_id' else 'photo.client_generated_id = p_target_id' end;
    v_new := case when v_signature like '%resolve_group_social_metric_entry_id%'
      then '(entry.client_generated_id = p_target_id or ((public.group_projection_destination(p_target_id) is null or public.group_projection_destination(p_target_id) = p_group_id) and public.group_projection_source_id(entry.client_generated_id) = public.group_projection_source_id(p_target_id)))'
      else '(photo.client_generated_id = p_target_id or ((public.group_projection_destination(p_target_id) is null or public.group_projection_destination(p_target_id) = p_group_id) and public.group_projection_source_id(photo.client_generated_id) = public.group_projection_source_id(p_target_id)))' end;
    if (length(v_definition) - length(replace(v_definition, v_old, ''))) / length(v_old) <> 1 then
      raise exception 'Unexpected social identity definition: %', v_signature;
    end if;
    execute replace(v_definition, v_old, v_new);
  end loop;
  select pg_catalog.pg_get_functiondef('public.set_group_social_reaction(uuid,text,text,text,text)'::regprocedure) into v_definition;
  v_old := 'v_canonical_target_id text := p_target_id;';
  v_new := 'v_canonical_target_id text := case when p_target_type = ''photo_update'' and public.group_projection_destination(p_target_id) = p_group_id then public.group_projection_source_id(p_target_id) else p_target_id end;';
  if (length(v_definition) - length(replace(v_definition, v_old, ''))) / length(v_old) <> 1 then
    raise exception 'Unexpected reaction identity definition';
  end if;
  execute replace(v_definition, v_old, v_new);
  select pg_catalog.pg_get_functiondef('public.enqueue_group_lead_push_event(uuid,text,text[])'::regprocedure) into v_definition;
  v_old := 'entry.client_generated_id = any(v_ids)';
  v_new := '(entry.client_generated_id = any(v_ids) or public.group_projection_source_id(entry.client_generated_id) = any(array(select requested from unnest(v_ids) requested where public.group_projection_destination(requested) is null)))';
  if (length(v_definition) - length(replace(v_definition, v_old, ''))) / length(v_old) <> 1 then
    raise exception 'Unexpected lead notification source identity definition';
  end if;
  execute replace(v_definition, v_old, v_new);
end;
$patch$;

create or replace function public.canonicalize_group_social_metric_target()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare v_entry_id uuid;
begin
  if new.target_type = 'photo_update' and public.group_projection_destination(new.target_id) = new.group_id then
    new.target_id := public.group_projection_source_id(new.target_id);
  elsif new.target_type = 'metric_entry' then
    v_entry_id := public.resolve_group_social_metric_entry_id(new.group_id, new.target_id);
    if v_entry_id is not null then new.target_id := v_entry_id::text; end if;
  end if;
  return new;
end;
$$;

notify pgrst, 'reload schema';
