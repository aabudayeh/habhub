-- Group-scoped aliases and per-group badge showcases introduced by the fourth UI refinement.

create table if not exists public.group_member_aliases (
  owner_user_id uuid not null references public.profiles(id) on delete cascade,
  group_id uuid not null references public.groups(id) on delete cascade,
  subject_user_id uuid not null references public.profiles(id) on delete cascade,
  nickname text not null check (char_length(nickname) <= 80),
  updated_at timestamptz not null default now(),
  primary key (owner_user_id, group_id, subject_user_id)
);

create table if not exists public.badge_showcases (
  user_id uuid not null references public.profiles(id) on delete cascade,
  group_id uuid not null references public.groups(id) on delete cascade,
  badge_ids text[] not null default '{}'::text[] check (cardinality(badge_ids) <= 5),
  updated_at timestamptz not null default now(),
  primary key (user_id, group_id)
);

alter table public.group_member_aliases enable row level security;
alter table public.badge_showcases enable row level security;

create policy group_member_aliases_owner_all on public.group_member_aliases for all to authenticated
  using (
    owner_user_id = auth.uid()
    and exists (select 1 from public.group_members gm where gm.group_id = group_member_aliases.group_id and gm.user_id = auth.uid())
  )
  with check (
    owner_user_id = auth.uid()
    and exists (select 1 from public.group_members gm where gm.group_id = group_member_aliases.group_id and gm.user_id = auth.uid())
  );

create policy badge_showcases_group_read on public.badge_showcases for select to authenticated
  using (exists (select 1 from public.group_members gm where gm.group_id = badge_showcases.group_id and gm.user_id = auth.uid()));

create policy badge_showcases_owner_write on public.badge_showcases for all to authenticated
  using (user_id = auth.uid()) with check (
    user_id = auth.uid()
    and exists (select 1 from public.group_members gm where gm.group_id = badge_showcases.group_id and gm.user_id = auth.uid())
  );

create index if not exists group_member_aliases_group_idx on public.group_member_aliases (group_id, subject_user_id);
