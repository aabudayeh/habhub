-- Shared event reminders are opt-in, timed, and independent of phone activity.
-- Keep one durable identity for an event/start/offset, unaffected by title edits.
alter table public.group_schedule_items
  add column if not exists reminder_minutes integer,
  add column if not exists reminder_staged_key text;

alter table public.group_schedule_items
  add constraint group_schedule_items_reminder_check check (
    reminder_minutes is null or (
      not all_day and reminder_minutes in (0, 5, 15, 30, 60, 1440)
    )
  );

alter table public.group_schedule_items
  add column reminder_due_at timestamptz generated always as (
    case when reminder_minutes is not null and not all_day then
      ((starts_at at time zone 'UTC') - reminder_minutes * interval '1 minute')
        at time zone 'UTC'
    end
  ) stored;

create or replace function public.group_schedule_reminder_key(
  p_item_id uuid, p_starts_at timestamptz, p_reminder_minutes integer
)
returns text language sql immutable strict set search_path = '' as $$
  select 'group-schedule-reminder:' || p_item_id::text || ':' ||
    floor(extract(epoch from p_starts_at) * 1000)::bigint::text || ':' ||
    p_reminder_minutes::text
$$;
revoke all on function public.group_schedule_reminder_key(uuid, timestamptz, integer)
  from public, anon, authenticated;
grant execute on function public.group_schedule_reminder_key(uuid, timestamptz, integer)
  to service_role;

create index group_schedule_items_due_reminder_idx
  on public.group_schedule_items (reminder_due_at, id)
  where reminder_due_at is not null
    and reminder_staged_key is distinct from public.group_schedule_reminder_key(
      id, starts_at, reminder_minutes
    );
create index group_schedule_reminder_pending_push_idx
  on public.push_dispatch_events (expires_at, created_at, event_key)
  where dispatched_at is null and event_type = 'group_schedule_reminder';
create index group_schedule_items_overlap_end_idx
  on public.group_schedule_items (group_id, ends_at, id)
  where ends_at is not null;

-- Delivery bookkeeping must not invalidate every member's calendar. Keep the
-- existing compact broadcast for actual shared content/revision changes only.
drop trigger group_schedule_items_compact_broadcast on public.group_schedule_items;
create trigger group_schedule_items_compact_broadcast
after insert or delete or update of
  id, group_id, creator_id, title, notes, starts_at, ends_at, all_day,
  reminder_minutes, revision
on public.group_schedule_items
for each row execute function public.broadcast_group_hub_change();

-- Eight-argument clients remain compatible through the trailing default.
drop function public.save_group_schedule_item(uuid, uuid, text, text, timestamptz, timestamptz, boolean, bigint);
create or replace function public.save_group_schedule_item(
  p_item_id uuid,
  p_group_id uuid,
  p_title text,
  p_notes text,
  p_starts_at timestamptz,
  p_ends_at timestamptz,
  p_all_day boolean,
  p_expected_revision bigint,
  p_reminder_minutes integer default null
)
returns public.group_schedule_items
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid := (select auth.uid());
  v_existing public.group_schedule_items;
  v_saved public.group_schedule_items;
  v_title text := btrim(coalesce(p_title, ''));
  v_notes text := nullif(btrim(p_notes), '');
  v_all_day boolean := coalesce(p_all_day, false);
  v_starts_at timestamptz;
  v_ends_at timestamptz;
