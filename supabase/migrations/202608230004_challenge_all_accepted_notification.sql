-- Announce the one-time transition where every invited participant has joined.
-- Feed and push identities are server-owned and stable, so retries or a later
-- accept -> decline -> accept cycle can never duplicate the celebration.

alter table public.group_notification_events
  drop constraint if exists group_notification_events_event_type_check;
alter table public.group_notification_events
  add constraint group_notification_events_event_type_check check (
    event_type in (
      'challenge_invitation', 'challenge_accepted',
      'challenge_all_accepted', 'challenge_standing',
      'challenge_reminder', 'challenge_result'
    )
  );

create or replace function public.emit_group_challenge_all_accepted_notification()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid;
  v_recipient_id uuid;
  v_participants uuid[] := coalesce(new.participant_ids, array[]::uuid[]);
  v_accepted uuid[] := coalesce(
    new.accepted_participant_ids,
    array[]::uuid[]
  );
  v_old_participants uuid[] := coalesce(
    old.participant_ids,
    array[]::uuid[]
  );
  v_old_accepted uuid[] := coalesce(
    old.accepted_participant_ids,
    array[]::uuid[]
  );
  v_title text := 'Everyone is in';
  v_detail text := 'Everyone accepted. Challenge starts '
    || pg_catalog.to_char(new.local_date, 'FMMon FMDD, YYYY') || '.';
  v_created_at timestamptz := clock_timestamp();
begin
  if new.deleted_at is not null
     or cardinality(v_participants) = 0
     or not (v_participants <@ v_accepted)
     or (
       cardinality(v_old_participants) > 0
       and v_old_participants <@ v_old_accepted
     ) then
    return new;
  end if;

  select accepted.user_id
    into v_actor_id
    from unnest(v_accepted) accepted(user_id)
   where not (accepted.user_id = any(v_old_accepted))
   order by accepted.user_id
   limit 1;
  v_actor_id := coalesce(v_actor_id, new.creator_id);

  for v_recipient_id in
    select participant.user_id
      from unnest(v_participants) participant(user_id)
      join public.group_members member
        on member.group_id = new.group_id
       and member.user_id = participant.user_id
       and member.status = 'active'
     order by participant.user_id
  loop
    insert into public.group_notification_events (
      event_key,
      group_id,
      recipient_id,
      actor_id,
      event_type,
      challenge_id,
      occurrence_date,
      title,
      detail,
      created_at
    ) values (
      'challenge-all-accepted:' || new.id::text,
      new.group_id,
      v_recipient_id,
      v_actor_id,
      'challenge_all_accepted',
      new.id,
      new.local_date,
      v_title,
      v_detail,
      v_created_at
    ) on conflict (recipient_id, event_key) do nothing;
  end loop;

  insert into public.push_dispatch_events (
    event_key,
    group_id,
    dispatcher_id,
    category,
    event_type,
    audience,
    title,
    body,
    data,
    created_at
  ) values (
    'challenge-all-accepted:' || new.id::text,
    new.group_id,
    v_actor_id,
    'challenge',
    'challenge_all_accepted',
    'challenge_participants',
    v_title,
    v_detail,
    jsonb_build_object(
      'route', '/group',
      'groupId', new.group_id,
      'challengeId', new.id,
      'challengeEvent', 'all_accepted',
      'startDate', new.local_date
    ),
    v_created_at
  ) on conflict (event_key) do nothing;

  return new;
end;
$$;

revoke all on function public.emit_group_challenge_all_accepted_notification()
  from public, anon, authenticated;

drop trigger if exists group_challenges_emit_all_accepted_notification
  on public.group_challenges;
create trigger group_challenges_emit_all_accepted_notification
after update of accepted_participant_ids
on public.group_challenges
for each row
execute function public.emit_group_challenge_all_accepted_notification();

notify pgrst, 'reload schema';
