-- User-owned identity preferences, notification routing, and historical goal membership.

create table if not exists public.member_aliases (
  owner_user_id uuid not null references public.profiles(id) on delete cascade,
  subject_user_id uuid not null references public.profiles(id) on delete cascade,
  nickname text not null check (char_length(nickname) <= 80),
  updated_at timestamptz not null default now(),
  primary key (owner_user_id, subject_user_id)
);

create table if not exists public.notification_preferences (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  push_enabled boolean not null default true,
  group_metric_activity boolean not null default false,
  metric_ids uuid[] not null default '{}'::uuid[],
  chat_messages boolean not null default true,
  badges_and_winners boolean not null default true,
  reminders boolean not null default true,
  quiet_hours_enabled boolean not null default false,
  quiet_hours_start time not null default '22:00',
  quiet_hours_end time not null default '07:00',
  updated_at timestamptz not null default now()
);

create table if not exists public.tracked_goal_periods (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  metric_id uuid not null references public.metric_definitions(id) on delete cascade,
  valid_from date not null,
  valid_until date,
  created_at timestamptz not null default now(),
  check (valid_until is null or valid_until >= valid_from),
  unique (user_id, metric_id, valid_from)
);

alter table public.member_aliases enable row level security;
alter table public.notification_preferences enable row level security;
alter table public.tracked_goal_periods enable row level security;

create policy member_aliases_owner_all on public.member_aliases for all to authenticated
  using (owner_user_id = auth.uid()) with check (owner_user_id = auth.uid());

create policy notification_preferences_owner_all on public.notification_preferences for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy tracked_goal_periods_owner_all on public.tracked_goal_periods for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

create index if not exists tracked_goal_periods_lookup_idx
  on public.tracked_goal_periods (user_id, metric_id, valid_from, valid_until);