begin
  if v_actor_id is null then
    raise exception 'Authentication required.' using errcode = '42501';
  end if;
  if p_group_id is null or not public.is_group_member(p_group_id) then
    raise exception 'Active group membership required.' using errcode = '42501';
  end if;
  if not public.habhub_has_current_terms_acceptance() then
    raise exception 'Accept the current Terms before sharing a group event.'
      using errcode = '42501';
  end if;
  if char_length(v_title) not between 1 and 160 then
    raise exception 'An event title must contain 1 to 160 characters.'
      using errcode = '22023';
  end if;
  if v_notes is not null and char_length(v_notes) > 4000 then
    raise exception 'Event notes can contain at most 4000 characters.'
      using errcode = '22023';
  end if;
  if p_starts_at is not null and v_all_day then
    v_starts_at := (
      (p_starts_at at time zone 'UTC')::date + time '12:00:00'
    ) at time zone 'UTC';
    v_ends_at := null;
  else
    v_starts_at := p_starts_at;
    v_ends_at := p_ends_at;
  end if;
  if v_starts_at is null or (v_ends_at is not null and v_ends_at < v_starts_at) then
    raise exception 'Choose a valid event time range.' using errcode = '22023';
  end if;
  if not public.habhub_message_content_allowed(
    concat_ws(' ', v_title, v_notes)
  ) then
    raise exception 'This event cannot be shared as written.' using errcode = '22023';
  end if;

  if p_reminder_minutes is not null and (
    v_all_day or p_reminder_minutes not in (0, 5, 15, 30, 60, 1440)
  ) then
    raise exception 'Choose a supported reminder for a timed group event.'
      using errcode = '22023';
  end if;

  if p_item_id is null then
    if p_expected_revision is not null then
      raise exception 'A new group event cannot have an expected revision.'
        using errcode = '22023';
    end if;
    insert into public.group_schedule_items (
      group_id, creator_id, title, notes, starts_at, ends_at, all_day, reminder_minutes
    ) values (
      p_group_id, v_actor_id, v_title, v_notes, v_starts_at, v_ends_at,
      v_all_day, p_reminder_minutes
    ) returning * into v_saved;
    return v_saved;
  end if;

  select * into v_existing
    from public.group_schedule_items item
   where item.id = p_item_id
   for update;
  if not found or v_existing.group_id <> p_group_id
     or not public.is_group_member(v_existing.group_id)
     or (
       v_existing.creator_id <> v_actor_id
       and not public.habhub_message_visible_to_current_user(
         v_existing.creator_id,
         null
       )
     ) then
    raise exception 'Group event not found.' using errcode = 'P0002';
  end if;
  if v_existing.creator_id <> v_actor_id
     and not public.is_group_admin(v_existing.group_id) then
    raise exception 'Only the creator or a group administrator can edit this event.'
      using errcode = '42501';
  end if;
  if p_expected_revision is null
     or p_expected_revision <> v_existing.revision then
    raise exception 'This group event changed on another device. Refresh and try again.'
      using errcode = '40001';
  end if;

  update public.group_schedule_items
     set title = v_title,
         notes = v_notes,
         starts_at = v_starts_at,
         ends_at = v_ends_at,
         all_day = v_all_day,
         reminder_minutes = p_reminder_minutes,
         revision = revision + 1,
         updated_at = clock_timestamp()
   where id = p_item_id
   returning * into v_saved;
  return v_saved;
end;
$$;

revoke all on function public.save_group_schedule_item(
  uuid, uuid, text, text, timestamptz, timestamptz, boolean, bigint, integer
) from public, anon;
grant execute on function public.save_group_schedule_item(
  uuid, uuid, text, text, timestamptz, timestamptz, boolean, bigint, integer
) to authenticated;

alter table public.group_notification_events
  drop constraint group_notification_events_event_type_check;
alter table public.group_notification_events
  add constraint group_notification_events_event_type_check check (
    event_type in (
      'challenge_invitation', 'challenge_accepted', 'challenge_all_accepted',
      'challenge_standing', 'challenge_reminder', 'challenge_result',
      'social_reaction', 'social_comment', 'group_todo_completed',
      'group_todo_all_completed', 'group_note_created', 'group_note_updated',
      'group_schedule_created', 'group_schedule_updated', 'group_schedule_reminder'
    )
  );

-- Reminders carry the same member and block boundary as the shared event.
drop policy group_notification_events_recipient_read on public.group_notification_events;
create policy group_notification_events_recipient_read
on public.group_notification_events for select to authenticated using (
  recipient_id = (select auth.uid())
  and (
    public.is_group_member(group_id)
    or exists (
      select 1 from public.group_challenges challenge
      where challenge.id = group_notification_events.challenge_id
        and challenge.audience = 'public'
        and (select auth.uid()) = any(challenge.participant_ids)
    )
  )
  and (
    event_type not in (
      'social_reaction', 'social_comment', 'group_todo_completed',
      'group_todo_all_completed', 'group_note_created', 'group_note_updated',
      'group_schedule_created', 'group_schedule_updated', 'group_schedule_reminder'
    )
    or not public.habhub_users_blocked_either_way(actor_id, (select auth.uid()))
  )
);

