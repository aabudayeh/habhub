-- Closed-PWA reminders depend on a minute cron handing work to the Edge
-- worker. The original worker intentionally used a separate secret, but an
-- unconfigured Vault entry made the cron return successfully without doing
-- anything. Keep the secret boundary and make configuration explicit,
-- validated, and fail-visible instead.

create or replace function public.configure_web_personal_notification_worker(
  p_url text,
  p_secret text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_url text := btrim(coalesce(p_url, ''));
  v_secret text := btrim(coalesce(p_secret, ''));
  v_url_id uuid;
  v_secret_id uuid;
begin
  if v_url !~ '^https://[a-z0-9-]+[.]supabase[.]co/functions/v1/web-personal-notifications$' then
    raise exception 'Invalid Web personal notification worker URL.'
      using errcode = '22023';
  end if;
  if char_length(v_secret) < 32 or char_length(v_secret) > 512
     or v_secret ~ '[[:space:]]' then
    raise exception 'Invalid Web personal notification worker secret.'
      using errcode = '22023';
  end if;

  select secret.id into v_url_id
    from vault.secrets secret
   where secret.name = 'web_personal_notification_worker_url'
   order by secret.created_at desc
   limit 1;
  if v_url_id is null then
    perform vault.create_secret(
      v_url,
      'web_personal_notification_worker_url',
      'Cron URL for closed-PWA personal reminders'
    );
  else
    perform vault.update_secret(
      v_url_id,
      v_url,
      'web_personal_notification_worker_url',
      'Cron URL for closed-PWA personal reminders'
    );
  end if;

  select secret.id into v_secret_id
    from vault.secrets secret
   where secret.name = 'web_personal_notification_worker_secret'
   order by secret.created_at desc
   limit 1;
  if v_secret_id is null then
    perform vault.create_secret(
      v_secret,
      'web_personal_notification_worker_secret',
      'Authorization secret for the closed-PWA reminder worker'
    );
  else
    perform vault.update_secret(
      v_secret_id,
      v_secret,
      'web_personal_notification_worker_secret',
      'Authorization secret for the closed-PWA reminder worker'
    );
  end if;
end;
$$;

revoke all on function public.configure_web_personal_notification_worker(text, text)
  from public, anon, authenticated;
grant execute on function public.configure_web_personal_notification_worker(text, text)
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

-- Older worker releases treated "there is no subscription yet" as a terminal
-- preference suppression. Re-publishing the same stable schedule key then
-- left dispatched_at untouched, so that reminder could never recover. Reopen
-- only those explicitly retryable rows; a gateway-accepted row remains final
-- and cannot be duplicated.
create or replace function public.reopen_retryable_web_personal_notification()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if old.dispatched_at is not null
     and old.last_error = 'preference_suppressed'
     and new.updated_at is distinct from old.updated_at
     and new.scheduled_for >= clock_timestamp() - interval '5 minutes' then
    new.dispatched_at := null;
    new.next_attempt_at := greatest(new.scheduled_for, clock_timestamp());
    new.lease_owner := null;
    new.lease_until := null;
    new.last_error := null;
  end if;
  return new;
end;
$$;

revoke all on function public.reopen_retryable_web_personal_notification()
  from public, anon, authenticated;

drop trigger if exists web_personal_notification_reopen_retryable
  on public.web_personal_notification_schedule;
create trigger web_personal_notification_reopen_retryable
before update on public.web_personal_notification_schedule
for each row execute function public.reopen_retryable_web_personal_notification();

-- A PWA may be suspended between publishing a near-term schedule and
-- registering its PushSubscription. Once that account registers/replaces a
-- subscription, make any still-live retry immediately eligible instead of
-- waiting for a prior exponential-backoff timestamp.
create or replace function public.wake_web_personal_notifications_after_subscription()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.web_personal_notification_schedule scheduled
     set next_attempt_at = greatest(scheduled.scheduled_for, clock_timestamp()),
         lease_owner = null,
         lease_until = null,
         updated_at = clock_timestamp()
   where scheduled.user_id = new.user_id
     and scheduled.dispatched_at is null
     and scheduled.expires_at > clock_timestamp()
     and scheduled.last_error in (
       'No active Web Push subscription is registered',
       'No active Web Push subscription accepted the reminder'
     );
  return new;
end;
$$;

revoke all on function public.wake_web_personal_notifications_after_subscription()
  from public, anon, authenticated;

drop trigger if exists web_push_subscription_wake_personal_notifications
  on public.web_push_subscriptions;
create trigger web_push_subscription_wake_personal_notifications
after insert or update on public.web_push_subscriptions
for each row execute function public.wake_web_personal_notifications_after_subscription();

-- Recreate the job so applying this repair also restores projects where the
-- earlier schedule was removed manually while troubleshooting.
select cron.unschedule(jobid)
  from cron.job
 where jobname = 'web-personal-notifications-every-minute';
select cron.schedule(
  'web-personal-notifications-every-minute',
  '* * * * *',
  'select public.invoke_web_personal_notification_worker()'
);

notify pgrst, 'reload schema';
