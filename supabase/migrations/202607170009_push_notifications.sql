create table if not exists public.device_push_tokens (
  token text primary key,
  user_id uuid not null references public.profiles(id) on delete cascade,
  platform text not null check (platform in ('android', 'ios')),
  preferences jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create index if not exists device_push_tokens_user_idx on public.device_push_tokens (user_id);
alter table public.device_push_tokens enable row level security;
create policy push_tokens_owner_read on public.device_push_tokens for select to authenticated using (user_id = auth.uid());
create policy push_tokens_owner_insert on public.device_push_tokens for insert to authenticated with check (user_id = auth.uid());
create policy push_tokens_owner_update on public.device_push_tokens for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy push_tokens_owner_delete on public.device_push_tokens for delete to authenticated using (user_id = auth.uid());

-- Used by the server function to make retries idempotent. Clients cannot access it.
create table if not exists public.push_events (
  event_key text primary key,
  sender_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now()
);
alter table public.push_events enable row level security;
