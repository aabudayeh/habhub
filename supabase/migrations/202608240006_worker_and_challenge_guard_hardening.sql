-- Forward-only hardening for migrations 202608240001 and 202608240004, which
-- are already present in production and therefore remain immutable here.

-- A missing runtime-config singleton makes SELECT INTO assign NULL. Treat that
-- partial configuration as disabled, and use the existing partial expiry index
-- by ignoring any future consumed grant rows.
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

-- The first production repair qualified the ambiguous event_key clauses. This
-- repeat-safe guard accepts that repaired definition, repairs the one known old
-- shape if encountered elsewhere, and fails closed on partial or unknown drift.
do $migration$
declare
  target_oid oid := pg_catalog.to_regprocedure(
    'public.stage_group_challenge_notifications(integer)'
  )::oid;
  current_definition text;
  rewritten_definition text;
  group_conflict_pattern constant text :=
    'on[[:space:]]+conflict[[:space:]]*[(][[:space:]]*recipient_id[[:space:]]*,[[:space:]]*event_key[[:space:]]*[)][[:space:]]+do[[:space:]]+nothing';
  push_conflict_pattern constant text :=
    'on[[:space:]]+conflict[[:space:]]*[(][[:space:]]*event_key[[:space:]]*[)][[:space:]]+do[[:space:]]+nothing[[:space:]]+returning[[:space:]]+event_key[[:space:]]+into[[:space:]]+v_inserted';
  v_event_conflicts integer;
  v_push_returns integer;
begin
  if target_oid is null then
    raise exception 'stage_group_challenge_notifications(integer) is missing'
      using errcode = 'P0001';
  end if;
  if not exists (
    select 1
      from pg_catalog.pg_constraint constraint_row
      join pg_catalog.pg_class relation on relation.oid = constraint_row.conrelid
      join pg_catalog.pg_namespace namespace on namespace.oid = relation.relnamespace
     where namespace.nspname = 'public'
       and relation.relname = 'group_notification_events'
       and constraint_row.conname =
         'group_notification_events_recipient_id_event_key_key'
       and constraint_row.contype = 'u'
  ) or not exists (
    select 1
      from pg_catalog.pg_constraint constraint_row
      join pg_catalog.pg_class relation on relation.oid = constraint_row.conrelid
      join pg_catalog.pg_namespace namespace on namespace.oid = relation.relnamespace
     where namespace.nspname = 'public'
       and relation.relname = 'push_dispatch_events'
       and constraint_row.conname = 'push_dispatch_events_event_key_key'
       and constraint_row.contype = 'u'
  ) then
    raise exception 'Expected challenge notification unique constraints are missing'
      using errcode = 'P0001';
  end if;

  select pg_catalog.pg_get_functiondef(target_oid) into current_definition;
  select count(*) into v_event_conflicts
    from pg_catalog.regexp_matches(current_definition, group_conflict_pattern, 'gi');
  select count(*) into v_push_returns
    from pg_catalog.regexp_matches(current_definition, push_conflict_pattern, 'gi');

  if v_event_conflicts = 0 and v_push_returns = 0 then
    rewritten_definition := current_definition;
  else
    if v_event_conflicts <> 2 or v_push_returns <> 2 then
      raise exception
        'Unexpected challenge notification clause counts: feed %, push %',
        v_event_conflicts,
        v_push_returns
        using errcode = 'P0001';
    end if;
    rewritten_definition := pg_catalog.regexp_replace(
      current_definition,
      group_conflict_pattern,
      'on conflict on constraint group_notification_events_recipient_id_event_key_key do nothing',
      'gi'
    );
    rewritten_definition := pg_catalog.regexp_replace(
      rewritten_definition,
      push_conflict_pattern,
      'on conflict on constraint push_dispatch_events_event_key_key do nothing returning push_dispatch_events.event_key into v_inserted',
      'gi'
    );
  end if;

  if rewritten_definition ~* group_conflict_pattern
     or rewritten_definition ~* push_conflict_pattern
     or pg_catalog.strpos(
          rewritten_definition,
          'on conflict on constraint group_notification_events_recipient_id_event_key_key'
        ) = 0
     or pg_catalog.strpos(
          rewritten_definition,
          'returning push_dispatch_events.event_key into v_inserted'
        ) = 0 then
    raise exception 'Unexpected stage_group_challenge_notifications definition'
      using errcode = 'P0001';
  end if;

  if rewritten_definition is distinct from current_definition then
    execute rewritten_definition;
  end if;

  select pg_catalog.pg_get_functiondef(target_oid) into current_definition;
  if current_definition ~* group_conflict_pattern
     or current_definition ~* push_conflict_pattern then
    raise exception 'Challenge notification event_key ambiguity remains'
      using errcode = 'P0001';
  end if;
end;
$migration$;
