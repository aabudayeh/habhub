-- The minute cron previously treated every due connection as runnable even
-- when that connection generation already had a durable initial/catch-up job.
-- stage_due_google_health_catchup() correctly refused the duplicate, but only
-- after cron had called the Edge worker and the worker had performed its
-- housekeeping RPCs. A retry delayed by available_at, or a healthy in-flight
-- job, could therefore wake the worker every minute without creating work.
--
-- Provider webhooks/retries and expired worker leases remain runnable through
-- the queue predicate. Connections without an active synthetic job remain
-- runnable so the hourly catch-up is staged. The explicit minute-zero wake is
-- retained for bounded maintenance even when every queue is idle.

create index if not exists google_health_webhook_queue_active_synthetic_idx
  on public.google_health_webhook_queue (
    health_user_id,
    connection_generation
  )
  where job_kind in ('initial', 'catchup')
    and status in ('pending', 'processing');

create or replace function public.invoke_google_health_worker()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_url text;
  v_secret text;
  v_runtime_enabled boolean := false;
  v_hourly_maintenance boolean := false;
begin
  select coalesce(config.enabled, false) into v_runtime_enabled
    from public.google_health_runtime_config config
   where config.singleton = true;
  v_runtime_enabled := coalesce(v_runtime_enabled, false);
  v_hourly_maintenance := extract(minute from clock_timestamp())::integer = 0;

  if not v_hourly_maintenance
     and not exists (
       select 1
         from public.google_health_pending_grants staged
        where staged.consumed_at is null
          and staged.expires_at <= clock_timestamp()
     )
     and not exists (
       select 1
         from public.google_health_revocation_queue queued
        where (queued.status = 'pending' and queued.available_at <= clock_timestamp())
           or (queued.status = 'processing'
               and queued.claimed_at < clock_timestamp() - interval '10 minutes')
     )
     and not (
       v_runtime_enabled and (
         -- This includes due provider webhooks, delayed retries, due initial/
         -- catch-up jobs, and expired processing leases.
         exists (
           select 1
             from public.google_health_webhook_queue queued
            where (queued.status = 'pending' and queued.available_at <= clock_timestamp())
               or (queued.status = 'processing'
                   and queued.claimed_at < clock_timestamp() - interval '30 minutes')
         )
         or exists (
           select 1
             from public.google_health_connections connection
            where connection.status = 'connected'
              and connection.refresh_token_ciphertext is not null
              and connection.health_user_id is not null
              and connection.next_catchup_at <= clock_timestamp()
              -- A durable job for this exact connection generation owns the
              -- retry/lease schedule. Do not wake merely because next_catchup
              -- remains due until that job completes successfully.
              and not exists (
                select 1
                  from public.google_health_webhook_queue active_job
                 where active_job.health_user_id = connection.health_user_id
                   and active_job.connection_generation =
                     connection.connection_generation
                   and active_job.job_kind in ('initial', 'catchup')
                   and active_job.status in ('pending', 'processing')
              )
         )
       )
     ) then
    return;
  end if;

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
grant execute on function public.invoke_google_health_worker()
  to service_role;

comment on index public.google_health_webhook_queue_active_synthetic_idx is
  'Supports the scheduler and catch-up stager generation-level active-job guard.';
comment on function public.invoke_google_health_worker() is
  'Minute scheduler guard: wakes only for maintenance, due grants/revocations/queue work, or a due connection without an active synthetic job.';
