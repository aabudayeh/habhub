-- Server-only Google Health API pilot.
--
-- OAuth state, encrypted refresh tokens, cursors, imported-record ownership,
-- and webhook delivery state are deliberately invisible to browser/mobile
-- clients.  The Edge Functions use the service role after authenticating the
-- HabHub user themselves.

alter table public.metric_entries
  drop constraint if exists metric_entries_source_provider_check;
alter table public.metric_entries
  add constraint metric_entries_source_provider_check
  check (source_provider is null or source_provider in ('apple_health', 'health_connect', 'google_health'));

alter table public.daily_metric_status
  add column if not exists source_provider text;
alter table public.daily_metric_status
  drop constraint if exists daily_metric_status_source_provider_check;
alter table public.daily_metric_status
  add constraint daily_metric_status_source_provider_check
  check (source_provider is null or source_provider in ('apple_health', 'health_connect', 'google_health'));

create table if not exists public.google_health_connections (
  user_id uuid primary key references auth.users(id) on delete cascade,
  health_user_id text,
  google_subject text,
  google_email text,
  granted_scopes text[] not null default '{}',
  refresh_token_ciphertext text,
  refresh_token_iv text,
  refresh_token_fingerprint text
    check (refresh_token_fingerprint is null or refresh_token_fingerprint ~ '^[a-f0-9]{64}$'),
  refresh_replacement_nonce uuid,
  encryption_key_version smallint not null default 1,
  refresh_token_expires_at timestamptz,
  status text not null default 'pending'
    check (status in ('pending', 'connected', 'error', 'disconnected')),
  last_synced_at timestamptz,
  last_error_code text,
  last_error_at timestamptz,
  sync_lease_id uuid,
  sync_lease_until timestamptz,
  last_manual_sync_at timestamptz,
  connection_generation bigint not null default 0 check (connection_generation >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint google_health_connections_health_user_id_format
    check (health_user_id is null or health_user_id ~ '^[A-Za-z0-9-]{1,63}$'),
  constraint google_health_connections_cipher_pair
    check (
      (refresh_token_ciphertext is null and refresh_token_iv is null)
      or
      (refresh_token_ciphertext is not null and refresh_token_iv is not null)
    )
);

create unique index if not exists google_health_connections_health_user_idx
  on public.google_health_connections (health_user_id)
  where health_user_id is not null;

create table if not exists public.google_health_oauth_states (
  state_hash text primary key check (state_hash ~ '^[a-f0-9]{64}$'),
  user_id uuid not null references auth.users(id) on delete cascade,
  verifier_ciphertext text not null,
  verifier_iv text not null,
  verifier_key_version smallint not null default 1 check (verifier_key_version > 0),
  connection_generation bigint not null check (connection_generation >= 0),
  return_to text not null,
  expires_at timestamptz not null,
  consumed_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists google_health_oauth_states_expiry_idx
  on public.google_health_oauth_states (expires_at)
  where consumed_at is null;

create table if not exists public.google_health_sync_cursors (
  user_id uuid not null references auth.users(id) on delete cascade,
  data_type text not null,
  cursor jsonb not null default '{}'::jsonb,
  last_success_at timestamptz,
  last_error_code text,
  last_error_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key (user_id, data_type)
);

create table if not exists public.google_health_pending_grants (
  completion_hash text primary key check (completion_hash ~ '^[a-f0-9]{64}$'),
  user_id uuid not null references auth.users(id) on delete cascade,
  health_user_id text not null check (health_user_id ~ '^[A-Za-z0-9-]{1,63}$'),
  granted_scopes text[] not null,
  refresh_token_ciphertext text not null,
  refresh_token_iv text not null,
  encryption_key_version smallint not null check (encryption_key_version > 0),
  refresh_token_expires_at timestamptz,
  connection_generation bigint not null check (connection_generation >= 0),
  expires_at timestamptz not null,
  consumed_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists google_health_pending_grants_expiry_idx
  on public.google_health_pending_grants (expires_at)
  where consumed_at is null;

create table if not exists public.google_health_import_records (
  user_id uuid not null references auth.users(id) on delete cascade,
  external_id text not null,
  data_type text not null,
  local_date date not null,
  entry_id text not null,
  entry jsonb not null check (jsonb_typeof(entry) = 'object'),
  first_imported_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, external_id, entry_id)
);

create index if not exists google_health_import_records_range_idx
  on public.google_health_import_records (user_id, data_type, local_date);

-- User-authored edits and suppressions live only behind the service-role
-- boundary.  The client may keep them in memory, but never needs to persist a
-- Google identifier or provider timestamp in plaintext browser/device caches.
create table if not exists public.google_health_entry_preferences (
  user_id uuid not null references auth.users(id) on delete cascade,
  entry_id text not null,
  metric_id text not null,
  data_type text not null,
  source_local_date date not null,
  visibility text check (visibility is null or visibility in ('private', 'status', 'group')),
  recorded_at_override timestamptz,
  display_local_date date,
  dismissed boolean not null default false,
  updated_at timestamptz not null default now(),
  primary key (user_id, entry_id),
  constraint google_health_entry_preferences_time_pair check (
    (recorded_at_override is null and display_local_date is null)
    or (recorded_at_override is not null and display_local_date is not null)
  )
);

create index if not exists google_health_entry_preferences_range_idx
  on public.google_health_entry_preferences (user_id, data_type, source_local_date);

-- Set before the security-critical account deletion transaction.  OAuth
-- create/stage/complete all check this durable guard, closing the gap between
-- local token cleanup and auth.admin.deleteUser.
create table if not exists public.google_health_account_deletion_guards (
  user_id uuid primary key references auth.users(id) on delete cascade,
  attempt_id uuid not null unique,
  started_at timestamptz not null default now(),
  lease_until timestamptz not null default (now() + interval '10 minutes')
);
alter table public.google_health_account_deletion_guards
  add column if not exists lease_until timestamptz
  not null default (now() + interval '10 minutes');

-- A durable account marker lets row-level security protect an already-installed
-- pre-Google client even after the active grant is disconnected.  It is removed
-- only after the connection and every Google-owned row/projection are deleted.
create table if not exists public.google_health_privacy_accounts (
  user_id uuid primary key references auth.users(id) on delete cascade,
  required_since timestamptz not null default now()
);

-- Deployment is deliberately two-phase.  The migration and functions can be
-- installed while this switch remains off; OAuth/imports become possible only
-- after the schema-27 clients and their privacy header are live and verified.
create table if not exists public.google_health_runtime_config (
  singleton boolean primary key default true check (singleton),
  enabled boolean not null default false,
  min_privacy_schema integer not null default 27 check (min_privacy_schema >= 27),
  updated_at timestamptz not null default now()
);
insert into public.google_health_runtime_config (
  singleton, enabled, min_privacy_schema
) values (true, false, 27)
on conflict (singleton) do nothing;

create index if not exists daily_metric_status_google_health_user_idx
  on public.daily_metric_status (user_id, local_date)
  where source_provider = 'google_health';

create table if not exists public.google_health_webhook_queue (
  id uuid primary key default gen_random_uuid(),
  notification_hash text not null unique check (notification_hash ~ '^[a-f0-9]{64}$'),
  health_user_id text not null,
  data_type text not null,
  operation text not null check (operation in ('UPSERT', 'DELETE')),
  payload jsonb not null check (jsonb_typeof(payload) = 'object'),
  status text not null default 'pending'
    check (status in ('pending', 'processing', 'completed', 'dead')),
  attempt_count integer not null default 0 check (attempt_count >= 0),
  available_at timestamptz not null default now(),
  claimed_at timestamptz,
  completed_at timestamptz,
  last_error text,
  created_at timestamptz not null default now()
);

create table if not exists public.google_health_revocation_queue (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  refresh_token_ciphertext text not null,
  refresh_token_iv text not null,
  encryption_key_version smallint not null check (encryption_key_version > 0),
  status text not null default 'pending'
    check (status in ('pending', 'processing', 'dead')),
  attempt_count integer not null default 0 check (attempt_count >= 0),
  available_at timestamptz not null default now(),
  claimed_at timestamptz,
  last_error text,
  created_at timestamptz not null default now()
);

create index if not exists google_health_revocation_queue_claim_idx
  on public.google_health_revocation_queue (available_at, created_at)
  where status = 'pending';

create index if not exists google_health_webhook_queue_claim_idx
  on public.google_health_webhook_queue (available_at, created_at)
  where status = 'pending';

alter table public.google_health_connections enable row level security;
alter table public.google_health_oauth_states enable row level security;
alter table public.google_health_sync_cursors enable row level security;
alter table public.google_health_pending_grants enable row level security;
alter table public.google_health_import_records enable row level security;
alter table public.google_health_entry_preferences enable row level security;
alter table public.google_health_account_deletion_guards enable row level security;
alter table public.google_health_privacy_accounts enable row level security;
alter table public.google_health_runtime_config enable row level security;
alter table public.google_health_webhook_queue enable row level security;
alter table public.google_health_revocation_queue enable row level security;

-- These tables intentionally have no anon/authenticated policies.  RLS is a
-- second boundary in addition to revoking the schema's default grants.
revoke all on table public.google_health_connections from anon, authenticated;
revoke all on table public.google_health_oauth_states from anon, authenticated;
revoke all on table public.google_health_sync_cursors from anon, authenticated;
revoke all on table public.google_health_pending_grants from anon, authenticated;
revoke all on table public.google_health_import_records from anon, authenticated;
revoke all on table public.google_health_entry_preferences from anon, authenticated;
revoke all on table public.google_health_account_deletion_guards from anon, authenticated;
revoke all on table public.google_health_privacy_accounts from anon, authenticated;
revoke all on table public.google_health_runtime_config from anon, authenticated;
revoke all on table public.google_health_webhook_queue from anon, authenticated;
revoke all on table public.google_health_revocation_queue from anon, authenticated;
grant all on table public.google_health_connections to service_role;
grant all on table public.google_health_oauth_states to service_role;
grant all on table public.google_health_sync_cursors to service_role;
grant all on table public.google_health_pending_grants to service_role;
grant all on table public.google_health_import_records to service_role;
grant all on table public.google_health_entry_preferences to service_role;
grant all on table public.google_health_account_deletion_guards to service_role;
grant all on table public.google_health_privacy_accounts to service_role;
grant all on table public.google_health_runtime_config to service_role;
grant all on table public.google_health_webhook_queue to service_role;
grant all on table public.google_health_revocation_queue to service_role;

-- PostgREST makes request headers available transaction-locally.  Invalid,
-- absent, or oversized values fail closed to schema 0.  Schema 26 is the last
-- released pre-Google client; schema 27 is the first client that never writes
-- Google identifiers/values to an unencrypted local cache.
create or replace function public.habhub_privacy_schema_version()
returns integer
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_headers jsonb;
  v_value text;
begin
  begin
    v_headers := nullif(current_setting('request.headers', true), '')::jsonb;
  exception when others then
    return 0;
  end;
  v_value := v_headers ->> 'x-habhub-privacy-schema';
  if coalesce(v_value, '') ~ '^[0-9]{1,4}$' then
    return v_value::integer;
  end if;
  return 0;
end;
$$;

revoke all on function public.habhub_privacy_schema_version() from public;
grant execute on function public.habhub_privacy_schema_version()
  to authenticated, service_role;

create or replace function public.google_health_runtime_enabled()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select config.enabled
       from public.google_health_runtime_config config
      where config.singleton = true),
    false
  );
$$;

revoke all on function public.google_health_runtime_enabled() from public;
grant execute on function public.google_health_runtime_enabled() to service_role;

create or replace function public.google_health_projection_access_allowed()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.habhub_privacy_schema_version() >= coalesce(
    (select config.min_privacy_schema
       from public.google_health_runtime_config config
      where config.singleton = true),
    27
  );
$$;

revoke all on function public.google_health_projection_access_allowed() from public;
grant execute on function public.google_health_projection_access_allowed()
  to authenticated, service_role;

