begin;

-- A reset keeps the auth identity, memberships, and already-shared group
-- content. It replaces the private owner snapshot and removes private/device
-- state under the same durable lease used by full account deletion.

create or replace function public.habhub_reject_guarded_snapshot_reference()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_previous_reset timestamptz;
  v_incoming_reset timestamptz;
  v_reset_user_id text;
  v_reset_attempt_id text;
begin
  -- A reset marker may never disappear or move backwards, including on the
  -- narrowly-authorized server write below. This keeps stale offline clients
  -- from resurrecting the pre-reset private snapshot after the lease ends.
  if tg_op = 'UPDATE' then
    v_previous_reset := old.payload #>> '{settings,accountDataResetAt}';
    v_incoming_reset := new.payload #>> '{settings,accountDataResetAt}';
    if v_previous_reset is not null
       and (
         v_incoming_reset is null
         or v_incoming_reset < v_previous_reset
       ) then
      raise exception 'habhub_account_reset_stale' using errcode = '40001';
    end if;
  end if;

  -- The reset RPC sets these transaction-local markers immediately around its
  -- one owner-snapshot upsert. Service-role writes outside that exact RPC,
  -- user, and live attempt continue through the normal deletion guard below.
  -- Do not replace this with a broad service_role bypass: full account
  -- deletion relies on this trigger fencing concurrent administrative writes.
  v_reset_user_id := pg_catalog.current_setting(
    'habhub.account_reset_user_id',
    true
  );
  v_reset_attempt_id := pg_catalog.current_setting(
    'habhub.account_reset_attempt_id',
    true
  );
  if (select auth.role()) is not distinct from 'service_role'
     and v_reset_user_id = new.user_id::text
     and exists (
       select 1
       from public.google_health_account_deletion_guards guard
       where guard.user_id = new.user_id
         and guard.attempt_id::text = v_reset_attempt_id
         and guard.lease_until > now()
     ) then
    return new;
  end if;

  if exists (
    select 1
    from public.google_health_account_deletion_guards guard
    where pg_catalog.strpos(new.payload::text, guard.user_id::text) > 0
  ) then
    raise exception 'habhub_account_deleting' using errcode = '55000';
  end if;
  return new;
end;
$$;

revoke all on function public.habhub_reject_guarded_snapshot_reference()
  from public, anon, authenticated;

create index if not exists metric_entries_owner_private_reset_idx
  on public.metric_entries (user_id, visibility, source, source_provider);
create index if not exists daily_metric_status_owner_private_reset_idx
  on public.daily_metric_status (user_id, visibility, source_provider);
create index if not exists photo_updates_owner_private_reset_idx
  on public.photo_updates (owner_user_id, visibility);

