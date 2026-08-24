-- Repair the deployed challenge-notification worker without rewriting its
-- applied migration. The function returns a column named `event_key`, so an
-- unqualified conflict target/RETURNING expression with the same name is
-- ambiguous inside PL/pgSQL (SQLSTATE 42702).
--
-- Keep this patch guarded: a future definition must not be silently rewritten
-- if its shape differs from the two known event and two known push inserts.
do $migration$
declare
  v_definition text;
  v_event_conflicts integer;
  v_push_returns integer;
begin
  select pg_catalog.pg_get_functiondef(
           'public.stage_group_challenge_notifications(integer)'::regprocedure
         )
    into v_definition;

  select count(*)
    into v_event_conflicts
    from pg_catalog.regexp_matches(
      v_definition,
      'on[[:space:]]+conflict[[:space:]]*\([[:space:]]*recipient_id[[:space:]]*,[[:space:]]*event_key[[:space:]]*\)[[:space:]]+do[[:space:]]+nothing',
      'gi'
    );
  select count(*)
    into v_push_returns
    from pg_catalog.regexp_matches(
      v_definition,
      'on[[:space:]]+conflict[[:space:]]*\([[:space:]]*event_key[[:space:]]*\)[[:space:]]+do[[:space:]]+nothing[[:space:]]+returning[[:space:]]+event_key[[:space:]]+into[[:space:]]+v_inserted',
      'gi'
    );

  if v_event_conflicts <> 2 or v_push_returns <> 2 then
    raise exception using
      errcode = 'P0001',
      message = format(
        'Unexpected stage_group_challenge_notifications shape (%s event conflicts, %s push returns)',
        v_event_conflicts,
        v_push_returns
      );
  end if;

  v_definition := pg_catalog.regexp_replace(
    v_definition,
    'on[[:space:]]+conflict[[:space:]]*\([[:space:]]*recipient_id[[:space:]]*,[[:space:]]*event_key[[:space:]]*\)[[:space:]]+do[[:space:]]+nothing',
    'on conflict on constraint group_notification_events_recipient_id_event_key_key do nothing',
    'gi'
  );
  v_definition := pg_catalog.regexp_replace(
    v_definition,
    'on[[:space:]]+conflict[[:space:]]*\([[:space:]]*event_key[[:space:]]*\)[[:space:]]+do[[:space:]]+nothing[[:space:]]+returning[[:space:]]+event_key[[:space:]]+into[[:space:]]+v_inserted',
    'on conflict on constraint push_dispatch_events_event_key_key do nothing returning push_dispatch_events.event_key into v_inserted',
    'gi'
  );

  execute v_definition;
end;
$migration$;
