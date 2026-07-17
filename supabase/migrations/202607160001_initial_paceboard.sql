create extension if not exists pgcrypto;

create type public.member_role as enum ('owner', 'admin', 'member');
create type public.entry_visibility as enum ('private', 'status', 'group');
create type public.metric_data_type as enum ('number', 'boolean', 'calculated');

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null default 'New member',
  avatar_path text,
  timezone text not null default 'UTC',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.groups (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete restrict,
  name text not null check (char_length(name) between 1 and 80),
  invite_code text not null unique,
  template_name text not null default 'Healthy Competition',
  settings jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.group_members (
  group_id uuid not null references public.groups(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  role public.member_role not null default 'member',
  joined_at timestamptz not null default now(),
  primary key (group_id, user_id)
);

create table public.metric_definitions (
  id uuid primary key default gen_random_uuid(),
  group_id uuid references public.groups(id) on delete cascade,
  owner_user_id uuid references public.profiles(id) on delete cascade,
  slug text not null,
  name text not null check (char_length(name) between 1 and 60),
  icon text not null default 'analytics-outline',
  color text not null default '#176B4D',
  unit text not null default '',
  data_type public.metric_data_type not null default 'number',
  aggregation_method text not null default 'sum' check (aggregation_method in ('sum', 'latest', 'average', 'max', 'min')),
  ranking_direction text not null default 'higher' check (ranking_direction in ('higher', 'lower', 'closest')),
  formula text,
  formula_version integer not null default 1,
  score_weight numeric not null default 0 check (score_weight between 0 and 100),
  default_visibility public.entry_visibility not null default 'group',
  configuration jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (group_id is not null or owner_user_id is not null),
  unique nulls not distinct (group_id, owner_user_id, slug)
);

create table public.metric_goals (
  id uuid primary key default gen_random_uuid(),
  metric_id uuid not null references public.metric_definitions(id) on delete cascade,
  user_id uuid references public.profiles(id) on delete cascade,
  target_value numeric not null,
  goal_kind text not null default 'at_least' check (goal_kind in ('at_least', 'at_most', 'exact', 'complete')),
  valid_from date not null default current_date,
  valid_until date,
  private boolean not null default false,
  created_at timestamptz not null default now(),
  check (valid_until is null or valid_until >= valid_from)
);

create table public.metric_entries (
  id uuid primary key default gen_random_uuid(),
  client_generated_id text not null,
  metric_id uuid not null references public.metric_definitions(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  value jsonb not null,
  local_date date not null,
  recorded_at timestamptz not null,
  visibility public.entry_visibility not null default 'group',
  source text not null default 'manual',
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, client_generated_id)
);
create index metric_entries_daily_idx on public.metric_entries (metric_id, local_date, user_id);

create table public.dashboard_layouts (
  user_id uuid not null references public.profiles(id) on delete cascade,
  group_id uuid not null references public.groups(id) on delete cascade,
  section text not null check (section in ('today', 'group', 'insights')),
  configuration jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  primary key (user_id, group_id, section)
);

create table public.messages (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups(id) on delete cascade,
  sender_id uuid references public.profiles(id) on delete set null,
  kind text not null default 'message',
  content text not null check (char_length(content) between 1 and 4000),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index messages_group_created_idx on public.messages (group_id, created_at desc);

create table public.media_assets (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null references public.profiles(id) on delete cascade,
  storage_path text not null unique,
  thumbnail_path text,
  media_type text not null default 'image',
  captured_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.photo_updates (
  id uuid primary key default gen_random_uuid(),
  media_asset_id uuid not null references public.media_assets(id) on delete cascade,
  owner_user_id uuid not null references public.profiles(id) on delete cascade,
  group_id uuid references public.groups(id) on delete cascade,
  caption text not null default '',
  local_date date not null,
  visibility public.entry_visibility not null default 'private',
  revealed_at timestamptz,
  comments_enabled boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.automation_rules (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups(id) on delete cascade,
  name text not null,
  trigger_type text not null,
  conditions jsonb not null default '{}'::jsonb,
  message_template text not null,
  cooldown_minutes integer not null default 180 check (cooldown_minutes >= 0),
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.templates (
  id uuid primary key default gen_random_uuid(),
  creator_user_id uuid references public.profiles(id) on delete set null,
  creator_group_id uuid references public.groups(id) on delete set null,
  name text not null,
  description text not null default '',
  category text not null default 'fitness',
  visibility text not null default 'private' check (visibility in ('private', 'unlisted', 'public')),
  current_version integer not null default 1,
  usage_count integer not null default 0,
  created_at timestamptz not null default now(),
  published_at timestamptz
);

create table public.template_versions (
  template_id uuid not null references public.templates(id) on delete cascade,
  version integer not null,
  configuration jsonb not null,
  change_notes text not null default '',
  created_at timestamptz not null default now(),
  primary key (template_id, version)
);

-- A deliberately narrow, owner-only JSON backup used by the credential-free demo
-- when the user opts into cloud backup. Relational group sync uses the tables above.
create table public.user_snapshots (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  payload jsonb not null,
  updated_at timestamptz not null default now()
);

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger groups_touch_updated_at before update on public.groups for each row execute function public.touch_updated_at();
create trigger metrics_touch_updated_at before update on public.metric_definitions for each row execute function public.touch_updated_at();
create trigger entries_touch_updated_at before update on public.metric_entries for each row execute function public.touch_updated_at();
create trigger automation_touch_updated_at before update on public.automation_rules for each row execute function public.touch_updated_at();

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = ''
as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'display_name', split_part(new.email, '@', 1), 'New member'));
  return new;
end;
$$;
create trigger on_auth_user_created after insert on auth.users for each row execute function public.handle_new_user();

create or replace function public.handle_new_group()
returns trigger
language plpgsql
security definer set search_path = ''
as $$
begin
  insert into public.group_members (group_id, user_id, role) values (new.id, new.owner_id, 'owner');
  return new;
end;
$$;
create trigger on_group_created after insert on public.groups for each row execute function public.handle_new_group();

create or replace function public.is_group_member(target_group_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.group_members
    where group_id = target_group_id and user_id = auth.uid()
  );
$$;

create or replace function public.is_group_admin(target_group_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.group_members
    where group_id = target_group_id and user_id = auth.uid() and role in ('owner', 'admin')
  );
$$;

create or replace function public.shares_group_with(target_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.group_members mine
    join public.group_members theirs on theirs.group_id = mine.group_id
    where mine.user_id = auth.uid() and theirs.user_id = target_user_id
  );
$$;

create or replace function public.join_group_with_code(code text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare target_id uuid;
begin
  select id into target_id from public.groups where upper(invite_code) = upper(code);
  if target_id is null then raise exception 'Invalid invite code'; end if;
  insert into public.group_members (group_id, user_id, role)
  values (target_id, auth.uid(), 'member') on conflict do nothing;
  return target_id;
end;
$$;

alter table public.profiles enable row level security;
alter table public.groups enable row level security;
alter table public.group_members enable row level security;
alter table public.metric_definitions enable row level security;
alter table public.metric_goals enable row level security;
alter table public.metric_entries enable row level security;
alter table public.dashboard_layouts enable row level security;
alter table public.messages enable row level security;
alter table public.media_assets enable row level security;
alter table public.photo_updates enable row level security;
alter table public.automation_rules enable row level security;
alter table public.templates enable row level security;
alter table public.template_versions enable row level security;
alter table public.user_snapshots enable row level security;

create policy profiles_self_read on public.profiles for select to authenticated using (id = auth.uid());
create policy profiles_group_read on public.profiles for select to authenticated using (public.shares_group_with(id));
create policy profiles_self_update on public.profiles for update to authenticated using (id = auth.uid()) with check (id = auth.uid());

create policy groups_member_read on public.groups for select to authenticated using (public.is_group_member(id));
create policy groups_create on public.groups for insert to authenticated with check (owner_id = auth.uid());
create policy groups_admin_update on public.groups for update to authenticated using (public.is_group_admin(id));
create policy groups_owner_delete on public.groups for delete to authenticated using (owner_id = auth.uid());

create policy members_group_read on public.group_members for select to authenticated using (public.is_group_member(group_id));
create policy members_admin_insert on public.group_members for insert to authenticated with check (public.is_group_admin(group_id));
create policy members_admin_update on public.group_members for update to authenticated using (public.is_group_admin(group_id));
create policy members_self_or_admin_delete on public.group_members for delete to authenticated using (user_id = auth.uid() or public.is_group_admin(group_id));

create policy metrics_read on public.metric_definitions for select to authenticated
using (owner_user_id = auth.uid() or (group_id is not null and public.is_group_member(group_id)));
create policy metrics_create on public.metric_definitions for insert to authenticated
with check (owner_user_id = auth.uid() or (group_id is not null and public.is_group_admin(group_id)));
create policy metrics_update on public.metric_definitions for update to authenticated
using (owner_user_id = auth.uid() or (group_id is not null and public.is_group_admin(group_id)));
create policy metrics_delete on public.metric_definitions for delete to authenticated
using (owner_user_id = auth.uid() or (group_id is not null and public.is_group_admin(group_id)));

create policy goals_owner_all on public.metric_goals for all to authenticated
using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy goals_group_read on public.metric_goals for select to authenticated
using (user_id is null and exists (select 1 from public.metric_definitions m where m.id = metric_id and public.is_group_member(m.group_id)));

create policy entries_owner_all on public.metric_entries for all to authenticated
using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy entries_shared_read on public.metric_entries for select to authenticated
using (
  visibility <> 'private' and exists (
    select 1 from public.metric_definitions m
    where m.id = metric_id and m.group_id is not null and public.is_group_member(m.group_id)
  )
);

create policy layouts_owner_all on public.dashboard_layouts for all to authenticated
using (user_id = auth.uid()) with check (user_id = auth.uid() and public.is_group_member(group_id));

create policy messages_member_read on public.messages for select to authenticated using (public.is_group_member(group_id));
create policy messages_member_insert on public.messages for insert to authenticated with check (public.is_group_member(group_id) and sender_id = auth.uid());
create policy messages_owner_delete on public.messages for delete to authenticated using (sender_id = auth.uid() or public.is_group_admin(group_id));

create policy media_owner_all on public.media_assets for all to authenticated
using (owner_user_id = auth.uid()) with check (owner_user_id = auth.uid());
create policy photos_owner_all on public.photo_updates for all to authenticated
using (owner_user_id = auth.uid()) with check (owner_user_id = auth.uid());
create policy photos_group_read on public.photo_updates for select to authenticated
using (visibility = 'group' and group_id is not null and public.is_group_member(group_id));

create policy automation_member_read on public.automation_rules for select to authenticated using (public.is_group_member(group_id));
create policy automation_admin_all on public.automation_rules for all to authenticated
using (public.is_group_admin(group_id)) with check (public.is_group_admin(group_id));

create policy templates_public_read on public.templates for select using (visibility = 'public');
create policy templates_owner_all on public.templates for all to authenticated
using (creator_user_id = auth.uid()) with check (creator_user_id = auth.uid());
create policy template_versions_public_read on public.template_versions for select
using (exists (select 1 from public.templates t where t.id = template_id and t.visibility = 'public'));
create policy template_versions_owner_all on public.template_versions for all to authenticated
using (exists (select 1 from public.templates t where t.id = template_id and t.creator_user_id = auth.uid()))
with check (exists (select 1 from public.templates t where t.id = template_id and t.creator_user_id = auth.uid()));

create policy snapshots_owner_all on public.user_snapshots for all to authenticated
using (user_id = auth.uid()) with check (user_id = auth.uid());

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('paceboard-media', 'paceboard-media', false, 26214400, array['image/jpeg', 'image/png', 'image/webp', 'image/heic'])
on conflict (id) do nothing;

create policy media_storage_owner_read on storage.objects for select to authenticated
using (bucket_id = 'paceboard-media' and (storage.foldername(name))[1] = auth.uid()::text);
create policy media_storage_owner_insert on storage.objects for insert to authenticated
with check (bucket_id = 'paceboard-media' and (storage.foldername(name))[1] = auth.uid()::text);
create policy media_storage_owner_update on storage.objects for update to authenticated
using (bucket_id = 'paceboard-media' and (storage.foldername(name))[1] = auth.uid()::text);
create policy media_storage_owner_delete on storage.objects for delete to authenticated
using (bucket_id = 'paceboard-media' and (storage.foldername(name))[1] = auth.uid()::text);
