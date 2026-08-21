-- Native health imports keep stable provider provenance so retries and multi-device
-- synchronization update existing records instead of double-counting them.
alter table public.metric_entries
  add column if not exists source_provider text,
  add column if not exists source_record_id text,
  add column if not exists source_origin text,
  add column if not exists source_updated_at timestamptz;

alter table public.metric_entries
  drop constraint if exists metric_entries_source_provider_check;
alter table public.metric_entries
  add constraint metric_entries_source_provider_check
  check (source_provider is null or source_provider in ('apple_health', 'health_connect'));

create unique index if not exists metric_entries_native_source_unique
  on public.metric_entries (user_id, source_provider, source_record_id, metric_id)
  where source_provider is not null and source_record_id is not null;

create table if not exists public.health_connections (
  user_id uuid not null references public.profiles(id) on delete cascade,
  provider text not null check (provider in ('apple_health', 'health_connect')),
  enabled boolean not null default false,
  data_types jsonb not null default '{}'::jsonb,
  sync_mode text not null default 'balanced' check (sync_mode in ('manual', 'battery', 'balanced', 'frequent')),
  background_access boolean not null default false,
  last_synced_at timestamptz,
  last_error text,
  updated_at timestamptz not null default now(),
  primary key (user_id, provider)
);

create table if not exists public.health_sync_cursors (
  user_id uuid not null references public.profiles(id) on delete cascade,
  provider text not null check (provider in ('apple_health', 'health_connect')),
  data_type text not null check (data_type in ('steps', 'active_energy', 'weight', 'nutrition', 'water', 'workouts')),
  cursor text,
  last_success_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key (user_id, provider, data_type)
);

alter table public.health_connections enable row level security;
alter table public.health_sync_cursors enable row level security;

drop policy if exists health_connections_owner_all on public.health_connections;
create policy health_connections_owner_all on public.health_connections
  for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

drop policy if exists health_sync_cursors_owner_all on public.health_sync_cursors;
create policy health_sync_cursors_owner_all on public.health_sync_cursors
  for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

drop trigger if exists health_connections_touch_updated_at on public.health_connections;
create trigger health_connections_touch_updated_at
before update on public.health_connections
for each row execute function public.touch_updated_at();

drop trigger if exists health_sync_cursors_touch_updated_at on public.health_sync_cursors;
create trigger health_sync_cursors_touch_updated_at
before update on public.health_sync_cursors
for each row execute function public.touch_updated_at();