create or replace function public.group_schedule_reminder_is_current(
  p_group_id uuid, p_item_id uuid, p_event_key text
)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.group_schedule_items item
    join public.group_members creator
      on creator.group_id = item.group_id and creator.user_id = item.creator_id
      and creator.status = 'active'
    where item.id = p_item_id and item.group_id = p_group_id
      and item.reminder_due_at <= now()
      and item.starts_at > now() - interval '15 minutes'
      and item.reminder_minutes is not null and not item.all_day
      and p_event_key = public.group_schedule_reminder_key(
        item.id, item.starts_at, item.reminder_minutes
      )
  )
$$;
revoke all on function public.group_schedule_reminder_is_current(uuid, uuid, text)
  from public, anon, authenticated;
grant execute on function public.group_schedule_reminder_is_current(uuid, uuid, text)
  to service_role;

create or replace function public.invalidate_group_schedule_reminder_instance()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.starts_at is not distinct from old.starts_at
     and new.reminder_minutes is not distinct from old.reminder_minutes
     and new.all_day is not distinct from old.all_day then
    return new;
  end if;
  delete from public.group_notification_events event
   where event.group_id = new.group_id
     and event.event_type = 'group_schedule_reminder'
     and event.target_type = 'group_schedule' and event.target_id = new.id::text;
  -- Retain accepted identities for deduplication and receipt settlement.
  update public.push_dispatch_events event
     set expires_at = least(event.expires_at, clock_timestamp())
   where event.group_id = new.group_id
     and event.event_type = 'group_schedule_reminder'
     and event.data ->> 'scheduleItemId' = new.id::text
     and event.dispatched_at is null;
  return new;
end;
$$;
revoke all on function public.invalidate_group_schedule_reminder_instance()
  from public, anon, authenticated;
create trigger group_schedule_reminder_invalidate
after update of starts_at, reminder_minutes, all_day on public.group_schedule_items
for each row execute function public.invalidate_group_schedule_reminder_instance();

create or replace function public.stage_due_group_schedule_reminders(p_limit integer default 100)
returns table(event_key text)
language plpgsql security definer set search_path = '' as $$
declare
  v_item public.group_schedule_items;
  v_now timestamptz := clock_timestamp();
  v_key text;
  v_inserted text;
begin
  if not exists (
    select 1 from public.push_dispatch_configuration
     where singleton and emitters_active
  ) then return; end if;
  for v_item in
    select item.* from public.group_schedule_items item
    where item.reminder_due_at <= v_now
      and item.reminder_due_at > v_now - interval '25 hours'
      and item.starts_at > v_now - interval '15 minutes'
      and item.reminder_staged_key is distinct from public.group_schedule_reminder_key(
        item.id, item.starts_at, item.reminder_minutes
      )
      and exists (
        select 1 from public.group_members creator
        where creator.group_id = item.group_id
          and creator.user_id = item.creator_id and creator.status = 'active'
      )
    order by item.reminder_due_at, item.id
    limit greatest(1, least(coalesce(p_limit, 100), 500))
    for update of item skip locked
  loop
    v_key := public.group_schedule_reminder_key(v_item.id, v_item.starts_at, v_item.reminder_minutes);
    insert into public.group_notification_events (
      event_key, group_id, recipient_id, actor_id, event_type, challenge_id,
      title, detail, occurrence_date, target_type, target_id, created_at
    )
    select v_key, v_item.group_id, member.user_id, v_item.creator_id,
      'group_schedule_reminder', null, 'Group event reminder',
      'A shared event is coming up. Open Group Schedule for the time and details.',
      (v_item.starts_at at time zone 'UTC')::date, 'group_schedule', v_item.id::text, v_now
    from public.group_members member
    join public.user_snapshots snapshot on snapshot.user_id = member.user_id
    where member.group_id = v_item.group_id and member.status = 'active'
      and snapshot.payload #> array['settings', 'notifications', 'groupPreferencesByGroup', v_item.group_id::text, 'scheduleReminders'] = 'true'::jsonb
      and snapshot.payload #> array['settings', 'notifications', 'groupPreferencesByGroup', v_item.group_id::text, 'enabled'] is distinct from 'false'::jsonb
      and not public.habhub_users_blocked_either_way(v_item.creator_id, member.user_id)
    on conflict on constraint group_notification_events_recipient_id_event_key_key do nothing;

    if exists (
      select 1 from public.group_notification_events notification
       where notification.event_key = v_key
         and notification.group_id = v_item.group_id
    ) then
      v_inserted := null;
      insert into public.push_dispatch_events (
        event_key, group_id, dispatcher_id, category, event_type, audience,
        title, body, data, expires_at
      ) values (
        v_key, v_item.group_id, v_item.creator_id, 'metric', 'group_schedule_reminder',
        'group_including_sender', 'Group event reminder',
        'A shared event is coming up. Open Group Schedule for the time and details.',
        jsonb_build_object(
          'route', '/group-schedule', 'scope', 'group', 'groupId', v_item.group_id,
          'scheduleItemId', v_item.id,
          'scheduleFocusAt', floor(extract(epoch from v_item.starts_at) * 1000)::bigint::text,
          'scheduleStartsAt', floor(extract(epoch from v_item.starts_at) * 1000)::bigint::text,
          'reminderMinutes', v_item.reminder_minutes::text,
          'scheduleRevision', v_item.revision::text, 'actorId', v_item.creator_id
        ),
        v_item.starts_at + interval '15 minutes'
      ) on conflict on constraint push_dispatch_events_event_key_key do nothing
      returning push_dispatch_events.event_key into v_inserted;
      if v_inserted is not null then
        event_key := v_inserted;
        return next;
      end if;
    end if;
    update public.group_schedule_items
       set reminder_staged_key = v_key where id = v_item.id;
  end loop;
