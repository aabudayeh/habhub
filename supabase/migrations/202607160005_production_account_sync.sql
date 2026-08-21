-- Production account synchronization primitives.
-- The app remains local-first; this adds optimistic concurrency, device tracking,
-- and realtime invalidation without exposing a user's private snapshot.

alter table public.user_snapshots
  add column if not exists revision bigint not null default 0,
  add column if not exists device_id text,
  add column if not exists schema_version integer not null default 9;

create table if not exists public.account_devices (
  user_id uuid not null references public.profiles(id) on delete cascade,
  device_id text not null,
  platform text not null check (platform in ('ios', 'android', 'web', 'unknown')),
  label text,
  last_seen_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  primary key (user_id, device_id)
);

alter table public.account_devices enable row level security;

alter table public.messages add column if not exists client_generated_id text;
create unique index if not exists messages_sender_client_id_idx
  on public.messages (sender_id, client_generated_id) where sender_id is not null and client_generated_id is not null;
do $$ begin
  alter table public.messages add constraint messages_sender_client_id_unique unique (sender_id, client_generated_id);
exception when duplicate_object then null;
end $$;

alter table public.photo_updates add column if not exists client_generated_id text;
create unique index if not exists photos_owner_client_id_idx
  on public.photo_updates (owner_user_id, client_generated_id) where client_generated_id is not null;
do $$ begin
  alter table public.photo_updates add constraint photos_owner_client_id_unique unique (owner_user_id, client_generated_id);
exception when duplicate_object then null;
end $$;

drop policy if exists account_devices_owner_read on public.account_devices;
create policy account_devices_owner_read on public.account_devices
for select to authenticated using (user_id = auth.uid());

drop policy if exists account_devices_owner_insert on public.account_devices;
create policy account_devices_owner_insert on public.account_devices
for insert to authenticated with check (user_id = auth.uid());

drop policy if exists account_devices_owner_update on public.account_devices;
create policy account_devices_owner_update on public.account_devices
for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists account_devices_owner_delete on public.account_devices;
create policy account_devices_owner_delete on public.account_devices
for delete to authenticated using (user_id = auth.uid());

create or replace function public.sync_user_snapshot(
  expected_revision bigint,
  new_payload jsonb,
  client_device_id text,
  client_schema_version integer
)
returns table (revision bigint, updated_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := auth.uid();
  next_revision bigint;
  changed_at timestamptz := now();
begin
  if caller_id is null then
    raise exception using errcode = '42501', message = 'Authentication required';
  end if;

  if jsonb_typeof(new_payload) <> 'object' then
    raise exception using errcode = '22023', message = 'Snapshot payload must be a JSON object';
  end if;

  if client_schema_version < 1 then
    raise exception using errcode = '22023', message = 'Invalid schema version';
  end if;

  insert into public.user_snapshots (
    user_id, payload, revision, device_id, schema_version, updated_at
  ) values (
    caller_id, new_payload, 1, client_device_id, client_schema_version, changed_at
  )
  on conflict (user_id) do update
    set payload = excluded.payload,
        revision = public.user_snapshots.revision + 1,
        device_id = excluded.device_id,
        schema_version = excluded.schema_version,
        updated_at = excluded.updated_at
    where public.user_snapshots.revision = expected_revision
  returning public.user_snapshots.revision into next_revision;

  if next_revision is null then
    raise exception using errcode = 'P0001', message = 'snapshot_conflict';
  end if;

  insert into public.account_devices (user_id, device_id, platform, last_seen_at)
  values (caller_id, client_device_id, 'unknown', changed_at)
  on conflict (user_id, device_id) do update set last_seen_at = excluded.last_seen_at;

  return query select next_revision, changed_at;
end;
$$;

revoke all on function public.sync_user_snapshot(bigint, jsonb, text, integer) from public;
grant execute on function public.sync_user_snapshot(bigint, jsonb, text, integer) to authenticated;

create or replace function public.register_account_device(
  client_device_id text,
  client_platform text,
  client_label text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := auth.uid();
begin
  if caller_id is null then
    raise exception using errcode = '42501', message = 'Authentication required';
  end if;
  if client_platform not in ('ios', 'android', 'web', 'unknown') then
    raise exception using errcode = '22023', message = 'Unsupported platform';
  end if;
  insert into public.account_devices (user_id, device_id, platform, label, last_seen_at)
  values (caller_id, client_device_id, client_platform, nullif(trim(client_label), ''), now())
  on conflict (user_id, device_id) do update
    set platform = excluded.platform,
        label = coalesce(excluded.label, public.account_devices.label),
        last_seen_at = excluded.last_seen_at;
end;
$$;

revoke all on function public.register_account_device(text, text, text) from public;
grant execute on function public.register_account_device(text, text, text) to authenticated;

-- Storage authorization mirrors the relational visibility rules. Signed URLs still
-- require this policy at creation time; possession of an expired URL grants nothing.
create or replace function public.can_read_media_object(object_path text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    auth.uid() is not null
    and (
      (storage.foldername(object_path))[1] = auth.uid()::text
      or exists (
        select 1
        from public.media_assets asset
        join public.photo_updates photo on photo.media_asset_id = asset.id
        where asset.storage_path = object_path
          and photo.visibility = 'group'
          and photo.group_id is not null
          and public.is_group_member(photo.group_id)
      )
      or exists (
        select 1
        from public.metric_entries entry
        join public.metric_definitions metric on metric.id = entry.metric_id
        where entry.image_path = object_path
          and entry.visibility = 'group'
          and metric.group_id is not null
          and public.is_group_member(metric.group_id)
      )
      or exists (
        select 1
        from public.messages message
        where message.image_path = object_path
          and public.is_group_member(message.group_id)
          and (message.recipient_id is null or message.sender_id = auth.uid() or message.recipient_id = auth.uid())
      )
      or exists (
        select 1 from public.profiles profile
        where profile.avatar_path = object_path and public.shares_group_with(profile.id)
      )
    );
$$;

revoke all on function public.can_read_media_object(text) from public;
grant execute on function public.can_read_media_object(text) to authenticated;

drop policy if exists media_storage_owner_read on storage.objects;
drop policy if exists media_storage_authorized_read on storage.objects;
create policy media_storage_authorized_read on storage.objects for select to authenticated
using (bucket_id = 'paceboard-media' and public.can_read_media_object(name));

drop policy if exists media_group_read on public.media_assets;
create policy media_group_read on public.media_assets for select to authenticated
using (
  exists (
    select 1 from public.photo_updates photo
    where photo.media_asset_id = media_assets.id
      and photo.visibility = 'group'
      and photo.group_id is not null
      and public.is_group_member(photo.group_id)
  )
);

-- Postgres Changes is intentionally used only as a small invalidation signal.
-- RLS still limits every event and subsequent fetch to the owning user.
do $$
begin
  alter publication supabase_realtime add table public.user_snapshots;
exception
  when duplicate_object then null;
end $$;

do $$
declare
  relation_name text;
begin
  foreach relation_name in array array['messages', 'photo_updates', 'group_members', 'metric_definitions', 'daily_metric_status']
  loop
    begin
      execute format('alter publication supabase_realtime add table public.%I', relation_name);
    exception when duplicate_object then null;
    end;
  end loop;
end $$;