create or replace function public.google_health_owner_access_allowed(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    (select auth.uid()) = p_user_id
    and exists (
      select 1 from auth.users account where account.id = p_user_id
    )
    and not exists (
      select 1
        from public.google_health_account_deletion_guards guard
       where guard.user_id = p_user_id
    )
    and (
      not exists (
        select 1
          from public.google_health_privacy_accounts privacy
         where privacy.user_id = p_user_id
      )
      or public.google_health_projection_access_allowed()
    );
$$;

revoke all on function public.google_health_owner_access_allowed(uuid) from public;
grant execute on function public.google_health_owner_access_allowed(uuid)
  to authenticated, service_role;

create or replace function public.assert_google_health_privacy_client(
  p_user_id uuid,
  p_client_schema_version integer
)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_required integer := 27;
begin
  if (select auth.uid()) is null or (select auth.uid()) <> p_user_id then
    raise exception 'google_health_privacy_client_upgrade_required' using errcode = '42501';
  end if;
  if exists (
    select 1
      from public.google_health_account_deletion_guards guard
     where guard.user_id = p_user_id
  ) then
    raise exception 'google_health_account_deleting' using errcode = '55000';
  end if;
  if not exists (
    select 1
      from public.google_health_privacy_accounts privacy
     where privacy.user_id = p_user_id
  ) then
    return;
  end if;
  select coalesce(config.min_privacy_schema, 27)
    into v_required
    from public.google_health_runtime_config config
   where config.singleton = true;
  v_required := coalesce(v_required, 27);
  if coalesce(p_client_schema_version, 0) < v_required
     or public.habhub_privacy_schema_version() < v_required then
    raise exception 'google_health_privacy_client_upgrade_required' using errcode = '55000';
  end if;
end;
$$;

revoke all on function public.assert_google_health_privacy_client(uuid, integer)
  from public;
grant execute on function public.assert_google_health_privacy_client(uuid, integer)
  to authenticated;

-- Remove a compatibility marker only after every server/private and
-- owner/group representation is gone.  This is deliberately conservative:
-- an abandoned OAuth flow remains schema-27-only until its state audit window
-- and any durable revocation both finish.
create or replace function public.release_google_health_privacy_markers_if_clean(
  p_user_id uuid default null
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_deleted integer := 0;
begin
  if (select auth.role()) is distinct from 'service_role' then
    raise exception 'google_health_service_role_required' using errcode = '42501';
  end if;

  delete from public.google_health_connections connection
   where (p_user_id is null or connection.user_id = p_user_id)
     and connection.refresh_token_ciphertext is null
     and not exists (
       select 1 from public.google_health_oauth_states state
        where state.user_id = connection.user_id
     )
     and not exists (
       select 1 from public.google_health_pending_grants pending
        where pending.user_id = connection.user_id
     )
     and not exists (
       select 1 from public.google_health_import_records owned
        where owned.user_id = connection.user_id
     )
     and not exists (
       select 1 from public.google_health_entry_preferences preference
        where preference.user_id = connection.user_id
     );

  delete from public.google_health_privacy_accounts privacy
   where (p_user_id is null or privacy.user_id = p_user_id)
     and not exists (
       select 1 from public.google_health_connections connection
        where connection.user_id = privacy.user_id
          and connection.refresh_token_ciphertext is not null
     )
     and not exists (
       select 1 from public.google_health_oauth_states state
        where state.user_id = privacy.user_id
     )
     and not exists (
       select 1 from public.google_health_pending_grants pending
        where pending.user_id = privacy.user_id
     )
     and not exists (
       select 1 from public.google_health_revocation_queue revocation
        where revocation.user_id = privacy.user_id
     )
     and not exists (
       select 1 from public.google_health_import_records owned
        where owned.user_id = privacy.user_id
     )
     and not exists (
       select 1 from public.google_health_entry_preferences preference
        where preference.user_id = privacy.user_id
     )
     and not exists (
       select 1
         from public.user_snapshots snapshot
         cross join lateral jsonb_array_elements(
           case when jsonb_typeof(snapshot.payload -> 'entries') = 'array'
             then snapshot.payload -> 'entries' else '[]'::jsonb end
         ) entry
        where snapshot.user_id = privacy.user_id
          and coalesce(entry ->> 'id', '') like 'google-health:%'
     )
     and not exists (
       select 1
         from public.user_snapshots snapshot
         cross join lateral jsonb_object_keys(
           case when jsonb_typeof(snapshot.payload #> '{settings,googleHealthEntryOverrides}') = 'object'
             then snapshot.payload #> '{settings,googleHealthEntryOverrides}'
             else '{}'::jsonb end
         ) preference_id
        where snapshot.user_id = privacy.user_id
          and preference_id like 'google-health:%'
     )
     and not exists (
       select 1
         from public.user_snapshots snapshot
         cross join lateral jsonb_array_elements_text(
           (case when jsonb_typeof(snapshot.payload #> '{settings,dismissedHealthEntryIds}') = 'array'
             then snapshot.payload #> '{settings,dismissedHealthEntryIds}' else '[]'::jsonb end)
           || (case when jsonb_typeof(snapshot.payload #> '{settings,deletedEntryIds}') = 'array'
             then snapshot.payload #> '{settings,deletedEntryIds}' else '[]'::jsonb end)
           || (case when jsonb_typeof(snapshot.payload #> '{settings,pendingDeletedEntryIds}') = 'array'
             then snapshot.payload #> '{settings,pendingDeletedEntryIds}' else '[]'::jsonb end)
         ) preference_id
        where snapshot.user_id = privacy.user_id
          and preference_id like 'google-health:%'
     )
     and not exists (
       select 1 from public.metric_entries entry
        where entry.user_id = privacy.user_id
          and entry.source_provider = 'google_health'
     )
     and not exists (
       select 1 from public.daily_metric_status status
        where status.user_id = privacy.user_id
          and status.source_provider = 'google_health'
     )
     and not exists (
       select 1 from public.metric_entry_tombstones tombstone
        where tombstone.user_id = privacy.user_id
          and tombstone.client_generated_id like 'google-health:%'
     )
     and not exists (
       select 1 from public.push_dispatch_events event
        where event.dispatcher_id = privacy.user_id
          and (
            event.event_key like '%google-health:%'
            or coalesce(event.data ->> 'entryId', '') like 'google-health:%'
          )
     );
  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$$;

revoke all on function public.release_google_health_privacy_markers_if_clean(uuid)
  from public, anon, authenticated;
grant execute on function public.release_google_health_privacy_markers_if_clean(uuid)
  to service_role;

-- Existing owner/member policies remain the authorization source.  These
-- restrictive policies are an additional compatibility boundary: old/no-
-- header clients retain normal native/manual accounts, but cannot read or
-- mutate a Google-bearing owner snapshot or any Google-derived group row.
drop policy if exists google_health_snapshot_privacy_gate on public.user_snapshots;
create policy google_health_snapshot_privacy_gate
  on public.user_snapshots as restrictive for all to authenticated
  using (public.google_health_owner_access_allowed(user_id))
  with check (public.google_health_owner_access_allowed(user_id));

drop policy if exists google_health_entry_read_privacy_gate on public.metric_entries;
create policy google_health_entry_read_privacy_gate
  on public.metric_entries as restrictive for select to authenticated
  using (
    source_provider is distinct from 'google_health'
    or public.google_health_projection_access_allowed()
  );
drop policy if exists google_health_entry_insert_privacy_gate on public.metric_entries;
create policy google_health_entry_insert_privacy_gate
  on public.metric_entries as restrictive for insert to authenticated
  with check (
    user_id <> (select auth.uid())
    or public.google_health_owner_access_allowed(user_id)
  );
drop policy if exists google_health_entry_update_privacy_gate on public.metric_entries;
create policy google_health_entry_update_privacy_gate
  on public.metric_entries as restrictive for update to authenticated
  using (
    user_id <> (select auth.uid())
    or public.google_health_owner_access_allowed(user_id)
  )
  with check (
    user_id <> (select auth.uid())
    or public.google_health_owner_access_allowed(user_id)
  );
drop policy if exists google_health_entry_delete_privacy_gate on public.metric_entries;
create policy google_health_entry_delete_privacy_gate
  on public.metric_entries as restrictive for delete to authenticated
  using (
    user_id <> (select auth.uid())
    or public.google_health_owner_access_allowed(user_id)
  );

drop policy if exists google_health_status_read_privacy_gate on public.daily_metric_status;
create policy google_health_status_read_privacy_gate
  on public.daily_metric_status as restrictive for select to authenticated
  using (
    source_provider is distinct from 'google_health'
    or public.google_health_projection_access_allowed()
  );
drop policy if exists google_health_status_insert_privacy_gate on public.daily_metric_status;
create policy google_health_status_insert_privacy_gate
  on public.daily_metric_status as restrictive for insert to authenticated
  with check (
    user_id <> (select auth.uid())
    or public.google_health_owner_access_allowed(user_id)
  );
drop policy if exists google_health_status_update_privacy_gate on public.daily_metric_status;
create policy google_health_status_update_privacy_gate
  on public.daily_metric_status as restrictive for update to authenticated
  using (
    user_id <> (select auth.uid())
    or public.google_health_owner_access_allowed(user_id)
  )
  with check (
    user_id <> (select auth.uid())
    or public.google_health_owner_access_allowed(user_id)
  );
drop policy if exists google_health_status_delete_privacy_gate on public.daily_metric_status;
create policy google_health_status_delete_privacy_gate
  on public.daily_metric_status as restrictive for delete to authenticated
  using (
    user_id <> (select auth.uid())
    or public.google_health_owner_access_allowed(user_id)
  );

drop policy if exists google_health_tombstone_read_privacy_gate
  on public.metric_entry_tombstones;
create policy google_health_tombstone_read_privacy_gate
  on public.metric_entry_tombstones as restrictive for select to authenticated
  using (
    client_generated_id not like 'google-health:%'
    or public.google_health_projection_access_allowed()
  );
drop policy if exists google_health_tombstone_delete_privacy_gate
  on public.metric_entry_tombstones;
create policy google_health_tombstone_delete_privacy_gate
  on public.metric_entry_tombstones as restrictive for delete to authenticated
  using (
    user_id <> (select auth.uid())
    or public.google_health_owner_access_allowed(user_id)
  );

drop policy if exists google_health_push_event_read_privacy_gate
  on public.push_dispatch_events;
create policy google_health_push_event_read_privacy_gate
  on public.push_dispatch_events as restrictive for select to authenticated
  using (
    coalesce(data ->> 'entryId', '') not like 'google-health:%'
    or public.google_health_projection_access_allowed()
  );

-- Payload reads are mediated by explicit versioned RPCs in schema-27 clients.
-- The old direct-table path is still usable for accounts that never connected
-- Google Health, while the restrictive policy above makes it return no rows
-- for a Google-bearing account.
create or replace function public.get_user_snapshot(
  p_client_schema_version integer
)
returns table (
  payload jsonb,
  revision bigint,
  updated_at timestamptz,
  device_id text,
  schema_version integer
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
begin
  if v_user_id is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  if coalesce(p_client_schema_version, 0) < 1 then
    raise exception 'Invalid schema version' using errcode = '22023';
  end if;
  perform public.assert_google_health_privacy_client(
    v_user_id,
    p_client_schema_version
  );
  return query
    select
      snapshot.payload,
      snapshot.revision,
      snapshot.updated_at,
      snapshot.device_id,
      snapshot.schema_version
      from public.user_snapshots snapshot
     where snapshot.user_id = v_user_id;
end;
$$;

revoke all on function public.get_user_snapshot(integer) from public, anon;
grant execute on function public.get_user_snapshot(integer) to authenticated;

create or replace function public.get_user_snapshot_metadata(
  p_client_schema_version integer
)
returns table (
  revision bigint,
  updated_at timestamptz,
  device_id text,
  schema_version integer
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
begin
  if v_user_id is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  if coalesce(p_client_schema_version, 0) < 1 then
    raise exception 'Invalid schema version' using errcode = '22023';
  end if;
  perform public.assert_google_health_privacy_client(
    v_user_id,
    p_client_schema_version
  );
  return query
    select
      snapshot.revision,
      snapshot.updated_at,
      snapshot.device_id,
      snapshot.schema_version
      from public.user_snapshots snapshot
     where snapshot.user_id = v_user_id;
end;
$$;

revoke all on function public.get_user_snapshot_metadata(integer)
  from public, anon;
grant execute on function public.get_user_snapshot_metadata(integer)
  to authenticated;

-- Preserve the optimistic revision contract while applying the same version
-- gate to every snapshot write.  A schema-26 client cannot overwrite a newer
-- Google-bearing snapshot even if it still holds a valid JWT and revision.
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
  caller_id uuid := (select auth.uid());
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
  perform public.assert_google_health_privacy_client(
    caller_id,
    client_schema_version
  );

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
  on conflict (user_id, device_id) do update
    set last_seen_at = excluded.last_seen_at;

  return query select next_revision, changed_at;
end;
$$;

revoke all on function public.sync_user_snapshot(bigint, jsonb, text, integer)
  from public, anon;
grant execute on function public.sync_user_snapshot(bigint, jsonb, text, integer)
  to authenticated;

-- Every relational owner projection RPC and revision trigger reaches this
-- fence.  Extending it closes SECURITY DEFINER paths as well as direct table
-- writes for a released schema-26 client.
create or replace function public.assert_account_snapshot_revision(
  p_user_id uuid,
  p_expected_revision bigint
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := (select auth.uid());
  current_revision bigint;
  expected_fence text;
begin
  if caller_id is null or caller_id <> p_user_id then
    raise exception 'account_revision_forbidden' using errcode = '42501';
  end if;
  perform public.assert_google_health_privacy_client(
    p_user_id,
    public.habhub_privacy_schema_version()
  );
  if p_expected_revision is null then
    raise exception 'stale_group_publish' using errcode = '40001';
  end if;

  expected_fence := p_user_id::text || ':' || p_expected_revision::text;
  if current_setting('habhub.account_revision_fence', true) = expected_fence then
    return;
  end if;
  select snapshot.revision
    into current_revision
    from public.user_snapshots snapshot
   where snapshot.user_id = p_user_id
   for update;
  if current_revision is null or current_revision <> p_expected_revision then
    raise exception 'stale_group_publish' using errcode = '40001';
  end if;
  perform set_config('habhub.account_revision_fence', expected_fence, true);
end;
$$;

revoke all on function public.assert_account_snapshot_revision(uuid, bigint)
  from public;
grant execute on function public.assert_account_snapshot_revision(uuid, bigint)
  to authenticated;

-- Realtime does not expose PostgREST request headers to row policies. Version
-- the private topic instead: current clients subscribe only to :v27, while a
-- marked Google account receives no legacy-topic broadcast at all.
create or replace function public.habhub_account_broadcast_topic_allowed()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    (select auth.uid()) is not null
    and exists (
      select 1 from auth.users account where account.id = (select auth.uid())
    )
    and not exists (
      select 1
        from public.google_health_account_deletion_guards guard
       where guard.user_id = (select auth.uid())
    )
    and (
      (select realtime.topic()) =
        'account:' || (select auth.uid())::text || ':snapshot:v27'
      or (
        (select realtime.topic()) =
          'account:' || (select auth.uid())::text || ':snapshot'
        and not exists (
          select 1
            from public.google_health_privacy_accounts privacy
           where privacy.user_id = (select auth.uid())
        )
      )
    );
$$;

revoke all on function public.habhub_account_broadcast_topic_allowed()
  from public;
grant execute on function public.habhub_account_broadcast_topic_allowed()
  to authenticated;

drop policy if exists habhub_account_broadcast_read on realtime.messages;
create policy habhub_account_broadcast_read
  on realtime.messages for select to authenticated
  using (public.habhub_account_broadcast_topic_allowed());

create or replace function public.broadcast_account_snapshot_revision()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_google_private boolean;
begin
  select exists (
    select 1
      from public.google_health_privacy_accounts privacy
     where privacy.user_id = new.user_id
  ) into v_google_private;
  begin
    perform realtime.send(
      jsonb_build_object('revision', new.revision),
      'snapshot_updated',
      'account:' || new.user_id::text || ':snapshot:v27',
      true
    );
  exception when others then
    raise warning 'HabHub account v27 snapshot broadcast failed';
  end;
  if not v_google_private then
    begin
      perform realtime.send(
        jsonb_build_object(
          'revision', new.revision,
          'device_id', new.device_id,
          'updated_at', new.updated_at
        ),
        'snapshot_updated',
        'account:' || new.user_id::text || ':snapshot',
        true
      );
    exception when others then
      raise warning 'HabHub legacy account snapshot broadcast failed';
    end;
  end if;
  return new;
end;
$$;

revoke all on function public.broadcast_account_snapshot_revision()
  from public, anon, authenticated;

-- Account deletion first commits a guard, then the Edge Function deletes the
-- entire private media prefix. This predicate blocks concurrent writes during
-- cleanup and also rejects a stale-but-unexpired JWT after auth.users is gone.
create or replace function public.can_mutate_own_media_object(p_object_path text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    auth.uid() is not null
    and (storage.foldername(p_object_path))[1] = auth.uid()::text
    and exists (
      select 1 from auth.users account where account.id = auth.uid()
    )
    and not exists (
      select 1
        from public.google_health_account_deletion_guards guard
       where guard.user_id = auth.uid()
    );
$$;

revoke all on function public.can_mutate_own_media_object(text) from public;
grant execute on function public.can_mutate_own_media_object(text) to authenticated;

-- Rebuild the shared/owner read predicate too. A valid but stale JWT is not a
-- live account, and an account whose deletion guard is active must not create
-- new signed URLs or read residual objects while fail-closed cleanup runs.
create or replace function public.can_read_media_object(object_path text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    auth.uid() is not null
    and exists (
      select 1 from auth.users account where account.id = auth.uid()
    )
    and not exists (
      select 1
        from public.google_health_account_deletion_guards guard
       where guard.user_id = auth.uid()
    )
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
           and (
             message.recipient_id is null
             or message.sender_id = auth.uid()
             or message.recipient_id = auth.uid()
           )
      )
      or exists (
        select 1
          from public.profiles profile
         where profile.avatar_path = object_path
           and public.shares_group_with(profile.id)
      )
    );
$$;

revoke all on function public.can_read_media_object(text) from public;
grant execute on function public.can_read_media_object(text) to authenticated;

drop policy if exists media_storage_owner_read on storage.objects;
drop policy if exists media_storage_authorized_read on storage.objects;
create policy media_storage_authorized_read on storage.objects for select to authenticated
using (
  bucket_id = 'paceboard-media'
  and public.can_read_media_object(name)
);

drop policy if exists media_storage_owner_insert on storage.objects;
create policy media_storage_owner_insert on storage.objects for insert to authenticated
with check (
  bucket_id = 'paceboard-media'
  and public.can_mutate_own_media_object(name)
);

drop policy if exists media_storage_owner_update on storage.objects;
create policy media_storage_owner_update on storage.objects for update to authenticated
using (
  bucket_id = 'paceboard-media'
  and public.can_mutate_own_media_object(name)
)
with check (
  bucket_id = 'paceboard-media'
  and public.can_mutate_own_media_object(name)
);

drop policy if exists media_storage_owner_delete on storage.objects;
create policy media_storage_owner_delete on storage.objects for delete to authenticated
using (
  bucket_id = 'paceboard-media'
  and public.can_mutate_own_media_object(name)
);

create or replace function public.google_health_touch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists google_health_connections_touch_updated_at
  on public.google_health_connections;
create trigger google_health_connections_touch_updated_at
before update on public.google_health_connections
for each row execute function public.google_health_touch_updated_at();

drop trigger if exists google_health_entry_preferences_touch_updated_at
  on public.google_health_entry_preferences;
create trigger google_health_entry_preferences_touch_updated_at
before update on public.google_health_entry_preferences
for each row execute function public.google_health_touch_updated_at();

drop trigger if exists google_health_sync_cursors_touch_updated_at
  on public.google_health_sync_cursors;
create trigger google_health_sync_cursors_touch_updated_at
before update on public.google_health_sync_cursors
for each row execute function public.google_health_touch_updated_at();

revoke all on function public.google_health_touch_updated_at() from public;

-- Auth-admin deletion can bypass the application Edge Function. These
-- triggers make refresh-token revocation durable before FK cascades erase the
-- active or staged credential rows. The selected completion grant is skipped
-- only when the exact ciphertext has already become the active connection.
create or replace function public.queue_google_health_credential_before_delete()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.refresh_token_ciphertext is null or old.refresh_token_iv is null then
    return old;
  end if;
  if tg_table_name = 'google_health_pending_grants' and exists (
    select 1 from public.google_health_connections connection
     where connection.user_id = old.user_id
       and connection.refresh_token_ciphertext = old.refresh_token_ciphertext
       and connection.refresh_token_iv = old.refresh_token_iv
       and connection.encryption_key_version = old.encryption_key_version
  ) then
    return old;
  end if;
  if not exists (
    select 1 from public.google_health_revocation_queue queued
     where queued.user_id = old.user_id
       and queued.refresh_token_ciphertext = old.refresh_token_ciphertext
       and queued.refresh_token_iv = old.refresh_token_iv
       and queued.encryption_key_version = old.encryption_key_version
  ) then
    insert into public.google_health_revocation_queue (
      user_id, refresh_token_ciphertext, refresh_token_iv, encryption_key_version
    ) values (
      old.user_id,
      old.refresh_token_ciphertext,
      old.refresh_token_iv,
      old.encryption_key_version
    );
  end if;
  return old;
end;
$$;

revoke all on function public.queue_google_health_credential_before_delete()
  from public, anon, authenticated;

drop trigger if exists google_health_connection_queue_revoke_before_delete
  on public.google_health_connections;
create trigger google_health_connection_queue_revoke_before_delete
before delete on public.google_health_connections
for each row execute function public.queue_google_health_credential_before_delete();

drop trigger if exists google_health_pending_queue_revoke_before_delete
  on public.google_health_pending_grants;
create trigger google_health_pending_queue_revoke_before_delete
before delete on public.google_health_pending_grants
for each row execute function public.queue_google_health_credential_before_delete();

-- Removes Google stable IDs from user-intent metadata only after the
-- authoritative provider row is gone (or the user requests a full delete).
-- Native/manual tombstones and overrides remain untouched.
create or replace function public.scrub_google_health_snapshot_settings(
  p_settings jsonb,
  p_entry_ids text[],
  p_remove_all_google boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_settings jsonb := case
    when jsonb_typeof(p_settings) = 'object' then p_settings
    else '{}'::jsonb
  end;
  v_key text;
  v_values jsonb;
begin
  if (select auth.role()) is distinct from 'service_role' then
    raise exception 'google_health_service_role_required' using errcode = '42501';
  end if;
  foreach v_key in array array[
    'dismissedHealthEntryIds',
    'deletedEntryIds',
    'pendingDeletedEntryIds'
  ] loop
    if jsonb_typeof(v_settings -> v_key) = 'array' then
      select coalesce(jsonb_agg(to_jsonb(value)), '[]'::jsonb)
        into v_values
        from jsonb_array_elements_text(v_settings -> v_key) value
       where not (
         value = any(coalesce(p_entry_ids, '{}'))
         or (coalesce(p_remove_all_google, false) and value like 'google-health:%')
       );
      v_settings := jsonb_set(v_settings, array[v_key], v_values, true);
    end if;
  end loop;
  if jsonb_typeof(v_settings -> 'googleHealthEntryOverrides') = 'object' then
    select coalesce(jsonb_object_agg(item.key, item.value), '{}'::jsonb)
      into v_values
      from jsonb_each(v_settings -> 'googleHealthEntryOverrides') item
     where not (
       item.key = any(coalesce(p_entry_ids, '{}'))
       or (coalesce(p_remove_all_google, false) and item.key like 'google-health:%')
     );
    v_settings := jsonb_set(
      v_settings,
      '{googleHealthEntryOverrides}',
      v_values,
      true
    );
  end if;
  return v_settings;
end;
$$;

revoke all on function public.scrub_google_health_snapshot_settings(jsonb, text[], boolean)
  from public, anon, authenticated;
grant execute on function public.scrub_google_health_snapshot_settings(jsonb, text[], boolean)
  to service_role;

-- Remove Google-owned relational projections when their authoritative source
-- record disappears. The account snapshot remains the owner source of truth,
-- while tombstones and privacy fences keep offline group caches from
-- resurrecting a deleted exact value. Daily aggregates are removed
-- conservatively and rebuilt by the ordinary client publisher if other shared
-- values remain for that tracker/day.
create or replace function public.purge_google_health_group_projections(
  p_user_id uuid,
  p_entry_ids text[],
  p_snapshot_revision bigint,
  p_purge_all boolean default false
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ids text[] := '{}';
  v_targets jsonb := '[]'::jsonb;
  v_target jsonb;
  v_group record;
  v_changed integer := 0;
  v_count integer := 0;
  v_fence_revision bigint := greatest(coalesce(p_snapshot_revision, 0), 1);
begin
  if (select auth.role()) is distinct from 'service_role' then
    raise exception 'google_health_service_role_required' using errcode = '42501';
  end if;

  select coalesce(array_agg(distinct candidate.entry_id), '{}')
    into v_ids
    from (
      select nullif(value, '') as entry_id
        from unnest(coalesce(p_entry_ids, '{}')) supplied(value)
      union all
      select entry.client_generated_id
        from public.metric_entries entry
       where coalesce(p_purge_all, false)
         and entry.user_id = p_user_id
         and (
           entry.source_provider = 'google_health'
           or entry.client_generated_id like 'google-health:%'
         )
    ) candidate
   where candidate.entry_id is not null;
  if cardinality(v_ids) = 0 and not coalesce(p_purge_all, false) then
    return 0;
  end if;

  select coalesce(jsonb_agg(to_jsonb(target)), '[]'::jsonb)
    into v_targets
    from (
      select distinct
        definition.group_id,
        entry.metric_id,
        entry.local_date
        from public.metric_entries entry
        join public.metric_definitions definition on definition.id = entry.metric_id
       where entry.user_id = p_user_id
         and definition.group_id is not null
         and entry.client_generated_id = any(v_ids)
      union
      select distinct
        status.group_id,
        status.metric_id,
        status.local_date
        from public.google_health_import_records owned
        join public.metric_definitions definition
          on definition.slug = owned.entry ->> 'metricId'
         and definition.group_id is not null
        join public.daily_metric_status status
          on status.group_id = definition.group_id
         and status.metric_id = definition.id
         and status.user_id = p_user_id
         and status.local_date = case
           when coalesce(owned.entry ->> 'localDate', '') ~ '^\d{4}-\d{2}-\d{2}$'
             then (owned.entry ->> 'localDate')::date
           else owned.local_date
         end
       where owned.user_id = p_user_id
         and owned.entry_id = any(v_ids)
      union
      -- Client provenance is projection-specific: the marker is present only
      -- when removing Google rows changes a published status field.  A source
      -- edit can propagate through formulas, journey goals, or latest-value
      -- carry-forward well beyond the source metric/day.  The server does not
      -- re-evaluate those formulas, so every currently Google-derived status
      -- is the conservative dependency closure for any authoritative Google
      -- change.  Purge and fence that closure even during ordinary webhook or
      -- entry mutations; unrelated manual/native statuses remain unmarked.
      select distinct
        status.group_id,
        status.metric_id,
        status.local_date
        from public.daily_metric_status status
       where status.user_id = p_user_id
         and status.source_provider = 'google_health'
    ) target;

  insert into public.metric_entry_tombstones (
    group_id, user_id, client_generated_id, local_date, visibility, deleted_at
  )
  select
    definition.group_id,
    p_user_id,
    entry.client_generated_id,
    entry.local_date,
    entry.visibility,
    statement_timestamp()
    from public.metric_entries entry
    join public.metric_definitions definition on definition.id = entry.metric_id
   where entry.user_id = p_user_id
     and definition.group_id is not null
     and entry.client_generated_id = any(v_ids)
  on conflict (user_id, client_generated_id) do update
    set group_id = excluded.group_id,
        local_date = excluded.local_date,
        visibility = case
          when public.metric_entry_tombstones.visibility::text = 'group'
            or excluded.visibility::text = 'group'
          then 'group'::public.entry_visibility
          else excluded.visibility
        end,
        deleted_at = excluded.deleted_at;

  delete from public.push_dispatch_events event
   where event.dispatcher_id = p_user_id
     and coalesce(event.data ->> 'entryId', '') = any(v_ids);
  get diagnostics v_count = row_count;
  v_changed := v_changed + v_count;

  delete from public.metric_entries entry
   where entry.user_id = p_user_id
     and entry.client_generated_id = any(v_ids);
  get diagnostics v_count = row_count;
  v_changed := v_changed + v_count;

  for v_target in select value from jsonb_array_elements(v_targets) loop
    delete from public.daily_metric_status status
     where status.group_id = (v_target ->> 'group_id')::uuid
       and status.metric_id = (v_target ->> 'metric_id')::uuid
       and status.user_id = p_user_id
       and status.local_date = (v_target ->> 'local_date')::date;
    get diagnostics v_count = row_count;
    v_changed := v_changed + v_count;

    insert into public.metric_privacy_cache_fences (
      group_id, metric_id, user_id, revision
    ) values (
      (v_target ->> 'group_id')::uuid,
      (v_target ->> 'metric_id')::uuid,
      p_user_id,
      v_fence_revision
    )
    on conflict (group_id, metric_id, user_id) do update
      set revision = excluded.revision
      where public.metric_privacy_cache_fences.revision < excluded.revision;
  end loop;

  for v_group in
    select
      (value ->> 'group_id')::uuid as group_id,
      min((value ->> 'local_date')::date) as since_date
      from jsonb_array_elements(v_targets)
     group by value ->> 'group_id'
  loop
    insert into public.group_activity_versions (
      group_id, version, since_date, updated_at
    ) values (
      v_group.group_id,
      1,
      greatest(v_group.since_date, current_date - 120),
      statement_timestamp()
    )
    on conflict (group_id) do update
      set version = public.group_activity_versions.version + 1,
          since_date = least(
            public.group_activity_versions.since_date,
            excluded.since_date
          ),
          updated_at = excluded.updated_at;
  end loop;

  return v_changed;
end;
$$;

revoke all on function public.purge_google_health_group_projections(uuid, text[], bigint, boolean)
  from public, anon, authenticated;
grant execute on function public.purge_google_health_group_projections(uuid, text[], bigint, boolean)
  to service_role;

-- Authenticated clients reach this service-role-only RPC through the
-- google-health Edge Function.  It is the sole mutation boundary for
-- user-authored Google entry visibility/time overrides and dismissals.
create or replace function public.mutate_google_health_entry(
  p_user_id uuid,
  p_entry_id text,
  p_action text,
  p_patch jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owned public.google_health_import_records%rowtype;
  v_preference public.google_health_entry_preferences%rowtype;
  v_payload jsonb;
  v_original_payload jsonb;
  v_entries jsonb;
  v_settings jsonb;
  v_registry jsonb;
  v_override jsonb;
  v_entry jsonb;
  v_revision bigint;
  v_visibility text;
  v_recorded_at timestamptz;
  v_display_date date;
  v_has_time boolean;
begin
  if (select auth.role()) is distinct from 'service_role' then
    raise exception 'google_health_service_role_required' using errcode = '42501';
  end if;
  if not public.google_health_runtime_enabled() then
    raise exception 'google_health_feature_disabled' using errcode = '55000';
  end if;
  if p_user_id is null
     or nullif(p_entry_id, '') is null
     or length(p_entry_id) > 360
     or p_action not in ('update', 'dismiss')
     or jsonb_typeof(coalesce(p_patch, '{}'::jsonb)) <> 'object' then
    raise exception 'invalid_google_health_entry_mutation' using errcode = '22023';
  end if;
  if exists (
    select 1 from jsonb_object_keys(coalesce(p_patch, '{}'::jsonb)) key
     where key not in ('visibility', 'recordedAtOverride', 'localDate')
  ) then
    raise exception 'invalid_google_health_entry_patch' using errcode = '22023';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_user_id::text, 744218));
  if exists (
    select 1 from public.google_health_account_deletion_guards guard
     where guard.user_id = p_user_id
  ) then
    raise exception 'google_health_account_deleting' using errcode = '55000';
  end if;

  select snapshot.payload, snapshot.revision
    into v_payload, v_revision
    from public.user_snapshots snapshot
   where snapshot.user_id = p_user_id
   for update;
  if v_revision is null or jsonb_typeof(coalesce(v_payload -> 'entries', '[]'::jsonb)) <> 'array' then
    raise exception 'google_health_snapshot_missing' using errcode = 'P0002';
  end if;
  select * into v_owned
    from public.google_health_import_records owned
   where owned.user_id = p_user_id
     and owned.entry_id = p_entry_id
   order by owned.updated_at desc
   limit 1
   for update;
  select * into v_preference
    from public.google_health_entry_preferences preference
   where preference.user_id = p_user_id
     and preference.entry_id = p_entry_id
   for update;
  if v_owned.entry_id is null and (p_action <> 'dismiss' or v_preference.entry_id is null) then
    raise exception 'google_health_entry_not_found' using errcode = 'P0002';
  end if;
  v_original_payload := v_payload;
  v_entries := coalesce(v_payload -> 'entries', '[]'::jsonb);
  v_settings := case when jsonb_typeof(v_payload -> 'settings') = 'object'
    then v_payload -> 'settings' else '{}'::jsonb end;
  v_registry := case when jsonb_typeof(v_settings -> 'googleHealthEntryOverrides') = 'object'
    then v_settings -> 'googleHealthEntryOverrides' else '{}'::jsonb end;
  v_override := case when jsonb_typeof(v_registry -> p_entry_id) = 'object'
    then v_registry -> p_entry_id else '{}'::jsonb end;

  if p_action = 'update' then
    if p_patch = '{}'::jsonb then
      raise exception 'empty_google_health_entry_patch' using errcode = '22023';
    end if;
    v_entry := v_owned.entry;
    if coalesce(v_entry ->> 'sourceProvider', '') <> 'google_health' then
      raise exception 'google_health_entry_not_found' using errcode = 'P0002';
    end if;

    if p_patch ? 'visibility' then
      if jsonb_typeof(p_patch -> 'visibility') <> 'string'
         or (p_patch ->> 'visibility') not in ('private', 'status', 'group') then
        raise exception 'invalid_google_health_visibility' using errcode = '22023';
      end if;
      v_visibility := p_patch ->> 'visibility';
      v_entry := jsonb_set(v_entry, '{visibility}', to_jsonb(v_visibility), true);
      v_override := jsonb_set(v_override, '{visibility}', to_jsonb(v_visibility), true);
    else
      v_visibility := v_preference.visibility;
    end if;

    v_has_time := p_patch ? 'recordedAtOverride' or p_patch ? 'localDate';
    if v_has_time and not (p_patch ? 'recordedAtOverride' and p_patch ? 'localDate') then
      raise exception 'google_health_time_fields_must_be_paired' using errcode = '22023';
    end if;
    if v_has_time then
      if jsonb_typeof(p_patch -> 'recordedAtOverride') = 'null'
         and jsonb_typeof(p_patch -> 'localDate') = 'null' then
        if nullif(v_entry ->> 'sourceRecordedAt', '') is null then
          raise exception 'google_health_override_clear_requires_sync' using errcode = '55000';
        end if;
        v_entry := (v_entry - 'recordedAtOverride') || jsonb_build_object(
          'recordedAt', v_entry ->> 'sourceRecordedAt',
          'localDate', v_owned.local_date::text
        );
        v_override := v_override - 'recordedAtOverride' - 'localDate';
        v_recorded_at := null;
        v_display_date := null;
      else
        if jsonb_typeof(p_patch -> 'recordedAtOverride') <> 'string'
           or coalesce(p_patch ->> 'recordedAtOverride', '') !~
             '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$'
           or jsonb_typeof(p_patch -> 'localDate') <> 'string'
           or coalesce(p_patch ->> 'localDate', '') !~ '^\d{4}-\d{2}-\d{2}$' then
          raise exception 'invalid_google_health_recorded_time' using errcode = '22023';
        end if;
        begin
          v_recorded_at := (p_patch ->> 'recordedAtOverride')::timestamptz;
          v_display_date := (p_patch ->> 'localDate')::date;
        exception when others then
          raise exception 'invalid_google_health_recorded_time' using errcode = '22023';
        end;
        if coalesce(v_entry ->> 'metricId', '') <> 'food' then
          raise exception 'google_health_time_override_food_only' using errcode = '22023';
        end if;
        v_entry := v_entry || jsonb_build_object(
          'recordedAtOverride', p_patch ->> 'recordedAtOverride',
          'recordedAt', p_patch ->> 'recordedAtOverride',
          'localDate', p_patch ->> 'localDate'
        );
        v_override := v_override || jsonb_build_object(
          'recordedAtOverride', p_patch ->> 'recordedAtOverride',
          'localDate', p_patch ->> 'localDate'
        );
      end if;
    else
      v_recorded_at := v_preference.recorded_at_override;
      v_display_date := v_preference.display_local_date;
    end if;
    v_override := v_override - 'dismissed';
    v_registry := jsonb_set(v_registry, array[p_entry_id], v_override, true);
    v_settings := jsonb_set(v_settings, '{googleHealthEntryOverrides}', v_registry, true);

    select coalesce(jsonb_agg(
      case when entry ->> 'id' = p_entry_id then v_entry else entry end
      order by ordinality
    ), '[]'::jsonb)
      into v_entries
      from jsonb_array_elements(v_entries) with ordinality item(entry, ordinality);
    v_payload := jsonb_set(
      jsonb_set(v_payload, '{entries}', v_entries, true),
      '{settings}', v_settings, true
    );
    if v_payload is distinct from v_original_payload then
      update public.user_snapshots snapshot
         set payload = v_payload,
             revision = snapshot.revision + 1,
             device_id = 'google-health-server',
             updated_at = now()
       where snapshot.user_id = p_user_id
       returning snapshot.revision into v_revision;
    end if;
    update public.google_health_import_records owned
       set entry = v_entry, updated_at = now()
     where owned.user_id = p_user_id and owned.entry_id = p_entry_id;
    insert into public.google_health_entry_preferences (
      user_id, entry_id, metric_id, data_type, source_local_date, visibility,
      recorded_at_override, display_local_date, dismissed, updated_at
    ) values (
      p_user_id, p_entry_id, v_owned.entry ->> 'metricId', v_owned.data_type, v_owned.local_date, v_visibility,
      v_recorded_at, v_display_date, false, now()
    )
    on conflict (user_id, entry_id) do update
      set metric_id = excluded.metric_id,
          data_type = excluded.data_type,
          source_local_date = excluded.source_local_date,
          visibility = excluded.visibility,
          recorded_at_override = excluded.recorded_at_override,
          display_local_date = excluded.display_local_date,
          dismissed = false,
          updated_at = excluded.updated_at;
    perform public.purge_google_health_group_projections(
      p_user_id, array[p_entry_id], v_revision, false
    );
    return jsonb_build_object('entry', v_entry, 'revision', v_revision);
  end if;

  -- Dismiss is idempotent once the server-owned preference exists.  It keeps
  -- only the stable suppression metadata, not the provider measurement.
  insert into public.google_health_entry_preferences (
    user_id, entry_id, metric_id, data_type, source_local_date, visibility,
    recorded_at_override, display_local_date, dismissed, updated_at
  ) values (
    p_user_id,
    p_entry_id,
    coalesce(v_owned.entry ->> 'metricId', v_preference.metric_id),
    coalesce(v_owned.data_type, v_preference.data_type),
    coalesce(v_owned.local_date, v_preference.source_local_date),
    coalesce(v_preference.visibility,
      case when v_owned.entry ->> 'visibility' in ('private', 'status', 'group')
        then v_owned.entry ->> 'visibility' else null end),
    v_preference.recorded_at_override,
    v_preference.display_local_date,
    true,
    now()
  )
  on conflict (user_id, entry_id) do update
    set dismissed = true, updated_at = excluded.updated_at;
  v_override := v_override || jsonb_build_object('dismissed', true);
  v_registry := jsonb_set(v_registry, array[p_entry_id], v_override, true);
  v_settings := jsonb_set(v_settings, '{googleHealthEntryOverrides}', v_registry, true);
  select coalesce(jsonb_agg(entry order by ordinality), '[]'::jsonb)
    into v_entries
    from jsonb_array_elements(v_entries) with ordinality item(entry, ordinality)
   where entry ->> 'id' <> p_entry_id;
  v_payload := jsonb_set(
    jsonb_set(v_payload, '{entries}', v_entries, true),
    '{settings}', v_settings, true
  );
  if v_payload is distinct from v_original_payload then
    update public.user_snapshots snapshot
       set payload = v_payload,
           revision = snapshot.revision + 1,
           device_id = 'google-health-server',
           updated_at = now()
     where snapshot.user_id = p_user_id
     returning snapshot.revision into v_revision;
  end if;
  perform public.purge_google_health_group_projections(
    p_user_id, array[p_entry_id], v_revision, false
  );
  delete from public.google_health_import_records owned
   where owned.user_id = p_user_id and owned.entry_id = p_entry_id;
  return jsonb_build_object('dismissedEntryId', p_entry_id, 'revision', v_revision);
end;
$$;

revoke all on function public.mutate_google_health_entry(uuid, text, text, jsonb)
  from public, anon, authenticated;
grant execute on function public.mutate_google_health_entry(uuid, text, text, jsonb)
  to service_role;

-- Metric editors propagate a changed tracker default to Google rows that do
-- not have an explicit per-entry preference. Explicit entry choices continue
-- to win, and the default itself is updated in the authoritative snapshot.
create or replace function public.update_google_health_metric_visibility(
  p_user_id uuid,
  p_metric_id text,
  p_visibility text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_payload jsonb;
  v_original_payload jsonb;
  v_entries jsonb;
  v_metrics jsonb;
  v_ids text[] := '{}';
  v_revision bigint;
begin
  if (select auth.role()) is distinct from 'service_role' then
    raise exception 'google_health_service_role_required' using errcode = '42501';
  end if;
  if not public.google_health_runtime_enabled() then
    raise exception 'google_health_feature_disabled' using errcode = '55000';
  end if;
  if p_user_id is null
     or nullif(p_metric_id, '') is null
     or length(p_metric_id) > 160
     or p_visibility not in ('private', 'status', 'group') then
    raise exception 'invalid_google_health_metric_visibility' using errcode = '22023';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_user_id::text, 744218));
  if exists (
    select 1 from public.google_health_account_deletion_guards guard
     where guard.user_id = p_user_id
  ) then
    raise exception 'google_health_account_deleting' using errcode = '55000';
  end if;
  select snapshot.payload, snapshot.revision
    into v_payload, v_revision
    from public.user_snapshots snapshot
   where snapshot.user_id = p_user_id
   for update;
  if v_revision is null or not exists (
    select 1
      from jsonb_array_elements(coalesce(v_payload -> 'metrics', '[]'::jsonb)) metric
     where metric ->> 'id' = p_metric_id
  ) then
    raise exception 'google_health_metric_not_found' using errcode = 'P0002';
  end if;
  v_original_payload := v_payload;
  v_entries := coalesce(v_payload -> 'entries', '[]'::jsonb);
  v_metrics := coalesce(v_payload -> 'metrics', '[]'::jsonb);
  select coalesce(array_agg(distinct candidate.entry_id), '{}')
    into v_ids
    from (
      select owned.entry_id
        from public.google_health_import_records owned
       where owned.user_id = p_user_id
         and owned.entry ->> 'metricId' = p_metric_id
         and not exists (
           select 1 from public.google_health_entry_preferences preference
            where preference.user_id = p_user_id
              and preference.entry_id = owned.entry_id
              and preference.visibility is not null
         )
    ) candidate;

  select coalesce(jsonb_agg(
    case
      when entry ->> 'id' = any(v_ids)
        and entry ->> 'sourceProvider' = 'google_health'
        and not exists (
          select 1 from public.google_health_entry_preferences preference
           where preference.user_id = p_user_id
             and preference.entry_id = entry ->> 'id'
             and preference.visibility is not null
        )
      then jsonb_set(entry, '{visibility}', to_jsonb(p_visibility), true)
      else entry
    end order by ordinality
  ), '[]'::jsonb)
    into v_entries
    from jsonb_array_elements(v_entries) with ordinality item(entry, ordinality);
  select coalesce(jsonb_agg(
    case when metric ->> 'id' = p_metric_id
      then jsonb_set(metric, '{defaultVisibility}', to_jsonb(p_visibility), true)
      else metric end
    order by ordinality
  ), '[]'::jsonb)
    into v_metrics
    from jsonb_array_elements(v_metrics) with ordinality item(metric, ordinality);
  v_payload := jsonb_set(
    jsonb_set(v_payload, '{entries}', v_entries, true),
    '{metrics}', v_metrics, true
  );
  if v_payload is distinct from v_original_payload then
    update public.user_snapshots snapshot
       set payload = v_payload,
           revision = snapshot.revision + 1,
           device_id = 'google-health-server',
           updated_at = now()
     where snapshot.user_id = p_user_id
     returning snapshot.revision into v_revision;
  end if;
  update public.google_health_import_records owned
     set entry = jsonb_set(owned.entry, '{visibility}', to_jsonb(p_visibility), true),
         updated_at = now()
   where owned.user_id = p_user_id
     and owned.entry ->> 'metricId' = p_metric_id
     and not exists (
       select 1 from public.google_health_entry_preferences preference
        where preference.user_id = p_user_id
          and preference.entry_id = owned.entry_id
          and preference.visibility is not null
     );
  perform public.purge_google_health_group_projections(
    p_user_id, v_ids, v_revision, false
  );
  return jsonb_build_object(
    'metricId', p_metric_id,
    'visibility', p_visibility,
    'updatedCount', cardinality(v_ids),
    'revision', v_revision
  );
end;
$$;

revoke all on function public.update_google_health_metric_visibility(uuid, text, text)
  from public, anon, authenticated;
grant execute on function public.update_google_health_metric_visibility(uuid, text, text)
  to service_role;

-- Atomically replaces only the Google-owned slice that was successfully read,
-- then advances the ordinary account snapshot revision.  A device uploading a
-- stale snapshot will receive the existing revision conflict and merge rather
-- than erasing a server import.
create or replace function public.apply_google_health_import(
  p_user_id uuid,
  p_records jsonb,
  p_seen_records jsonb,
  p_replacements jsonb,
  p_synced_at timestamptz,
  p_expected_revision bigint,
  p_lease_id uuid
)
returns table (revision bigint, imported_count integer, deleted_count integer)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_removed_ids text[] := '{}';
  v_incoming_ids text[] := '{}';
  v_seen_ids text[] := '{}';
  v_purge_ids text[] := '{}';
  v_provider_gone_ids text[] := '{}';
  v_stale_preference_ids text[] := '{}';
  v_changed_projection_ids text[] := '{}';
  v_imported integer := 0;
  v_deleted integer := 0;
  v_revision bigint;
  v_active_connection uuid;
  v_entries jsonb;
  v_original_entries jsonb;
  v_payload jsonb;
  v_settings jsonb;
  v_incoming_entries jsonb := '[]'::jsonb;
begin
  if (select auth.role()) is distinct from 'service_role' then
    raise exception 'google_health_service_role_required' using errcode = '42501';
  end if;
  if not public.google_health_runtime_enabled() then
    raise exception 'google_health_feature_disabled' using errcode = '55000';
  end if;
  if p_user_id is null
     or jsonb_typeof(coalesce(p_records, '[]'::jsonb)) <> 'array'
     or jsonb_typeof(coalesce(p_seen_records, '[]'::jsonb)) <> 'array'
     or jsonb_typeof(coalesce(p_replacements, '[]'::jsonb)) <> 'array' then
    raise exception 'invalid_google_health_import' using errcode = '22023';
  end if;
  select connection.user_id into v_active_connection
    from public.google_health_connections connection
   where connection.user_id = p_user_id
     and connection.status = 'connected'
     and connection.refresh_token_ciphertext is not null
     and connection.sync_lease_id = p_lease_id
     and connection.sync_lease_until > now()
   for update;
  if p_lease_id is null or v_active_connection is null then
    raise exception 'google_health_sync_cancelled' using errcode = '57014';
  end if;
  insert into public.google_health_privacy_accounts (user_id, required_since)
  values (p_user_id, now())
  on conflict (user_id) do nothing;

  -- Lock the revision boundary before changing import ownership records.
  select snapshot.payload, coalesce(snapshot.payload -> 'entries', '[]'::jsonb), snapshot.revision
    into v_payload, v_entries, v_revision
    from public.user_snapshots snapshot
   where snapshot.user_id = p_user_id
   for update;
  if v_revision is null then
    raise exception 'google_health_snapshot_missing' using errcode = 'P0002';
  end if;
  if p_expected_revision is null or v_revision <> p_expected_revision then
    raise exception 'google_health_snapshot_conflict' using errcode = '40001';
  end if;
  if jsonb_typeof(v_entries) <> 'array' then
    raise exception 'google_health_snapshot_entries_invalid' using errcode = '22023';
  end if;
  v_original_entries := v_entries;

  select coalesce(array_agg(distinct owned.entry_id), '{}'), count(*)::integer
    into v_removed_ids, v_deleted
    from public.google_health_import_records owned
   where owned.user_id = p_user_id
     and exists (
       select 1
         from jsonb_array_elements(coalesce(p_replacements, '[]'::jsonb)) item
        where owned.data_type = item ->> 'dataType'
          and owned.local_date >= (item ->> 'fromDate')::date
          and owned.local_date <= (item ->> 'throughDate')::date
     );

  select
    coalesce(array_agg(distinct item -> 'entry' ->> 'id'), '{}'),
    coalesce(jsonb_agg(item -> 'entry'), '[]'::jsonb)
    into v_incoming_ids, v_incoming_entries
    from jsonb_array_elements(coalesce(p_records, '[]'::jsonb)) item
   where item ? 'externalId'
     and item ? 'dataType'
     and item ? 'localDate'
     and jsonb_typeof(item -> 'entry') = 'object'
     and nullif(item -> 'entry' ->> 'id', '') is not null;

  select coalesce(array_agg(distinct item ->> 'entryId'), '{}')
    into v_seen_ids
    from jsonb_array_elements(coalesce(p_seen_records, '[]'::jsonb)) item
   where nullif(item ->> 'entryId', '') is not null
     and nullif(item ->> 'dataType', '') is not null
     and coalesce(item ->> 'localDate', '') ~ '^\d{4}-\d{2}-\d{2}$';

  -- Count only genuinely new or changed ownership rows. Identical webhook or
  -- manual retries report zero updates and do not churn the account revision.
  select count(*)::integer
    into v_imported
    from jsonb_array_elements(coalesce(p_records, '[]'::jsonb)) item
   where item ? 'externalId'
     and item ? 'dataType'
     and item ? 'localDate'
     and jsonb_typeof(item -> 'entry') = 'object'
     and nullif(item -> 'entry' ->> 'id', '') is not null
     and not exists (
       select 1
         from public.google_health_import_records owned
        where owned.user_id = p_user_id
          and owned.external_id = item ->> 'externalId'
          and owned.entry_id = item -> 'entry' ->> 'id'
          and owned.data_type = item ->> 'dataType'
          and owned.local_date = (item ->> 'localDate')::date
          and owned.entry = item -> 'entry'
     );

  -- Report only records that disappeared, not the ordinary replace-in-place
  -- rows that are refreshed on every incremental reconciliation.
  select coalesce(array_agg(removed.entry_id), '{}'), count(*)::integer
    into v_purge_ids, v_deleted
    from unnest(v_removed_ids) removed(entry_id)
   where not (removed.entry_id = any(v_incoming_ids));

  -- Distinguish a provider-side deletion from a user dismissal. A dismissed
  -- record is still present in p_seen_records and retains its authoritative
  -- preference; a provider record that vanished clears stale edit metadata.
  select coalesce(array_agg(removed.entry_id), '{}')
    into v_provider_gone_ids
    from unnest(v_removed_ids) removed(entry_id)
   where not (removed.entry_id = any(v_seen_ids));

  with stale as (
    delete from public.google_health_entry_preferences preference
     where preference.user_id = p_user_id
       and preference.dismissed = false
       and exists (
         select 1
           from jsonb_array_elements(coalesce(p_replacements, '[]'::jsonb)) item
          where preference.data_type = item ->> 'dataType'
            and preference.source_local_date >= (item ->> 'fromDate')::date
            and preference.source_local_date <= (item ->> 'throughDate')::date
       )
       and not (preference.entry_id = any(v_seen_ids))
    returning preference.entry_id
  )
  select coalesce(array_agg(stale.entry_id), '{}')
    into v_stale_preference_ids
    from stale;
  select coalesce(array_agg(distinct candidate.entry_id), '{}')
    into v_provider_gone_ids
    from (
      select entry_id from unnest(v_provider_gone_ids) gone(entry_id)
      union all
      select entry_id from unnest(v_stale_preference_ids) stale(entry_id)
    ) candidate;

  -- Any new or updated stable Google ID can change direct projections and the
  -- calculated/carry-forward dependency closure. Hide stale projections behind
  -- tombstones/fences until an ordinary client publication rebuilds them from
  -- the refreshed snapshot entry.
  select coalesce(array_agg(distinct item -> 'entry' ->> 'id'), '{}')
    into v_changed_projection_ids
    from jsonb_array_elements(coalesce(p_records, '[]'::jsonb)) item
   where nullif(item -> 'entry' ->> 'id', '') is not null
     and not exists (
       select 1
         from public.google_health_import_records owned
        where owned.user_id = p_user_id
           and owned.external_id = item ->> 'externalId'
           and owned.entry_id = item -> 'entry' ->> 'id'
           and owned.data_type = item ->> 'dataType'
           and owned.local_date = (item ->> 'localDate')::date
           and owned.entry = item -> 'entry'
     );
  select coalesce(array_agg(distinct candidate.entry_id), '{}')
    into v_changed_projection_ids
    from (
      select entry_id from unnest(v_purge_ids) removed(entry_id)
      union all
      select entry_id from unnest(v_changed_projection_ids) changed(entry_id)
    ) candidate;

  -- Replace stable IDs in place so an identical reconciliation preserves JSON
  -- array order. Append only genuinely new IDs.
  select coalesce(jsonb_agg(
      coalesce(
        (
          select incoming
            from jsonb_array_elements(v_incoming_entries) incoming
           where incoming ->> 'id' = snapshot_entry.entry ->> 'id'
           limit 1
        ),
        snapshot_entry.entry
      ) order by snapshot_entry.ordinality
    ), '[]'::jsonb)
    into v_entries
    from jsonb_array_elements(v_entries) with ordinality snapshot_entry(entry, ordinality)
   where not (
     coalesce(snapshot_entry.entry ->> 'id', '') = any(v_removed_ids)
     and not (coalesce(snapshot_entry.entry ->> 'id', '') = any(v_incoming_ids))
   );

  v_entries := coalesce(v_entries, '[]'::jsonb) || coalesce((
    select jsonb_agg(incoming)
      from jsonb_array_elements(v_incoming_entries) incoming
     where not exists (
       select 1
         from jsonb_array_elements(v_original_entries) original
        where original ->> 'id' = incoming ->> 'id'
     )
  ), '[]'::jsonb);
  v_settings := public.scrub_google_health_snapshot_settings(
    v_payload -> 'settings',
    v_provider_gone_ids,
    false
  );
  if v_entries is distinct from v_original_entries
     or v_settings is distinct from coalesce(v_payload -> 'settings', '{}'::jsonb) then
    update public.user_snapshots snapshot
       set payload = jsonb_set(
             jsonb_set(snapshot.payload, '{entries}', v_entries, true),
             '{settings}',
             v_settings,
             true
           ),
           revision = snapshot.revision + 1,
           device_id = 'google-health-server',
           updated_at = coalesce(p_synced_at, now())
     where snapshot.user_id = p_user_id
     returning snapshot.revision into v_revision;
  end if;

  perform public.purge_google_health_group_projections(
    p_user_id,
    v_changed_projection_ids,
    v_revision,
    false
  );

  delete from public.google_health_import_records owned
   where owned.user_id = p_user_id
     and exists (
       select 1
         from jsonb_array_elements(coalesce(p_replacements, '[]'::jsonb)) item
        where owned.data_type = item ->> 'dataType'
          and owned.local_date >= (item ->> 'fromDate')::date
          and owned.local_date <= (item ->> 'throughDate')::date
     );

  insert into public.google_health_import_records (
    user_id, external_id, data_type, local_date, entry_id, entry, updated_at
  )
  select
    p_user_id,
    item ->> 'externalId',
    item ->> 'dataType',
    (item ->> 'localDate')::date,
    item -> 'entry' ->> 'id',
    item -> 'entry',
    coalesce(p_synced_at, now())
  from jsonb_array_elements(coalesce(p_records, '[]'::jsonb)) item
  where item ? 'externalId'
    and item ? 'dataType'
    and item ? 'localDate'
    and jsonb_typeof(item -> 'entry') = 'object'
    and nullif(item -> 'entry' ->> 'id', '') is not null
  on conflict (user_id, external_id, entry_id) do update
    set data_type = excluded.data_type,
        local_date = excluded.local_date,
        entry = excluded.entry,
        updated_at = excluded.updated_at;

  return query select v_revision, v_imported, v_deleted;
end;
$$;

revoke all on function public.apply_google_health_import(uuid, jsonb, jsonb, jsonb, timestamptz, bigint, uuid)
  from public, anon, authenticated;
grant execute on function public.apply_google_health_import(uuid, jsonb, jsonb, jsonb, timestamptz, bigint, uuid)
  to service_role;

create or replace function public.delete_google_health_imports(p_user_id uuid)
returns table (revision bigint, deleted_count integer)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ids text[] := '{}';
  v_deleted integer := 0;
  v_payload jsonb;
  v_original_payload jsonb;
  v_entries jsonb;
  v_settings jsonb;
  v_revision bigint;
begin
  if (select auth.role()) is distinct from 'service_role' then
    raise exception 'google_health_service_role_required' using errcode = '42501';
  end if;

  select snapshot.payload, snapshot.revision
    into v_payload, v_revision
    from public.user_snapshots snapshot
   where snapshot.user_id = p_user_id
   for update;
  v_original_payload := v_payload;
  v_entries := coalesce(v_payload -> 'entries', '[]'::jsonb);
  v_settings := coalesce(v_payload -> 'settings', '{}'::jsonb);

  select coalesce(array_agg(distinct candidate.entry_id), '{}')
    into v_ids
    from (
      select owned.entry_id
        from public.google_health_import_records owned
       where owned.user_id = p_user_id
      union all
      select preference.entry_id
        from public.google_health_entry_preferences preference
       where preference.user_id = p_user_id
      union all
      select entry ->> 'id'
        from jsonb_array_elements(coalesce(v_entries, '[]'::jsonb)) entry
       where coalesce(entry ->> 'id', '') like 'google-health:%'
      union all
      select value
        from jsonb_array_elements_text(
          case when jsonb_typeof(v_settings -> 'dismissedHealthEntryIds') = 'array'
            then v_settings -> 'dismissedHealthEntryIds' else '[]'::jsonb end
        ) value
       where value like 'google-health:%'
      union all
      select value
        from jsonb_array_elements_text(
          case when jsonb_typeof(v_settings -> 'deletedEntryIds') = 'array'
            then v_settings -> 'deletedEntryIds' else '[]'::jsonb end
        ) value
       where value like 'google-health:%'
      union all
      select value
        from jsonb_array_elements_text(
          case when jsonb_typeof(v_settings -> 'pendingDeletedEntryIds') = 'array'
            then v_settings -> 'pendingDeletedEntryIds' else '[]'::jsonb end
        ) value
       where value like 'google-health:%'
    ) candidate
   where nullif(candidate.entry_id, '') is not null;
  select count(*)::integer into v_deleted
    from public.google_health_import_records owned
   where owned.user_id = p_user_id;

  if v_revision is not null then
    select coalesce(jsonb_agg(entry), '[]'::jsonb)
      into v_entries
      from jsonb_array_elements(coalesce(v_entries, '[]'::jsonb)) entry
     where not (
       coalesce(entry ->> 'id', '') = any(v_ids)
       or coalesce(entry ->> 'id', '') like 'google-health:%'
     );

    v_settings := public.scrub_google_health_snapshot_settings(
      v_settings,
      v_ids,
      true
    );
    v_payload := jsonb_set(
      jsonb_set(v_payload, '{entries}', v_entries, true),
      '{settings}',
      v_settings,
      true
    );
    if v_payload is distinct from v_original_payload then
      update public.user_snapshots snapshot
         set payload = v_payload,
             revision = snapshot.revision + 1,
             device_id = 'google-health-server',
             updated_at = now()
       where snapshot.user_id = p_user_id
       returning snapshot.revision into v_revision;
    end if;
  end if;

  perform public.purge_google_health_group_projections(
    p_user_id,
    v_ids,
    v_revision,
    true
  );
  delete from public.google_health_import_records where user_id = p_user_id;
  delete from public.google_health_entry_preferences where user_id = p_user_id;

  return query select v_revision, v_deleted;
end;
$$;

revoke all on function public.delete_google_health_imports(uuid)
  from public, anon, authenticated;
grant execute on function public.delete_google_health_imports(uuid)
  to service_role;

-- Serializes all manual, callback, and webhook reconciliation for one account.
-- It also limits manual retries so a compromised browser session cannot burn
-- through the pilot quota. An expired lease is safely reclaimable after a
-- killed Edge invocation.
create or replace function public.claim_google_health_sync(
  p_user_id uuid,
  p_manual boolean default false
)
returns table (lease_id uuid, denial_reason text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_connection public.google_health_connections%rowtype;
  v_lease uuid;
begin
  if (select auth.role()) is distinct from 'service_role' then
    raise exception 'google_health_service_role_required' using errcode = '42501';
  end if;
  if not public.google_health_runtime_enabled() then
    return query select null::uuid, 'feature_disabled'::text;
    return;
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_user_id::text, 744218));
  if exists (
    select 1 from public.google_health_account_deletion_guards guard
     where guard.user_id = p_user_id
  ) then
    return query select null::uuid, 'account_deleting'::text;
    return;
  end if;
  select * into v_connection
    from public.google_health_connections connection
   where connection.user_id = p_user_id
   for update;
  if v_connection.user_id is null
     or v_connection.status <> 'connected'
     or v_connection.refresh_token_ciphertext is null then
    return query select null::uuid, 'not_connected'::text;
    return;
  end if;
  if v_connection.sync_lease_until is not null
     and v_connection.sync_lease_until > now() then
    return query select null::uuid, 'sync_busy'::text;
    return;
  end if;
  if coalesce(p_manual, false)
     and v_connection.last_manual_sync_at is not null
     and v_connection.last_manual_sync_at > now() - interval '30 seconds' then
    return query select null::uuid, 'rate_limited'::text;
    return;
  end if;
  v_lease := gen_random_uuid();
  update public.google_health_connections connection
     set sync_lease_id = v_lease,
         sync_lease_until = now() + interval '30 minutes',
         last_manual_sync_at = case
           when coalesce(p_manual, false) then now()
           else connection.last_manual_sync_at
         end
   where connection.user_id = p_user_id;
  return query select v_lease, null::text;
end;
$$;

revoke all on function public.claim_google_health_sync(uuid, boolean)
  from public, anon, authenticated;
grant execute on function public.claim_google_health_sync(uuid, boolean)
  to service_role;

create or replace function public.release_google_health_sync(
  p_user_id uuid,
  p_lease_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select auth.role()) is distinct from 'service_role' then
    raise exception 'google_health_service_role_required' using errcode = '42501';
  end if;
  update public.google_health_connections connection
     set sync_lease_id = null,
         sync_lease_until = null
   where connection.user_id = p_user_id
     and connection.sync_lease_id = p_lease_id;
end;
$$;

revoke all on function public.release_google_health_sync(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.release_google_health_sync(uuid, uuid)
  to service_role;

-- Persists a provider-issued replacement refresh token under the active sync
-- lease.  The nonce/hash/generation tuple makes a retry idempotent after a
-- post-commit response loss: callers can repeat this RPC or re-read the exact
-- stored tuple without ever revoking a credential that may already be active.
create or replace function public.persist_google_health_refresh_replacement(
  p_user_id uuid,
  p_lease_id uuid,
  p_expected_generation bigint,
  p_replacement_nonce uuid,
  p_refresh_token_fingerprint text,
  p_refresh_token_ciphertext text,
  p_refresh_token_iv text,
  p_encryption_key_version smallint,
  p_granted_scopes text[],
  p_refresh_token_expires_at timestamptz default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_connection public.google_health_connections%rowtype;
begin
  if (select auth.role()) is distinct from 'service_role' then
    raise exception 'google_health_service_role_required' using errcode = '42501';
  end if;
  if not public.google_health_runtime_enabled() then
    raise exception 'google_health_feature_disabled' using errcode = '55000';
  end if;
  if p_user_id is null
     or p_lease_id is null
     or p_expected_generation is null
     or p_expected_generation < 0
     or p_replacement_nonce is null
     or coalesce(p_refresh_token_fingerprint, '') !~ '^[a-f0-9]{64}$'
     or nullif(p_refresh_token_ciphertext, '') is null
     or nullif(p_refresh_token_iv, '') is null
     or coalesce(p_encryption_key_version, 0) <= 0
     or p_granted_scopes is null then
    raise exception 'invalid_google_health_refresh_replacement' using errcode = '22023';
  end if;

  select * into v_connection
    from public.google_health_connections connection
   where connection.user_id = p_user_id
   for update;

  -- A retry after a committed-but-lost response succeeds without another
  -- generation bump or ciphertext rewrite.
  if v_connection.user_id is not null
     and v_connection.status = 'connected'
     and v_connection.sync_lease_id = p_lease_id
     and v_connection.sync_lease_until > now()
     and v_connection.connection_generation = p_expected_generation + 1
     and v_connection.refresh_replacement_nonce = p_replacement_nonce
     and v_connection.refresh_token_fingerprint = p_refresh_token_fingerprint
     and v_connection.refresh_token_ciphertext = p_refresh_token_ciphertext
     and v_connection.refresh_token_iv = p_refresh_token_iv
     and v_connection.encryption_key_version = p_encryption_key_version then
    return jsonb_build_object(
      'outcome', 'applied',
      'connectionGeneration', v_connection.connection_generation,
      'replacementNonce', v_connection.refresh_replacement_nonce,
      'refreshTokenFingerprint', v_connection.refresh_token_fingerprint
    );
  end if;

  if v_connection.user_id is null
     or v_connection.status <> 'connected'
     or v_connection.refresh_token_ciphertext is null
     or v_connection.connection_generation <> p_expected_generation
     or v_connection.sync_lease_id is distinct from p_lease_id
     or v_connection.sync_lease_until is null
     or v_connection.sync_lease_until <= now() then
    return jsonb_build_object(
      'outcome', 'rejected',
      'connectionGeneration', v_connection.connection_generation,
      'replacementNonce', v_connection.refresh_replacement_nonce,
      'refreshTokenFingerprint', v_connection.refresh_token_fingerprint
    );
  end if;

  update public.google_health_connections connection
     set refresh_token_ciphertext = p_refresh_token_ciphertext,
         refresh_token_iv = p_refresh_token_iv,
         refresh_token_fingerprint = p_refresh_token_fingerprint,
         refresh_replacement_nonce = p_replacement_nonce,
         encryption_key_version = p_encryption_key_version,
         granted_scopes = p_granted_scopes,
         refresh_token_expires_at = coalesce(
           p_refresh_token_expires_at,
           connection.refresh_token_expires_at
         ),
         connection_generation = connection.connection_generation + 1
   where connection.user_id = p_user_id
   returning connection.* into v_connection;

  return jsonb_build_object(
    'outcome', 'applied',
    'connectionGeneration', v_connection.connection_generation,
    'replacementNonce', v_connection.refresh_replacement_nonce,
    'refreshTokenFingerprint', v_connection.refresh_token_fingerprint
  );
end;
$$;

revoke all on function public.persist_google_health_refresh_replacement(
  uuid, uuid, bigint, uuid, text, text, text, smallint, text[], timestamptz
) from public, anon, authenticated;
grant execute on function public.persist_google_health_refresh_replacement(
  uuid, uuid, bigint, uuid, text, text, text, smallint, text[], timestamptz
) to service_role;

create or replace function public.finish_google_health_sync(
  p_user_id uuid,
  p_lease_id uuid,
  p_successes jsonb,
  p_errors jsonb,
  p_synced_at timestamptz
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_connection public.google_health_connections%rowtype;
  v_item jsonb;
begin
  if (select auth.role()) is distinct from 'service_role' then
    raise exception 'google_health_service_role_required' using errcode = '42501';
  end if;
  select * into v_connection
    from public.google_health_connections connection
   where connection.user_id = p_user_id
   for update;
  if v_connection.user_id is null
     or v_connection.status <> 'connected'
     or v_connection.refresh_token_ciphertext is null
     or v_connection.sync_lease_id is distinct from p_lease_id
     or v_connection.sync_lease_until is null
     or v_connection.sync_lease_until <= now() then
    return false;
  end if;
  for v_item in select value from jsonb_array_elements(coalesce(p_successes, '[]'::jsonb)) loop
    insert into public.google_health_sync_cursors (
      user_id, data_type, cursor, last_success_at, last_error_code, last_error_at
    ) values (
      p_user_id,
      v_item ->> 'dataType',
      jsonb_build_object('throughDate', v_item ->> 'throughDate'),
      p_synced_at,
      null,
      null
    )
    on conflict (user_id, data_type) do update
      set cursor = excluded.cursor,
          last_success_at = excluded.last_success_at,
          last_error_code = null,
          last_error_at = null;
  end loop;
  for v_item in select value from jsonb_array_elements(coalesce(p_errors, '[]'::jsonb)) loop
    insert into public.google_health_sync_cursors (
      user_id, data_type, cursor, last_error_code, last_error_at
    ) values (
      p_user_id,
      v_item ->> 'dataType',
      '{}'::jsonb,
      v_item ->> 'code',
      p_synced_at
    )
    on conflict (user_id, data_type) do update
      set last_error_code = excluded.last_error_code,
          last_error_at = excluded.last_error_at;
  end loop;
  update public.google_health_connections connection
     set status = 'connected',
         last_synced_at = p_synced_at,
         last_error_code = coalesce(p_errors -> 0 ->> 'code', null),
         last_error_at = case
           when jsonb_array_length(coalesce(p_errors, '[]'::jsonb)) > 0 then p_synced_at
           else null
         end,
         sync_lease_id = null,
         sync_lease_until = null
   where connection.user_id = p_user_id;
  return true;
end;
$$;

revoke all on function public.finish_google_health_sync(uuid, uuid, jsonb, jsonb, timestamptz)
  from public, anon, authenticated;
grant execute on function public.finish_google_health_sync(uuid, uuid, jsonb, jsonb, timestamptz)
  to service_role;

-- Disconnect/delete wins over callbacks and in-flight workers. This one
-- transaction invalidates OAuth states and the active sync lease before the
-- ciphertext is returned to the Edge Function for best-effort Google revoke.
create or replace function public.detach_google_health_connection(p_user_id uuid)
returns table (
  revocation_id uuid,
  refresh_token_ciphertext text,
  refresh_token_iv text,
  encryption_key_version smallint
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_connection public.google_health_connections%rowtype;
begin
  if (select auth.role()) is distinct from 'service_role' then
    raise exception 'google_health_service_role_required' using errcode = '42501';
  end if;
  select * into v_connection
    from public.google_health_connections connection
   where connection.user_id = p_user_id
   for update;
  if v_connection.refresh_token_ciphertext is not null then
    return query
      insert into public.google_health_revocation_queue (
        user_id, refresh_token_ciphertext, refresh_token_iv, encryption_key_version
      ) values (
        p_user_id,
        v_connection.refresh_token_ciphertext,
        v_connection.refresh_token_iv,
        v_connection.encryption_key_version
      )
      returning
        google_health_revocation_queue.id,
        google_health_revocation_queue.refresh_token_ciphertext,
        google_health_revocation_queue.refresh_token_iv,
        google_health_revocation_queue.encryption_key_version;
  end if;
  return query
    insert into public.google_health_revocation_queue (
      user_id, refresh_token_ciphertext, refresh_token_iv, encryption_key_version
    )
    select
      staged.user_id,
      staged.refresh_token_ciphertext,
      staged.refresh_token_iv,
      staged.encryption_key_version
      from public.google_health_pending_grants staged
     where staged.user_id = p_user_id
    returning
      google_health_revocation_queue.id,
      google_health_revocation_queue.refresh_token_ciphertext,
      google_health_revocation_queue.refresh_token_iv,
      google_health_revocation_queue.encryption_key_version;
  delete from public.google_health_oauth_states state where state.user_id = p_user_id;
  delete from public.google_health_sync_cursors cursor where cursor.user_id = p_user_id;
  delete from public.google_health_pending_grants staged where staged.user_id = p_user_id;
  if v_connection.user_id is not null then
    update public.google_health_connections connection
       set status = 'disconnected',
           granted_scopes = '{}',
           refresh_token_ciphertext = null,
           refresh_token_iv = null,
           refresh_token_fingerprint = null,
           refresh_replacement_nonce = null,
           refresh_token_expires_at = null,
           sync_lease_id = null,
           sync_lease_until = null,
           last_error_code = null,
           last_error_at = null,
           connection_generation = connection.connection_generation + 1
     where connection.user_id = p_user_id;
  end if;
end;
$$;

revoke all on function public.detach_google_health_connection(uuid)
  from public, anon, authenticated;
grant execute on function public.detach_google_health_connection(uuid)
  to service_role;

-- Starts (or restarts) browser authorization in one transaction. Old staged
-- grants are durably queued for revoke before their completion tokens are
-- invalidated. An already-connected account must explicitly disconnect first.
create or replace function public.create_google_health_oauth_state(
  p_user_id uuid,
  p_state_hash text,
  p_verifier_ciphertext text,
  p_verifier_iv text,
  p_verifier_key_version smallint,
  p_return_to text,
  p_expires_at timestamptz
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_connection public.google_health_connections%rowtype;
  v_generation bigint;
begin
  if (select auth.role()) is distinct from 'service_role' then
    raise exception 'google_health_service_role_required' using errcode = '42501';
  end if;
  if not public.google_health_runtime_enabled() then
    raise exception 'google_health_feature_disabled' using errcode = '55000';
  end if;
  if p_user_id is null
     or coalesce(p_state_hash, '') !~ '^[a-f0-9]{64}$'
     or nullif(p_verifier_ciphertext, '') is null
     or nullif(p_verifier_iv, '') is null
     or coalesce(p_verifier_key_version, 0) <= 0
     or nullif(p_return_to, '') is null
     or p_expires_at is null
     or p_expires_at <= now()
     or not exists (select 1 from auth.users account where account.id = p_user_id) then
    raise exception 'invalid_google_health_oauth_state' using errcode = '22023';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_user_id::text, 744218));
  if exists (
    select 1 from public.google_health_account_deletion_guards guard
     where guard.user_id = p_user_id
  ) then
    raise exception 'google_health_account_deleting' using errcode = '55000';
  end if;
  insert into public.google_health_privacy_accounts (user_id, required_since)
  values (p_user_id, now())
  on conflict (user_id) do nothing;
  insert into public.google_health_connections (user_id, status)
  values (p_user_id, 'pending')
  on conflict (user_id) do nothing;
  select * into v_connection
    from public.google_health_connections connection
   where connection.user_id = p_user_id
   for update;
  if v_connection.status = 'connected'
     and v_connection.refresh_token_ciphertext is not null then
    raise exception 'google_health_already_connected' using errcode = '55000';
  end if;

  insert into public.google_health_revocation_queue (
    user_id, refresh_token_ciphertext, refresh_token_iv, encryption_key_version
  )
  select
    staged.user_id,
    staged.refresh_token_ciphertext,
    staged.refresh_token_iv,
    staged.encryption_key_version
    from public.google_health_pending_grants staged
   where staged.user_id = p_user_id;
  delete from public.google_health_pending_grants staged where staged.user_id = p_user_id;
  delete from public.google_health_oauth_states state where state.user_id = p_user_id;

  update public.google_health_connections connection
     set status = 'pending',
         last_error_code = null,
         last_error_at = null,
         sync_lease_id = null,
         sync_lease_until = null,
         connection_generation = connection.connection_generation + 1
   where connection.user_id = p_user_id
   returning connection.connection_generation into v_generation;

  insert into public.google_health_oauth_states (
    state_hash,
    user_id,
    verifier_ciphertext,
    verifier_iv,
    verifier_key_version,
    connection_generation,
    return_to,
    expires_at
  ) values (
    p_state_hash,
    p_user_id,
    p_verifier_ciphertext,
    p_verifier_iv,
    p_verifier_key_version,
    v_generation,
    p_return_to,
    p_expires_at
  );
  return v_generation;
end;
$$;

revoke all on function public.create_google_health_oauth_state(uuid, text, text, text, smallint, text, timestamptz)
  from public, anon, authenticated;
grant execute on function public.create_google_health_oauth_state(uuid, text, text, text, smallint, text, timestamptz)
  to service_role;

-- The callback stages a provider token only while the exact initiating
-- connection generation is still pending. If disconnect/delete/restart won
-- the race, the encrypted credential is queued for autonomous revoke instead
-- of becoming a live completion token.
create or replace function public.stage_google_health_pending_grant(
  p_user_id uuid,
  p_expected_generation bigint,
  p_completion_hash text,
  p_health_user_id text,
  p_granted_scopes text[],
  p_ciphertext text,
  p_iv text,
  p_key_version smallint,
  p_refresh_token_expires_at timestamptz,
  p_expires_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_connection public.google_health_connections%rowtype;
  v_revocation_id uuid;
begin
  if (select auth.role()) is distinct from 'service_role' then
    raise exception 'google_health_service_role_required' using errcode = '42501';
  end if;
  if p_user_id is null
     or coalesce(p_completion_hash, '') !~ '^[a-f0-9]{64}$'
     or coalesce(p_health_user_id, '') !~ '^[A-Za-z0-9-]{1,63}$'
     or cardinality(coalesce(p_granted_scopes, '{}')) = 0
     or nullif(p_ciphertext, '') is null
     or nullif(p_iv, '') is null
     or coalesce(p_key_version, 0) <= 0
     or p_expires_at is null
     or p_expires_at <= now() then
    raise exception 'invalid_google_health_pending_grant' using errcode = '22023';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_user_id::text, 744218));
  insert into public.google_health_privacy_accounts (user_id, required_since)
  values (p_user_id, now())
  on conflict (user_id) do nothing;
  if not public.google_health_runtime_enabled() or exists (
    select 1 from public.google_health_account_deletion_guards guard
     where guard.user_id = p_user_id
  ) then
    insert into public.google_health_revocation_queue (
      user_id, refresh_token_ciphertext, refresh_token_iv, encryption_key_version
    ) values (
      p_user_id, p_ciphertext, p_iv, p_key_version
    ) returning id into v_revocation_id;
    return jsonb_build_object(
      'staged', false,
      'revocationId', v_revocation_id,
      'reason', case
        when not public.google_health_runtime_enabled() then 'feature_disabled'
        else 'invalid_state'
      end
    );
  end if;
  select * into v_connection
    from public.google_health_connections connection
   where connection.user_id = p_user_id
   for update;
  if v_connection.user_id is null
     or v_connection.status <> 'pending'
     or v_connection.connection_generation <> p_expected_generation
     or not exists (select 1 from auth.users account where account.id = p_user_id) then
    insert into public.google_health_revocation_queue (
      user_id, refresh_token_ciphertext, refresh_token_iv, encryption_key_version
    ) values (
      p_user_id, p_ciphertext, p_iv, p_key_version
    ) returning id into v_revocation_id;
    return jsonb_build_object('staged', false, 'revocationId', v_revocation_id);
  end if;
  insert into public.google_health_pending_grants (
    completion_hash,
    user_id,
    health_user_id,
    granted_scopes,
    refresh_token_ciphertext,
    refresh_token_iv,
    encryption_key_version,
    refresh_token_expires_at,
    connection_generation,
    expires_at
  ) values (
    p_completion_hash,
    p_user_id,
    p_health_user_id,
    p_granted_scopes,
    p_ciphertext,
    p_iv,
    p_key_version,
    p_refresh_token_expires_at,
    p_expected_generation,
    p_expires_at
  );
  return jsonb_build_object('staged', true);
end;
$$;

revoke all on function public.stage_google_health_pending_grant(uuid, bigint, text, text, text[], text, text, smallint, timestamptz, timestamptz)
  from public, anon, authenticated;
grant execute on function public.stage_google_health_pending_grant(uuid, bigint, text, text, text[], text, text, smallint, timestamptz, timestamptz)
  to service_role;

-- Atomically proves that the browser completing OAuth is authenticated as the
-- HabHub user who initiated it, binds the grant, and destroys the one-time
-- staged credential. No callback URL alone can complete account linking.
create or replace function public.complete_google_health_connection(
  p_user_id uuid,
  p_completion_hash text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_connection public.google_health_connections%rowtype;
  v_pending public.google_health_pending_grants%rowtype;
begin
  if (select auth.role()) is distinct from 'service_role' then
    raise exception 'google_health_service_role_required' using errcode = '42501';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_user_id::text, 744218));
  if not public.google_health_runtime_enabled() then
    raise exception 'google_health_feature_disabled' using errcode = '55000';
  end if;
  if exists (
    select 1 from public.google_health_account_deletion_guards guard
     where guard.user_id = p_user_id
  ) then
    return false;
  end if;
  select * into v_connection
    from public.google_health_connections connection
   where connection.user_id = p_user_id
   for update;
  select * into v_pending
    from public.google_health_pending_grants pending
   where pending.completion_hash = p_completion_hash
     and pending.user_id = p_user_id
     and pending.consumed_at is null
     and pending.expires_at > now()
   for update;
  if v_connection.user_id is null
     or v_pending.completion_hash is null
     or v_connection.connection_generation <> v_pending.connection_generation
     or not exists (select 1 from auth.users account where account.id = p_user_id) then
    return false;
  end if;
  if v_connection.health_user_id is not null
     and v_connection.health_user_id <> v_pending.health_user_id then
    raise exception 'google_health_account_mismatch' using errcode = '23514';
  end if;
  if v_connection.refresh_token_ciphertext is not null then
    insert into public.google_health_revocation_queue (
      user_id, refresh_token_ciphertext, refresh_token_iv, encryption_key_version
    ) values (
      p_user_id,
      v_connection.refresh_token_ciphertext,
      v_connection.refresh_token_iv,
      v_connection.encryption_key_version
    );
  end if;
  insert into public.google_health_revocation_queue (
    user_id, refresh_token_ciphertext, refresh_token_iv, encryption_key_version
  )
  select
    pending.user_id,
    pending.refresh_token_ciphertext,
    pending.refresh_token_iv,
    pending.encryption_key_version
    from public.google_health_pending_grants pending
   where pending.user_id = p_user_id
     and pending.completion_hash <> p_completion_hash;
  update public.google_health_connections connection
     set health_user_id = v_pending.health_user_id,
         google_subject = null,
         google_email = null,
         granted_scopes = v_pending.granted_scopes,
         refresh_token_ciphertext = v_pending.refresh_token_ciphertext,
         refresh_token_iv = v_pending.refresh_token_iv,
         refresh_token_fingerprint = null,
         refresh_replacement_nonce = null,
         encryption_key_version = v_pending.encryption_key_version,
         refresh_token_expires_at = v_pending.refresh_token_expires_at,
          status = 'connected',
          last_synced_at = null,
          last_error_code = null,
          last_error_at = null,
          sync_lease_id = null,
          sync_lease_until = null,
          connection_generation = connection.connection_generation + 1
   where connection.user_id = p_user_id;
  delete from public.google_health_pending_grants pending where pending.user_id = p_user_id;
  delete from public.google_health_oauth_states state where state.user_id = p_user_id;
  delete from public.google_health_sync_cursors cursor where cursor.user_id = p_user_id;
  insert into public.google_health_privacy_accounts (user_id, required_since)
  values (p_user_id, now())
  on conflict (user_id) do nothing;
  return true;
exception
  when unique_violation then
    raise exception 'google_health_identity_already_bound' using errcode = '23505';
end;
$$;

revoke all on function public.complete_google_health_connection(uuid, text)
  from public, anon, authenticated;
grant execute on function public.complete_google_health_connection(uuid, text)
  to service_role;

-- Delete is a single transaction: invalidate every grant/lease, stage durable
-- revocations, remove all Google-owned snapshot/group state, then erase the
-- connection row. A failed statement rolls the entire operation back.
create or replace function public.delete_google_health_connection_data(p_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_revocations jsonb := '[]'::jsonb;
  v_deleted integer := 0;
begin
  if (select auth.role()) is distinct from 'service_role' then
    raise exception 'google_health_service_role_required' using errcode = '42501';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_user_id::text, 744218));
  select coalesce(jsonb_agg(to_jsonb(credential)), '[]'::jsonb)
    into v_revocations
    from public.detach_google_health_connection(p_user_id) credential;
  select coalesce(result.deleted_count, 0)
    into v_deleted
    from public.delete_google_health_imports(p_user_id) result;
  delete from public.google_health_connections connection
   where connection.user_id = p_user_id;
  perform public.release_google_health_privacy_markers_if_clean(p_user_id);
  return jsonb_build_object(
    'deletedCount', coalesce(v_deleted, 0),
    'revocations', coalesce(v_revocations, '[]'::jsonb)
  );
end;
$$;

revoke all on function public.delete_google_health_connection_data(uuid)
  from public, anon, authenticated;
grant execute on function public.delete_google_health_connection_data(uuid)
  to service_role;

-- Account deletion differs from the Settings "Delete imported data" action:
-- this durable guard remains until auth.users cascade succeeds. A second tab
-- therefore cannot start, stage, complete, or sync a new grant in the gap.
create or replace function public.begin_google_health_account_deletion(
  p_user_id uuid,
  p_attempt_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_result jsonb;
  v_guard public.google_health_account_deletion_guards%rowtype;
  v_resumed boolean := false;
  v_lease_until timestamptz;
begin
  if (select auth.role()) is distinct from 'service_role' then
    raise exception 'google_health_service_role_required' using errcode = '42501';
  end if;
  if p_user_id is null
     or p_attempt_id is null
     or not exists (select 1 from auth.users account where account.id = p_user_id) then
    raise exception 'google_health_account_not_found' using errcode = 'P0002';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_user_id::text, 744218));
  select * into v_guard
    from public.google_health_account_deletion_guards guard
   where guard.user_id = p_user_id
   for update;
  v_lease_until := now() + interval '10 minutes';
  if v_guard.user_id is null then
    insert into public.google_health_account_deletion_guards (
      user_id, attempt_id, started_at, lease_until
    ) values (
      p_user_id, p_attempt_id, now(), v_lease_until
    );
  elsif v_guard.attempt_id = p_attempt_id then
    update public.google_health_account_deletion_guards guard
       set lease_until = v_lease_until
     where guard.user_id = p_user_id
       and guard.attempt_id = p_attempt_id;
    v_resumed := true;
  elsif v_guard.lease_until <= now() then
    -- The guard row never disappears: takeover changes only the opaque lease
    -- owner after the crashed invocation's bounded lease has elapsed.
    update public.google_health_account_deletion_guards guard
       set attempt_id = p_attempt_id,
           started_at = now(),
           lease_until = v_lease_until
     where guard.user_id = p_user_id
       and guard.attempt_id = v_guard.attempt_id
       and guard.lease_until <= now();
    if not found then
      raise exception 'google_health_account_deletion_in_progress' using errcode = '55000';
    end if;
    v_resumed := true;
  else
    raise exception 'google_health_account_deletion_in_progress' using errcode = '55000';
  end if;
  v_result := public.delete_google_health_connection_data(p_user_id);
  update public.google_health_account_deletion_guards guard
     set lease_until = now() + interval '10 minutes'
   where guard.user_id = p_user_id
     and guard.attempt_id = p_attempt_id
  returning guard.lease_until into v_lease_until;
  if v_lease_until is null then
    raise exception 'google_health_account_deletion_attempt_lost' using errcode = '55000';
  end if;
  return coalesce(v_result, '{}'::jsonb) || jsonb_build_object(
    'attemptId', p_attempt_id,
    'leaseUntil', v_lease_until,
    'resumed', v_resumed
  );
end;
$$;

revoke all on function public.begin_google_health_account_deletion(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.begin_google_health_account_deletion(uuid, uuid)
  to service_role;

create or replace function public.verify_google_health_account_deletion(
  p_user_id uuid,
  p_attempt_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_renewed integer := 0;
begin
  if (select auth.role()) is distinct from 'service_role' then
    raise exception 'google_health_service_role_required' using errcode = '42501';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_user_id::text, 744218));
  update public.google_health_account_deletion_guards guard
     set lease_until = now() + interval '10 minutes'
   where guard.user_id = p_user_id
     and guard.attempt_id = p_attempt_id;
  get diagnostics v_renewed = row_count;
  return v_renewed = 1;
end;
$$;

revoke all on function public.verify_google_health_account_deletion(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.verify_google_health_account_deletion(uuid, uuid)
  to service_role;

-- Storage cleanup heartbeats before every page and delete batch.  An expired
-- attempt may renew only while it still owns the row; once a retry takes over,
-- the stale process can neither renew nor cancel the new owner's guard.
create or replace function public.renew_google_health_account_deletion(
  p_user_id uuid,
  p_attempt_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_renewed integer := 0;
begin
  if (select auth.role()) is distinct from 'service_role' then
    raise exception 'google_health_service_role_required' using errcode = '42501';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_user_id::text, 744218));
  update public.google_health_account_deletion_guards guard
     set lease_until = now() + interval '10 minutes'
   where guard.user_id = p_user_id
     and guard.attempt_id = p_attempt_id;
  get diagnostics v_renewed = row_count;
  return v_renewed = 1;
end;
$$;

revoke all on function public.renew_google_health_account_deletion(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.renew_google_health_account_deletion(uuid, uuid)
  to service_role;

create or replace function public.cancel_google_health_account_deletion(
  p_user_id uuid,
  p_attempt_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_deleted integer := 0;
begin
  if (select auth.role()) is distinct from 'service_role' then
    raise exception 'google_health_service_role_required' using errcode = '42501';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_user_id::text, 744218));
  delete from public.google_health_account_deletion_guards guard
   where guard.user_id = p_user_id
     and guard.attempt_id = p_attempt_id;
  get diagnostics v_deleted = row_count;
  return v_deleted > 0;
end;
$$;

revoke all on function public.cancel_google_health_account_deletion(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.cancel_google_health_account_deletion(uuid, uuid)
  to service_role;

-- OAuth state carries an encrypted PKCE verifier plus user/return metadata.
-- Keep only a short one-hour audit/retry window after consumption or expiry;
-- the autonomous worker invokes this cleanup every minute.
create or replace function public.purge_expired_google_health_oauth_states()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_deleted integer := 0;
begin
  if (select auth.role()) is distinct from 'service_role' then
    raise exception 'google_health_service_role_required' using errcode = '42501';
  end if;
  delete from public.google_health_oauth_states state
   where (state.consumed_at is not null and state.consumed_at < now() - interval '1 hour')
      or (state.expires_at < now() - interval '1 hour');
  get diagnostics v_deleted = row_count;
  perform public.release_google_health_privacy_markers_if_clean(null);
  return v_deleted;
end;
$$;

revoke all on function public.purge_expired_google_health_oauth_states()
  from public, anon, authenticated;
grant execute on function public.purge_expired_google_health_oauth_states()
  to service_role;

-- Claims retryable webhook work in one statement so concurrent workers never
-- process the same notification.
create or replace function public.claim_google_health_webhook_events(p_limit integer default 10)
returns setof public.google_health_webhook_queue
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select auth.role()) is distinct from 'service_role' then
    raise exception 'google_health_service_role_required' using errcode = '42501';
  end if;
  if not public.google_health_runtime_enabled() then
    return;
  end if;
  -- A crashed invocation cannot strand a row forever. The lease is far longer
  -- than a normal bounded sync but short enough for operational recovery.
  update public.google_health_webhook_queue queue
     set status = 'pending',
         claimed_at = null,
         available_at = now(),
         last_error = coalesce(queue.last_error, 'worker_lease_expired')
   where queue.status = 'processing'
     and queue.claimed_at < now() - interval '30 minutes';
  return query
  with selected as (
    select queue.id
      from public.google_health_webhook_queue queue
     where queue.status = 'pending'
       and queue.available_at <= now()
     order by queue.available_at, queue.created_at
     for update skip locked
     limit least(greatest(coalesce(p_limit, 10), 1), 50)
  )
  update public.google_health_webhook_queue queue
     set status = 'processing',
         claimed_at = now(),
         attempt_count = queue.attempt_count + 1
    from selected
   where queue.id = selected.id
  returning queue.*;
end;
$$;

revoke all on function public.claim_google_health_webhook_events(integer)
  from public, anon, authenticated;
grant execute on function public.claim_google_health_webhook_events(integer)
  to service_role;

create or replace function public.claim_google_health_revocations(p_limit integer default 10)
returns setof public.google_health_revocation_queue
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select auth.role()) is distinct from 'service_role' then
    raise exception 'google_health_service_role_required' using errcode = '42501';
  end if;
  update public.google_health_revocation_queue queued
     set status = 'pending', claimed_at = null, available_at = now(),
         last_error = coalesce(queued.last_error, 'worker_lease_expired')
   where queued.status = 'processing'
     and queued.claimed_at < now() - interval '10 minutes';
  return query
  with selected as (
    select queued.id
      from public.google_health_revocation_queue queued
     where queued.status = 'pending' and queued.available_at <= now()
     order by queued.available_at, queued.created_at
     for update skip locked
     limit least(greatest(coalesce(p_limit, 10), 1), 25)
  )
  update public.google_health_revocation_queue queued
     set status = 'processing', claimed_at = now(),
         attempt_count = queued.attempt_count + 1
    from selected
   where queued.id = selected.id
  returning queued.*;
end;
$$;

revoke all on function public.claim_google_health_revocations(integer)
  from public, anon, authenticated;
grant execute on function public.claim_google_health_revocations(integer)
  to service_role;

create or replace function public.stage_expired_google_health_grants(p_limit integer default 25)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare v_count integer;
begin
  if (select auth.role()) is distinct from 'service_role' then
    raise exception 'google_health_service_role_required' using errcode = '42501';
  end if;
  with selected as materialized (
    select staged.completion_hash
      from public.google_health_pending_grants staged
     where staged.expires_at <= now()
     order by staged.expires_at
     for update skip locked
     limit least(greatest(coalesce(p_limit, 25), 1), 100)
  ), queued as (
    insert into public.google_health_revocation_queue (
      user_id, refresh_token_ciphertext, refresh_token_iv, encryption_key_version
    )
    select
      staged.user_id,
      staged.refresh_token_ciphertext,
      staged.refresh_token_iv,
      staged.encryption_key_version
      from public.google_health_pending_grants staged
      join selected on selected.completion_hash = staged.completion_hash
    returning id
  ), deleted as (
    delete from public.google_health_pending_grants staged
     using selected
     where staged.completion_hash = selected.completion_hash
    returning staged.completion_hash
  )
  select count(*)::integer into v_count from deleted;
  return coalesce(v_count, 0);
end;
$$;

revoke all on function public.stage_expired_google_health_grants(integer)
  from public, anon, authenticated;
grant execute on function public.stage_expired_google_health_grants(integer)
  to service_role;

-- Autonomous draining: the worker URL and raw worker secret are read from
-- Vault at runtime and are never embedded in this migration. Missing Vault
-- values make the tick a safe no-op until deployment provisioning is complete.
create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;

create or replace function public.invoke_google_health_worker()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_url text;
  v_secret text;
begin
  select secret.decrypted_secret into v_url
    from vault.decrypted_secrets secret
   where secret.name = 'google_health_worker_url'
   order by secret.created_at desc limit 1;
  select secret.decrypted_secret into v_secret
    from vault.decrypted_secrets secret
   where secret.name = 'google_health_worker_secret'
   order by secret.created_at desc limit 1;
  if nullif(v_url, '') is null or nullif(v_secret, '') is null then return; end if;
  perform net.http_post(
    url := v_url,
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || v_secret,
      'Content-Type', 'application/json'
    ),
    body := '{"limit":25}'::jsonb,
    timeout_milliseconds := 10000
  );
end;
$$;

revoke all on function public.invoke_google_health_worker()
  from public, anon, authenticated;
grant execute on function public.invoke_google_health_worker() to service_role;

select cron.unschedule(jobid)
  from cron.job
 where jobname = 'google-health-worker-every-minute';
select cron.schedule(
  'google-health-worker-every-minute',
  '* * * * *',
  'select public.invoke_google_health_worker()'
);

-- Build 1 suppresses Google-derived metric push entirely.  The outbox has no
-- privacy-capability-aware recipient delivery yet, so even an opaque event
-- could reach a released schema-26 device. Manual/native shared-entry push is
-- unchanged; capability-aware generic Google push can be added later.
create or replace function public.emit_group_metric_push_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_group_id uuid;
  v_metric_slug text;
  v_metric_name text;
  v_member_name text;
  v_event_key text;
  v_data jsonb;
begin
  select definition.group_id, definition.slug, definition.name
    into v_group_id, v_metric_slug, v_metric_name
    from public.metric_definitions definition
   where definition.id = new.metric_id
     and definition.group_id is not null;
  if new.source_provider = 'google_health' then
    return new;
  end if;
  if v_group_id is null
     or new.visibility = 'private'
     or new.recorded_at < now() - interval '15 minutes'
     or not exists (
       select 1 from public.group_members membership
        where membership.group_id = v_group_id
          and membership.user_id = new.user_id
          and membership.status = 'active'
     ) then
    return new;
  end if;
  select profile.display_name into v_member_name
    from public.profiles profile where profile.id = new.user_id;

  v_event_key := case
    when char_length(
      'entry:' || v_group_id::text || ':' || new.user_id::text || ':' ||
        new.client_generated_id
    ) <= 240 then
      'entry:' || v_group_id::text || ':' || new.user_id::text || ':' ||
        new.client_generated_id
    else
      'entry:' || v_group_id::text || ':' || new.user_id::text || ':' ||
        pg_catalog.md5(new.client_generated_id)
  end;
  v_data := jsonb_build_object(
    'route', '/day/' || new.local_date::text,
    'groupId', v_group_id,
    'metricId', v_metric_slug,
    'entryId', new.client_generated_id
  );

  insert into public.push_dispatch_events (
    event_key,
    group_id,
    dispatcher_id,
    category,
    event_type,
    audience,
    metric_slug,
    title,
    body,
    data,
    expires_at
  ) values (
    v_event_key,
    v_group_id,
    new.user_id,
    'metric',
    'metric_entry',
    'group',
    v_metric_slug,
    left(coalesce(v_member_name, 'A member') || ' logged ' || v_metric_name, 120),
    'A shared ' || v_metric_name || ' update was added.',
    v_data,
    now() + interval '30 minutes'
  ) on conflict (event_key) do nothing;
  return new;
end;
$$;

revoke all on function public.emit_group_metric_push_event()
  from public, anon, authenticated;

-- Defensive cleanup for a partially exercised pre-release migration.  This
-- migration ships with the runtime switch off, so production normally has no
-- such rows, but an interrupted staging rehearsal must not retain them.
delete from public.push_dispatch_events event
 where event.event_key like '%google-health:%'
    or coalesce(event.data ->> 'entryId', '') like 'google-health:%';

create or replace function public.enqueue_group_lead_push_event(
  p_group_id uuid,
  p_metric_slug text,
  p_source_entry_ids text[]
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_metric_id uuid;
  v_metric_name text;
  v_member_name text;
  v_ids text[];
  v_entry_id uuid;
  v_source_provider text;
  v_latest timestamptz;
  v_event_key text;
begin
  if v_user_id is null or not public.is_group_member(p_group_id) then
    raise exception 'Active group membership required.' using errcode = '42501';
  end if;
  select array_agg(distinct source_id order by source_id)
    into v_ids
    from unnest(coalesce(p_source_entry_ids, array[]::text[]))
      source(source_id)
   where nullif(source_id, '') is not null;
  if cardinality(coalesce(v_ids, array[]::text[])) <> 1 then
    raise exception 'Exactly one committed source entry is required.'
      using errcode = '22023';
  end if;
  select definition.id, definition.name
    into v_metric_id, v_metric_name
    from public.metric_definitions definition
   where definition.group_id = p_group_id
     and definition.slug = p_metric_slug
     and definition.archived_at is null;
  if v_metric_id is null then
    raise exception 'Group tracker not found.' using errcode = 'P0002';
  end if;
  select entry.id, entry.source_provider, entry.updated_at
    into v_entry_id, v_source_provider, v_latest
    from public.metric_entries entry
   where entry.metric_id = v_metric_id
     and entry.user_id = v_user_id
     and entry.visibility = 'group'
     and entry.client_generated_id = any(v_ids)
     and entry.updated_at >= now() - interval '30 minutes';
  if v_source_provider = 'google_health' then
    return null;
  end if;
  if v_entry_id is null then
    raise exception 'Every source entry must be a fresh committed shared row.'
      using errcode = '42501';
  end if;
  select profile.display_name into v_member_name
    from public.profiles profile where profile.id = v_user_id;
  v_event_key := 'lead:' || p_group_id::text || ':' || v_user_id::text || ':' ||
    v_entry_id::text || ':' ||
    floor(extract(epoch from v_latest) * 1000)::bigint::text;

  insert into public.push_dispatch_events (
    event_key, group_id, dispatcher_id, category, event_type, audience,
    metric_slug, title, body, data, expires_at
  ) values (
    v_event_key,
    p_group_id,
    v_user_id,
    'lead',
    'leaderboard_activity',
    'group_including_sender',
    p_metric_slug,
    'Leaderboard updated',
    left(
      coalesce(v_member_name, 'A member') || ' shared new ' ||
        v_metric_name || ' activity. Open the Leaderboard for the latest standings.',
      500
    ),
    jsonb_build_object(
      'route', '/group',
      'groupId', p_group_id,
      'metricId', p_metric_slug
    ),
    now() + interval '30 minutes'
  ) on conflict (event_key) do nothing;
  return v_event_key;
end;
$$;

revoke all on function public.enqueue_group_lead_push_event(uuid, text, text[])
  from public, anon;
grant execute on function public.enqueue_group_lead_push_event(uuid, text, text[])
  to authenticated;

comment on table public.google_health_connections is
  'Server-only Google Health OAuth binding. Refresh tokens are AES-GCM ciphertext; clients have no RLS policy.';
comment on table public.google_health_webhook_queue is
  'Verified Google Health notifications awaiting asynchronous reconciliation.';