end;
$$;
revoke all on function public.stage_due_group_schedule_reminders(integer)
  from public, anon, authenticated;
grant execute on function public.stage_due_group_schedule_reminders(integer) to service_role;

-- Reuse the authenticated challenge worker solely as the durable outbox drain.
-- Its schedule-only mode never scans or settles challenges.
create or replace function public.invoke_group_schedule_reminder_worker()
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_url text;
  v_secret text;
  v_now timestamptz := clock_timestamp();
begin
  if not exists (
    select 1 from public.push_dispatch_configuration where singleton and emitters_active
  ) then return; end if;
  if not exists (
    select 1 from public.group_schedule_items item
    where item.reminder_due_at <= v_now
      and item.reminder_due_at > v_now - interval '25 hours'
      and item.starts_at > v_now - interval '15 minutes'
      and item.reminder_staged_key is distinct from public.group_schedule_reminder_key(
        item.id, item.starts_at, item.reminder_minutes
      )
      and exists (
        select 1 from public.group_members creator
        where creator.group_id = item.group_id and creator.user_id = item.creator_id
          and creator.status = 'active'
      )
  ) and not exists (
    select 1 from public.push_dispatch_events event
    where event.event_type = 'group_schedule_reminder'
      and event.dispatched_at is null and event.expires_at > v_now
  ) then return; end if;
  select decrypted_secret into v_url from vault.decrypted_secrets
   where name = 'challenge_notification_worker_url' order by created_at desc limit 1;
  select decrypted_secret into v_secret from vault.decrypted_secrets
   where name = 'challenge_notification_worker_secret' order by created_at desc limit 1;
  if coalesce(btrim(v_url), '') !~
    '^https://[a-z0-9-]+[.]supabase[.]co/functions/v1/challenge-notifications$'
    or char_length(btrim(coalesce(v_secret, ''))) not between 32 and 512
    or btrim(v_secret) ~ '[[:space:]]' then
    raise exception 'Group reminder worker configuration is missing or invalid.';
  end if;
  perform net.http_post(
    url := btrim(v_url),
    headers := jsonb_build_object('Authorization', 'Bearer ' || btrim(v_secret), 'Content-Type', 'application/json'),
    body := '{"mode":"group_schedule","limit":100}'::jsonb,
    timeout_milliseconds := 30000
  );
end;
$$;
revoke all on function public.invoke_group_schedule_reminder_worker()
  from public, anon, authenticated;
grant execute on function public.invoke_group_schedule_reminder_worker() to service_role;
select cron.unschedule(jobid) from cron.job where jobname = 'group-schedule-reminders-every-minute';
select cron.schedule('group-schedule-reminders-every-minute', '* * * * *',
  'select public.invoke_group_schedule_reminder_worker()');

notify pgrst, 'reload schema';