create or replace function public.reset_account_private_data(
  p_user_id uuid,
  p_attempt_id uuid,
  p_payload jsonb,
  p_device_id text,
  p_schema_version integer,
  p_reset_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_guard_count bigint := 0;
  v_revision bigint := 0;
  v_updated_at timestamptz;
  v_payload_reset_at timestamptz;
  v_existing_reset_at timestamptz;
  v_retained_media_paths text[] := array[]::text[];
  v_private_entry_count bigint := 0;
  v_private_photo_count bigint := 0;
  v_health_status_count bigint := 0;
begin
  if (select auth.role()) is distinct from 'service_role' then
    raise exception 'habhub_service_role_required' using errcode = '42501';
  end if;
  if p_user_id is null
     or p_attempt_id is null
     or p_reset_at is null
     or not exists (
       select 1 from auth.users account where account.id = p_user_id
     ) then
    raise exception 'habhub_account_reset_attempt_lost' using errcode = '55000';
  end if;
  if p_payload is null
     or pg_catalog.jsonb_typeof(p_payload) <> 'object'
     or pg_catalog.pg_column_size(p_payload) > 33554432
     or p_payload ->> 'currentUserId' is distinct from p_user_id::text
     or coalesce((p_payload ->> 'version')::integer, -1) <> 27
     or p_schema_version <> 27
     or p_device_id is null
     or pg_catalog.char_length(p_device_id) not between 8 and 200 then
    raise exception 'habhub_account_reset_payload_invalid' using errcode = '22023';
  end if;
  begin
    v_payload_reset_at := (
      p_payload #>> '{settings,accountDataResetAt}'
    )::timestamptz;
  exception when others then
    raise exception 'habhub_account_reset_payload_invalid' using errcode = '22023';
  end;
  if v_payload_reset_at is distinct from p_reset_at then
    raise exception 'habhub_account_reset_payload_invalid' using errcode = '22023';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_user_id::text, 744218)
  );
  update public.google_health_account_deletion_guards guard
  set lease_until = now() + interval '10 minutes'
  where guard.user_id = p_user_id
    and guard.attempt_id = p_attempt_id;
  get diagnostics v_guard_count = row_count;
  if v_guard_count <> 1 then
    raise exception 'habhub_account_reset_attempt_lost' using errcode = '55000';
  end if;

  begin
    select (snapshot.payload #>> '{settings,accountDataResetAt}')::timestamptz
      into v_existing_reset_at
      from public.user_snapshots snapshot
     where snapshot.user_id = p_user_id
     for update;
  exception when others then
    raise exception 'habhub_account_reset_snapshot_invalid' using errcode = '55000';
  end;
  if v_existing_reset_at is not null and v_existing_reset_at > p_reset_at then
    raise exception 'habhub_account_reset_stale' using errcode = '40001';
  end if;

  -- Other members may have cached exact rows already. Publish a value-free
  -- tombstone before deleting any native/imported health row that was shared.
  insert into public.metric_entry_tombstones (
    group_id,
    user_id,
    client_generated_id,
    local_date,
    visibility,
    deleted_at
  )
  select
    metric.group_id,
    entry.user_id,
    entry.client_generated_id,
    entry.local_date,
    entry.visibility,
    clock_timestamp()
  from public.metric_entries entry
  join public.metric_definitions metric on metric.id = entry.metric_id
  where entry.user_id = p_user_id
    and (entry.source = 'imported' or entry.source_provider is not null)
    and entry.visibility <> 'private'
    and metric.group_id is not null
  on conflict (user_id, client_generated_id) do update
    set group_id = excluded.group_id,
        local_date = excluded.local_date,
        visibility = excluded.visibility,
        deleted_at = excluded.deleted_at;

  -- Remove generic social rows attached to content that will cease to exist;
  -- interactions on retained shared manual rows/photos remain unchanged.
  delete from public.group_social_reactions reaction
  where (
      reaction.target_type = 'metric_entry'
      and exists (
        select 1
        from public.metric_entries entry
        where entry.user_id = p_user_id
          and (
            entry.visibility = 'private'
            or entry.source = 'imported'
            or entry.source_provider is not null
          )
          and entry.id::text = reaction.target_id
      )
    )
    or (
      reaction.target_type = 'photo_update'
      and exists (
        select 1
        from public.photo_updates photo
        where photo.owner_user_id = p_user_id
          and photo.visibility = 'private'
          and photo.client_generated_id = reaction.target_id
      )
    );
  delete from public.group_social_comments comment
  where (
      comment.target_type = 'metric_entry'
      and exists (
        select 1
        from public.metric_entries entry
        where entry.user_id = p_user_id
          and (
            entry.visibility = 'private'
            or entry.source = 'imported'
            or entry.source_provider is not null
          )
          and entry.id::text = comment.target_id
      )
    )
    or (
      comment.target_type = 'photo_update'
      and exists (
        select 1
        from public.photo_updates photo
        where photo.owner_user_id = p_user_id
          and photo.visibility = 'private'
          and photo.client_generated_id = comment.target_id
      )
    );

  delete from public.metric_entries entry
   where entry.user_id = p_user_id
     and (
       entry.visibility = 'private'
       or entry.source = 'imported'
       or entry.source_provider is not null
     );
  get diagnostics v_private_entry_count = row_count;

  delete from public.daily_metric_status status
   where status.user_id = p_user_id
     and (
       status.visibility = 'private'
       or status.source_provider is not null
     );
  get diagnostics v_health_status_count = row_count;

  delete from public.photo_updates photo
   where photo.owner_user_id = p_user_id
     and photo.visibility = 'private';
  get diagnostics v_private_photo_count = row_count;

  delete from public.metric_goals goal where goal.user_id = p_user_id;
  delete from public.tracked_goal_periods period where period.user_id = p_user_id;
  delete from public.dashboard_layouts layout where layout.user_id = p_user_id;
  delete from public.energy_profiles profile where profile.user_id = p_user_id;
  delete from public.member_aliases alias where alias.owner_user_id = p_user_id;
  delete from public.group_member_aliases alias where alias.owner_user_id = p_user_id;
  delete from public.notification_preferences preference where preference.user_id = p_user_id;
  delete from public.health_connections connection where connection.user_id = p_user_id;
  delete from public.health_sync_cursors cursor where cursor.user_id = p_user_id;
  delete from public.account_devices device where device.user_id = p_user_id;
  delete from public.group_notification_events event where event.recipient_id = p_user_id;
  delete from public.group_challenge_notification_state state
   where state.recipient_id = p_user_id;
  delete from public.push_dispatch_events event
   where event.recipient_id = p_user_id;
  delete from public.user_blocks block where block.blocker_id = p_user_id;
  delete from public.badge_showcases showcase where showcase.user_id = p_user_id;

  delete from public.web_personal_notification_schedule schedule
   where schedule.user_id = p_user_id;
  delete from public.web_push_subscriptions subscription
   where subscription.user_id = p_user_id;
  delete from public.push_token_dispatch_acceptances acceptance
   where acceptance.user_id = p_user_id
     and acceptance.token in (
     select token.token
     from public.device_push_tokens token
     where token.user_id = p_user_id
   );
  delete from public.expo_push_receipts receipt where receipt.user_id = p_user_id;
  delete from public.device_push_tokens token where token.user_id = p_user_id;

  -- Hidden/pinned are private presentation preferences. Withdrawal is a
  -- shared challenge decision and must survive an account-data reset.
  update public.group_challenge_user_preferences preference
     set hidden = false,
         pinned = false,
         updated_at = clock_timestamp()
   where preference.user_id = p_user_id;
  -- Live public-challenge totals are derived from the account snapshot and can
  -- contain imported health values. Clear every mutable projection marker so
  -- a pending occurrence cannot settle from pre-reset data. Immutable result
  -- placements for already-settled occurrences remain shared history.
  delete from public.public_challenge_totals total
   where total.user_id = p_user_id;
  delete from public.public_challenge_participant_syncs sync
   where sync.user_id = p_user_id;
  delete from public.public_challenge_occurrence_syncs sync
   where sync.user_id = p_user_id;
  delete from public.public_challenge_snapshot_daily_cache cache
   where cache.user_id = p_user_id;
  delete from public.public_challenge_snapshot_cache_state cache
   where cache.user_id = p_user_id;
  delete from public.public_challenge_projection_cursors cursor
   where cursor.user_id = p_user_id;

  -- A personal definition can be deleted only when no retained shared entry
  -- still depends on it. Group-owned tracker definitions always survive.
  delete from public.metric_definitions metric
   where metric.owner_user_id = p_user_id
     and metric.group_id is null
     and not exists (
       select 1
       from public.metric_entries entry
       where entry.metric_id = metric.id
         and entry.visibility <> 'private'
     );

  -- Public templates have already been deliberately published and therefore
  -- follow the same retention rule as other shared manual contributions.
  -- Private/unlisted templates and their cascading versions are personal data.
  delete from public.templates template
   where template.creator_user_id = p_user_id
     and template.visibility <> 'public';

  -- Keep media that still backs identity or retained group-visible content.
  select coalesce(
    pg_catalog.array_agg(reference.path order by reference.path),
    array[]::text[]
  )
  into v_retained_media_paths
  from (
    select profile.avatar_path as path
      from public.profiles profile
     where profile.id = p_user_id
       and profile.avatar_path is not null
    union
    select asset.storage_path
      from public.media_assets asset
      join public.photo_updates photo on photo.media_asset_id = asset.id
     where asset.owner_user_id = p_user_id
    union
    select asset.thumbnail_path
      from public.media_assets asset
      join public.photo_updates photo on photo.media_asset_id = asset.id
     where asset.owner_user_id = p_user_id
       and asset.thumbnail_path is not null
    union
    select entry.image_path
      from public.metric_entries entry
     where entry.image_path is not null
       and entry.image_path like (p_user_id::text || '/%')
    union
    select message.image_path
      from public.messages message
     where message.image_path is not null
       and message.image_path like (p_user_id::text || '/%')
    union
    select challenge.visual_image_path
      from public.group_challenges challenge
     where challenge.visual_image_path is not null
       and challenge.visual_image_path like (p_user_id::text || '/%')
    union
    select asset.thumbnail_path
      from public.media_assets asset
     where asset.owner_user_id = p_user_id
       and asset.thumbnail_path is not null
       and asset.storage_path in (
         select entry.image_path
           from public.metric_entries entry
          where entry.image_path is not null
         union
         select message.image_path
           from public.messages message
          where message.image_path is not null
         union
         select challenge.visual_image_path
           from public.group_challenges challenge
          where challenge.visual_image_path is not null
       )
  ) reference
  where reference.path is not null
    and reference.path like (p_user_id::text || '/%');

  delete from public.media_assets asset
   where asset.owner_user_id = p_user_id
     and not (asset.storage_path = any(v_retained_media_paths))
     and (
       asset.thumbnail_path is null
       or not (asset.thumbnail_path = any(v_retained_media_paths))
     );

  -- Private tombstones contain a date but have no cross-member cache purpose.
  -- Retain group/status tombstones so an offline peer cannot resurrect a
  -- removed shared health row.
  delete from public.metric_entry_tombstones tombstone
   where tombstone.user_id = p_user_id
     and tombstone.visibility = 'private';

  select coalesce(snapshot.revision, 0) + 1
    into v_revision
    from public.user_snapshots snapshot
   where snapshot.user_id = p_user_id;
  v_revision := coalesce(v_revision, 1);
  v_updated_at := clock_timestamp();
  -- Scope the trigger exemption to this reset transaction, target user, and
  -- active attempt. Clear it again after the single intended upsert.
  perform pg_catalog.set_config(
    'habhub.account_reset_user_id',
    p_user_id::text,
    true
  );
  perform pg_catalog.set_config(
    'habhub.account_reset_attempt_id',
    p_attempt_id::text,
    true
  );
  insert into public.user_snapshots (
    user_id,
    payload,
    revision,
    device_id,
    schema_version,
    updated_at
  ) values (
    p_user_id,
    p_payload,
    v_revision,
    p_device_id,
    p_schema_version,
    v_updated_at
  )
  on conflict (user_id) do update
    set payload = excluded.payload,
        revision = excluded.revision,
        device_id = excluded.device_id,
        schema_version = excluded.schema_version,
        updated_at = excluded.updated_at;
  perform pg_catalog.set_config('habhub.account_reset_user_id', '', true);
  perform pg_catalog.set_config('habhub.account_reset_attempt_id', '', true);

  if exists (
      select 1 from public.metric_entries entry
       where entry.user_id = p_user_id
         and (
           entry.visibility = 'private'
           or entry.source = 'imported'
           or entry.source_provider is not null
         )
    )
    or exists (
      select 1 from public.photo_updates photo
       where photo.owner_user_id = p_user_id
         and photo.visibility = 'private'
    )
    or exists (
      select 1 from public.daily_metric_status status
       where status.user_id = p_user_id
         and (status.visibility = 'private' or status.source_provider is not null)
    )
    or exists (
      select 1 from public.health_connections connection
       where connection.user_id = p_user_id
    )
    or exists (
      select 1 from public.health_sync_cursors cursor
       where cursor.user_id = p_user_id
    )
    or exists (
      select 1 from public.device_push_tokens token
       where token.user_id = p_user_id
    ) then
    raise exception 'habhub_account_reset_cleanup_incomplete' using errcode = '55000';
  end if;

  update public.google_health_account_deletion_guards guard
     set lease_until = now() + interval '10 minutes'
   where guard.user_id = p_user_id
     and guard.attempt_id = p_attempt_id;
  get diagnostics v_guard_count = row_count;
  if v_guard_count <> 1 then
    raise exception 'habhub_account_reset_attempt_lost' using errcode = '55000';
  end if;

  return pg_catalog.jsonb_build_object(
    'revision', v_revision,
    'updatedAt', v_updated_at,
    'resetAt', p_reset_at,
    'retainedMediaPaths', pg_catalog.to_jsonb(v_retained_media_paths),
    'privateEntriesDeleted', v_private_entry_count,
    'privatePhotosDeleted', v_private_photo_count,
    'healthStatusesDeleted', v_health_status_count
  );
end;
$$;

revoke all on function public.reset_account_private_data(
  uuid, uuid, jsonb, text, integer, timestamptz
) from public, anon, authenticated;
grant execute on function public.reset_account_private_data(
  uuid, uuid, jsonb, text, integer, timestamptz
) to service_role;

comment on function public.reset_account_private_data(
  uuid, uuid, jsonb, text, integer, timestamptz
) is
  'Server-only reset of private account, health, notification, and device state. Auth identity, memberships, and shared group content are retained.';

commit;
