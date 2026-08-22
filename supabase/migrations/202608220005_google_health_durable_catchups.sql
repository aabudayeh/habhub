-- Durable initial imports and a bounded periodic safety sweep complement the
-- Google Health webhook path. Webhooks remain the low-latency authority; the
-- server jobs recover a failed first import, missed provider notifications,
-- and provider-side revocations that do not emit a webhook.

alter table public.google_health_connections
  add column if not exists next_catchup_at timestamptz not null default now();

alter table public.google_health_webhook_queue
  add column if not exists job_kind text not null default 'webhook';
alter table public.google_health_webhook_queue
  add column if not exists connection_generation bigint;
alter table public.google_health_webhook_queue
  drop constraint if exists google_health_webhook_queue_job_kind_check;
alter table public.google_health_webhook_queue
  add constraint google_health_webhook_queue_job_kind_check check (
    (job_kind = 'webhook' and connection_generation is null and data_type <> '__all__')
    or
    (
      job_kind in ('initial', 'catchup')
      and connection_generation is not null
      and connection_generation >= 0
      and data_type = '__all__'
    )
  );

create index if not exists google_health_connections_catchup_due_idx
  on public.google_health_connections (next_catchup_at, user_id)
  where status = 'connected' and refresh_token_ciphertext is not null;

create index if not exists google_health_webhook_queue_priority_idx
  on public.google_health_webhook_queue (job_kind, available_at, created_at)
  where status = 'pending';

-- The completion RPC changes pending -> connected in the same transaction.
-- This trigger makes the first import durable before that RPC can return.
-- Refresh-token rotation may also advance connection_generation, but leaves
-- the status connected and therefore does not create a second initial job.
create or replace function public.queue_google_health_initial_sync()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_seed text;
  v_hash text;
begin
  if new.status <> 'connected'
     or old.status = 'connected'
     or new.refresh_token_ciphertext is null
     or new.health_user_id is null then
    return new;
  end if;
  v_seed := 'google-health-initial:' || new.user_id::text || ':' || new.connection_generation::text;
  v_hash := pg_catalog.md5(v_seed) || pg_catalog.md5(v_seed || ':2');
  insert into public.google_health_webhook_queue (
    notification_hash,
    health_user_id,
    data_type,
    operation,
    payload,
    job_kind,
    connection_generation,
    status,
    available_at
  ) values (
    v_hash,
    new.health_user_id,
    '__all__',
    'UPSERT',
    '{}'::jsonb,
    'initial',
    new.connection_generation,
    'pending',
    now()
  ) on conflict (notification_hash) do nothing;
  return new;
end;
$$;

revoke all on function public.queue_google_health_initial_sync()
  from public, anon, authenticated;

drop trigger if exists google_health_connection_queue_initial_sync
  on public.google_health_connections;
create trigger google_health_connection_queue_initial_sync
after update of status on public.google_health_connections
for each row
when (new.status = 'connected' and old.status is distinct from 'connected')
execute function public.queue_google_health_initial_sync();

-- One invocation can stage at most one due account, and the global advisory
-- lock plus minute ledger makes that true even when a webhook nudge and cron
-- invoke concurrent workers. Existing connected pilot accounts become due on
-- migration through the column default and are spread over subsequent ticks.
create or replace function public.stage_due_google_health_catchup()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_connection public.google_health_connections%rowtype;
  v_seed text;
  v_hash text;
begin
  if (select auth.role()) is distinct from 'service_role' then
    raise exception 'google_health_service_role_required' using errcode = '42501';
  end if;
  if not public.google_health_runtime_enabled() then return 0; end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('google-health-catchup-stage', 744218)
  );
  if exists (
    select 1
     from public.google_health_webhook_queue queued
     where queued.job_kind = 'catchup'
       and queued.created_at > now() - interval '1 minute'
  ) then
    return 0;
  end if;

  select connection.* into v_connection
    from public.google_health_connections connection
   where connection.status = 'connected'
     and connection.refresh_token_ciphertext is not null
     and connection.health_user_id is not null
     and connection.next_catchup_at <= now()
     and not exists (
       select 1
         from public.google_health_webhook_queue queued
        where queued.health_user_id = connection.health_user_id
          and queued.connection_generation = connection.connection_generation
          and queued.job_kind in ('initial', 'catchup')
          and queued.status in ('pending', 'processing')
     )
   order by connection.next_catchup_at, connection.user_id
   for update skip locked
   limit 1;
  if v_connection.user_id is null then return 0; end if;

  v_seed := 'google-health-catchup:' || v_connection.user_id::text || ':' ||
    v_connection.connection_generation::text || ':' || gen_random_uuid()::text;
  v_hash := pg_catalog.md5(v_seed) || pg_catalog.md5(v_seed || ':2');
  insert into public.google_health_webhook_queue (
    notification_hash,
    health_user_id,
    data_type,
    operation,
    payload,
    job_kind,
    connection_generation,
    status,
    available_at
  ) values (
    v_hash,
    v_connection.health_user_id,
    '__all__',
    'UPSERT',
    '{}'::jsonb,
    'catchup',
    v_connection.connection_generation,
    'pending',
    now()
  ) on conflict (notification_hash) do nothing;
  return 1;
end;
$$;

revoke all on function public.stage_due_google_health_catchup()
  from public, anon, authenticated;
grant execute on function public.stage_due_google_health_catchup()
  to service_role;

-- Webhook notifications always claim ahead of synthetic work. Initial jobs
-- precede periodic catch-ups, while available_at still orders retry backoff
-- within each class.
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
  if not public.google_health_runtime_enabled() then return; end if;
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
     order by
       case queue.job_kind
         when 'webhook' then 0
         when 'initial' then 1
         else 2
       end,
       queue.available_at,
       queue.created_at
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

comment on column public.google_health_connections.next_catchup_at is
  'Server-only due time for the roughly six-hour webhook safety sweep.';
comment on column public.google_health_webhook_queue.job_kind is
  'Distinguishes signed provider notifications from durable initial and periodic sync jobs.';
