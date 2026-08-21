alter type public.metric_data_type add value if not exists 'text';
alter type public.metric_data_type add value if not exists 'photo';

alter table public.metric_entries
  add column if not exists label text,
  add column if not exists nutrition jsonb,
  add column if not exists image_path text;

alter table public.messages
  add column if not exists conversation_id text not null default 'group',
  add column if not exists recipient_id uuid references public.profiles(id) on delete cascade,
  add column if not exists image_path text;

alter table public.messages alter column content set default '';
alter table public.messages drop constraint if exists messages_content_check;
alter table public.messages add constraint messages_content_or_image_check
  check ((char_length(content) between 1 and 4000) or image_path is not null);
create index if not exists messages_recipient_created_idx on public.messages (recipient_id, created_at desc);

create table if not exists public.energy_profiles (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  age integer not null check (age between 13 and 120),
  biological_sex text not null check (biological_sex in ('female', 'male', 'unspecified')),
  height_cm numeric not null check (height_cm between 80 and 260),
  weight_kg numeric not null check (weight_kg between 20 and 500),
  target_weight_kg numeric not null check (target_weight_kg between 20 and 500),
  activity_level text not null check (activity_level in ('sedentary', 'light', 'moderate', 'very_active', 'athlete')),
  desired_weekly_loss_kg numeric not null default 0.5 check (desired_weekly_loss_kg between 0 and 2),
  updated_at timestamptz not null default now()
);

create trigger energy_profiles_touch_updated_at
before update on public.energy_profiles
for each row execute function public.touch_updated_at();

alter table public.energy_profiles enable row level security;
create policy energy_profiles_owner_all on public.energy_profiles for all to authenticated
using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists messages_member_read on public.messages;
drop policy if exists messages_member_insert on public.messages;
drop policy if exists messages_owner_delete on public.messages;

create policy messages_authorized_read on public.messages for select to authenticated
using (
  public.is_group_member(group_id)
  and (recipient_id is null or sender_id = auth.uid() or recipient_id = auth.uid())
);

create policy messages_authorized_insert on public.messages for insert to authenticated
with check (
  sender_id = auth.uid()
  and public.is_group_member(group_id)
  and (
    recipient_id is null
    or exists (
      select 1 from public.group_members recipient
      where recipient.group_id = messages.group_id and recipient.user_id = messages.recipient_id
    )
  )
);

create policy messages_sender_delete on public.messages for delete to authenticated
using (sender_id = auth.uid());

-- Goal-status sharing never grants access to the underlying metric entry value.
drop policy if exists entries_shared_read on public.metric_entries;
create policy entries_exact_group_read on public.metric_entries for select to authenticated
using (
  visibility = 'group' and exists (
    select 1 from public.metric_definitions metric
    where metric.id = metric_id and metric.group_id is not null and public.is_group_member(metric.group_id)
  )
);

create table if not exists public.daily_metric_status (
  group_id uuid not null references public.groups(id) on delete cascade,
  metric_id uuid not null references public.metric_definitions(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  local_date date not null,
  goal_reached boolean not null,
  score_contribution numeric not null default 0 check (score_contribution between 0 and 100),
  updated_at timestamptz not null default now(),
  primary key (group_id, metric_id, user_id, local_date)
);

create trigger daily_metric_status_touch_updated_at
before update on public.daily_metric_status
for each row execute function public.touch_updated_at();

alter table public.daily_metric_status enable row level security;
create policy daily_status_member_read on public.daily_metric_status for select to authenticated
using (public.is_group_member(group_id));
create policy daily_status_owner_write on public.daily_metric_status for insert to authenticated
with check (user_id = auth.uid() and public.is_group_member(group_id));
create policy daily_status_owner_update on public.daily_metric_status for update to authenticated
using (user_id = auth.uid()) with check (user_id = auth.uid() and public.is_group_member(group_id));
create policy daily_status_owner_delete on public.daily_metric_status for delete to authenticated
using (user_id = auth.uid());
