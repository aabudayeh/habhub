-- Keep connected Web/PWA accounts fresh even when HabHub is closed and a
-- provider webhook is delayed. The worker still stages at most one account
-- per minute, avoiding a synchronized database or provider burst.

update public.google_health_connections connection
   set next_catchup_at = least(
     connection.next_catchup_at,
     now() + interval '1 hour'
   )
 where connection.status = 'connected'
   and connection.refresh_token_ciphertext is not null;

comment on column public.google_health_connections.next_catchup_at is
  'Server-only due time for the roughly hourly webhook safety sweep.';

-- Both minute crons used to enqueue an Edge request even when there was no
-- work.  That produced one pg_net request per worker per minute (and matching
-- response cleanup) for an otherwise idle project.  Keep the
-- minute jobs for prompt retries/reminders, but cross the network boundary
-- only when indexed durable work is actually due.
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
  v_hourly_maintenance := extract(minute from clock_timestamp())::integer = 0;

  if not v_hourly_maintenance
     and not exists (
       select 1
         from public.google_health_pending_grants staged
        where staged.expires_at <= clock_timestamp()
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

create or replace function public.invoke_web_personal_notification_worker()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_url text;
  v_secret text;
begin
  if not exists (
    select 1
      from public.web_personal_notification_schedule scheduled
     where scheduled.dispatched_at is null
       and scheduled.next_attempt_at <= clock_timestamp()
       and scheduled.scheduled_for <= clock_timestamp()
       and scheduled.expires_at > clock_timestamp()
       and (scheduled.lease_until is null
            or scheduled.lease_until < clock_timestamp())
  ) then
    return;
  end if;

  select secret.decrypted_secret into v_url
    from vault.decrypted_secrets secret
   where secret.name = 'web_personal_notification_worker_url'
   order by secret.created_at desc limit 1;
  select secret.decrypted_secret into v_secret
    from vault.decrypted_secrets secret
   where secret.name = 'web_personal_notification_worker_secret'
   order by secret.created_at desc limit 1;
  if nullif(btrim(v_url), '') is null then
    raise exception 'web_personal_notification_worker_url is not configured';
  end if;
  if nullif(btrim(v_secret), '') is null then
    raise exception 'web_personal_notification_worker_secret is not configured';
  end if;
  perform net.http_post(
    url := v_url,
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || v_secret,
      'Content-Type', 'application/json'
    ),
    body := '{"limit":50}'::jsonb,
    timeout_milliseconds := 15000
  );
end;
$$;

revoke all on function public.invoke_web_personal_notification_worker()
  from public, anon, authenticated;
grant execute on function public.invoke_web_personal_notification_worker()
  to service_role;

comment on function public.invoke_google_health_worker() is
  'Minute cron hook; invokes Edge only for due Google Health work or hourly maintenance.';
comment on function public.invoke_web_personal_notification_worker() is
  'Minute cron hook; invokes Edge only while a deliverable Web reminder is due.';
