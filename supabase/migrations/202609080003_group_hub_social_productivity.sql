-- Shared group productivity surfaces and canonical social targets.
-- Notes/schedule content is read through RLS and mutated only through narrow
-- revision-checked RPCs. Realtime carries payload-free invalidations on the
-- existing private workspace topic; no table is added to postgres_changes.

create table if not exists public.group_notes (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups(id) on delete cascade,
  creator_id uuid not null references public.profiles(id) on delete cascade,
  title text,
  body text not null,
  revision bigint not null default 1 check (revision > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint group_notes_title_check check (
    title is null or char_length(btrim(title)) between 1 and 160
  ),
  constraint group_notes_body_check check (
    body = btrim(body) and char_length(body) between 1 and 12000
  )
);

create index if not exists group_notes_group_updated_idx
  on public.group_notes (group_id, updated_at desc, id);

create table if not exists public.group_schedule_items (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups(id) on delete cascade,
  creator_id uuid not null references public.profiles(id) on delete cascade,
  title text not null,
  notes text,
  starts_at timestamptz not null,
  ends_at timestamptz,
  all_day boolean not null default false,
  revision bigint not null default 1 check (revision > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint group_schedule_items_title_check check (
    title = btrim(title) and char_length(title) between 1 and 160
  ),
  constraint group_schedule_items_notes_check check (
    notes is null or (
      notes = btrim(notes) and char_length(notes) between 1 and 4000
    )
  ),
  constraint group_schedule_items_range_check check (
    ends_at is null or ends_at >= starts_at
  ),
  constraint group_schedule_items_all_day_shape_check check (
    not all_day or (
      ends_at is null
      and (starts_at at time zone 'UTC')::time = time '12:00:00'
    )
  )
);

create index if not exists group_schedule_items_group_start_idx
  on public.group_schedule_items (group_id, starts_at, id);

alter table public.group_notes enable row level security;
alter table public.group_schedule_items enable row level security;

drop policy if exists group_notes_member_read on public.group_notes;
create policy group_notes_member_read
on public.group_notes for select to authenticated
using (
  public.is_group_member(group_id)
  and (
    creator_id = (select auth.uid())
    or public.habhub_message_visible_to_current_user(creator_id, null)
  )
);

drop policy if exists group_schedule_items_member_read
  on public.group_schedule_items;
create policy group_schedule_items_member_read
on public.group_schedule_items for select to authenticated
using (
  public.is_group_member(group_id)
  and (
    creator_id = (select auth.uid())
    or public.habhub_message_visible_to_current_user(creator_id, null)
  )
);

revoke all on public.group_notes from public, anon, authenticated;
revoke all on public.group_schedule_items from public, anon, authenticated;
grant select on public.group_notes to authenticated;
grant select on public.group_schedule_items to authenticated;

create or replace function public.save_group_note(
  p_note_id uuid,
  p_group_id uuid,
  p_title text,
  p_body text,
  p_expected_revision bigint
)
returns public.group_notes
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid := (select auth.uid());
  v_existing public.group_notes;
  v_saved public.group_notes;
  v_title text := nullif(btrim(p_title), '');
  v_body text := btrim(coalesce(p_body, ''));
begin
  if v_actor_id is null then
    raise exception 'Authentication required.' using errcode = '42501';
  end if;
  if p_group_id is null or not public.is_group_member(p_group_id) then
    raise exception 'Active group membership required.' using errcode = '42501';
  end if;
  if not public.habhub_has_current_terms_acceptance() then
    raise exception 'Accept the current Terms before sharing a group note.'
      using errcode = '42501';
  end if;
  if char_length(v_body) not between 1 and 12000 then
    raise exception 'A group note must contain 1 to 12000 characters.'
      using errcode = '22023';
  end if;
  if v_title is not null and char_length(v_title) > 160 then
    raise exception 'A group note title can contain at most 160 characters.'
      using errcode = '22023';
  end if;
  if not public.habhub_message_content_allowed(
    concat_ws(' ', v_title, v_body)
  ) then
    raise exception 'This note cannot be shared as written.' using errcode = '22023';
  end if;

  if p_note_id is null then
    if p_expected_revision is not null then
      raise exception 'A new group note cannot have an expected revision.'
        using errcode = '22023';
    end if;
    insert into public.group_notes (
      group_id, creator_id, title, body
    ) values (
      p_group_id, v_actor_id, v_title, v_body
    ) returning * into v_saved;
    return v_saved;
  end if;

  select * into v_existing
    from public.group_notes note
   where note.id = p_note_id
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
    raise exception 'Group note not found.' using errcode = 'P0002';
  end if;
  if v_existing.creator_id <> v_actor_id
     and not public.is_group_admin(v_existing.group_id) then
    raise exception 'Only the creator or a group administrator can edit this note.'
      using errcode = '42501';
  end if;
  if p_expected_revision is null
     or p_expected_revision <> v_existing.revision then
    raise exception 'This group note changed on another device. Refresh and try again.'
      using errcode = '40001';
  end if;

  update public.group_notes
     set title = v_title,
         body = v_body,
         revision = revision + 1,
         updated_at = clock_timestamp()
   where id = p_note_id
   returning * into v_saved;
  return v_saved;
end;
$$;

create or replace function public.delete_group_note(
  p_note_id uuid,
  p_expected_revision bigint
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid := (select auth.uid());
  v_existing public.group_notes;
begin
  if v_actor_id is null then
    raise exception 'Authentication required.' using errcode = '42501';
  end if;
  select * into v_existing
    from public.group_notes note
   where note.id = p_note_id
   for update;
  if not found or not public.is_group_member(v_existing.group_id)
     or (
       v_existing.creator_id <> v_actor_id
       and not public.habhub_message_visible_to_current_user(
         v_existing.creator_id,
         null
       )
     ) then return; end if;
  if v_existing.creator_id <> v_actor_id
     and not public.is_group_admin(v_existing.group_id) then
    raise exception 'Only the creator or a group administrator can delete this note.'
      using errcode = '42501';
  end if;
  if p_expected_revision is null
     or p_expected_revision <> v_existing.revision then
    raise exception 'This group note changed on another device. Refresh and try again.'
      using errcode = '40001';
  end if;

  -- Social rows use polymorphic targets, so no database FK can cascade them.
  -- Remove the complete note discussion and any now-dead notification links
  -- in the same transaction before deleting the note itself.
  delete from public.group_social_comments comment
   where comment.group_id = v_existing.group_id
     and comment.target_type = 'group_note'
     and comment.target_id = p_note_id::text;
  delete from public.group_social_reactions reaction
   where reaction.group_id = v_existing.group_id
     and reaction.target_type = 'group_note'
     and reaction.target_id = p_note_id::text;
  delete from public.group_notification_events event
   where event.group_id = v_existing.group_id
     and event.target_type = 'group_note'
     and event.target_id = p_note_id::text;
  delete from public.push_dispatch_events event
   where event.group_id = v_existing.group_id
     and (
       event.data ->> 'noteId' = p_note_id::text
       or (
         event.data ->> 'targetType' = 'group_note'
         and event.data ->> 'targetId' = p_note_id::text
       )
     );
  delete from public.group_notes where id = p_note_id;
end;
$$;

create or replace function public.save_group_schedule_item(
  p_item_id uuid,
  p_group_id uuid,
  p_title text,
  p_notes text,
  p_starts_at timestamptz,
  p_ends_at timestamptz,
  p_all_day boolean,
  p_expected_revision bigint
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

  if p_item_id is null then
    if p_expected_revision is not null then
      raise exception 'A new group event cannot have an expected revision.'
        using errcode = '22023';
    end if;
    insert into public.group_schedule_items (
      group_id, creator_id, title, notes, starts_at, ends_at, all_day
    ) values (
      p_group_id, v_actor_id, v_title, v_notes, v_starts_at, v_ends_at,
      v_all_day
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
         revision = revision + 1,
         updated_at = clock_timestamp()
   where id = p_item_id
   returning * into v_saved;
  return v_saved;
end;
$$;

create or replace function public.delete_group_schedule_item(
  p_item_id uuid,
  p_expected_revision bigint
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid := (select auth.uid());
  v_existing public.group_schedule_items;
begin
  if v_actor_id is null then
    raise exception 'Authentication required.' using errcode = '42501';
  end if;
  select * into v_existing
    from public.group_schedule_items item
   where item.id = p_item_id
   for update;
  if not found or not public.is_group_member(v_existing.group_id)
     or (
       v_existing.creator_id <> v_actor_id
       and not public.habhub_message_visible_to_current_user(
         v_existing.creator_id,
         null
       )
     ) then return; end if;
  if v_existing.creator_id <> v_actor_id
     and not public.is_group_admin(v_existing.group_id) then
    raise exception 'Only the creator or a group administrator can delete this event.'
      using errcode = '42501';
  end if;
  if p_expected_revision is null
     or p_expected_revision <> v_existing.revision then
    raise exception 'This group event changed on another device. Refresh and try again.'
      using errcode = '40001';
  end if;
  delete from public.group_notification_events event
   where event.group_id = v_existing.group_id
     and event.target_type = 'group_schedule'
     and event.target_id = p_item_id::text;
  delete from public.push_dispatch_events event
   where event.group_id = v_existing.group_id
     and event.data ->> 'scheduleItemId' = p_item_id::text;
  delete from public.group_schedule_items where id = p_item_id;
end;
$$;

revoke all on function public.save_group_note(uuid, uuid, text, text, bigint)
  from public, anon;
revoke all on function public.delete_group_note(uuid, bigint)
  from public, anon;
revoke all on function public.save_group_schedule_item(
  uuid, uuid, text, text, timestamptz, timestamptz, boolean, bigint
) from public, anon;
revoke all on function public.delete_group_schedule_item(uuid, bigint)
  from public, anon;
grant execute on function public.save_group_note(uuid, uuid, text, text, bigint)
  to authenticated;
grant execute on function public.delete_group_note(uuid, bigint)
  to authenticated;
grant execute on function public.save_group_schedule_item(
  uuid, uuid, text, text, timestamptz, timestamptz, boolean, bigint
) to authenticated;
grant execute on function public.delete_group_schedule_item(uuid, bigint)
  to authenticated;

create or replace function public.broadcast_group_hub_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_group_id uuid := case when tg_op = 'DELETE'
    then old.group_id else new.group_id end;
begin
  begin
    perform realtime.send(
      jsonb_build_object('entity', tg_table_name, 'operation', tg_op),
      'group_hub_updated',
      'group:' || v_group_id::text || ':workspace',
      true
    );
  exception when others then
    raise warning 'HabHub group workspace broadcast failed for %', tg_table_name;
  end;
  if tg_op = 'DELETE' then return old; else return new; end if;
end;
$$;

revoke all on function public.broadcast_group_hub_change()
  from public, anon, authenticated;

drop trigger if exists group_notes_compact_broadcast on public.group_notes;
create trigger group_notes_compact_broadcast
after insert or update or delete on public.group_notes
for each row execute function public.broadcast_group_hub_change();

drop trigger if exists group_schedule_items_compact_broadcast
  on public.group_schedule_items;
create trigger group_schedule_items_compact_broadcast
after insert or update or delete on public.group_schedule_items
for each row execute function public.broadcast_group_hub_change();

-- Extend the existing canonical engagement schema instead of creating note-
-- or chat-specific reaction tables. The target validator below remains the
-- single privacy boundary for reads and mutations.
alter table public.group_social_reactions
  drop constraint if exists group_social_reactions_target_type_check;
alter table public.group_social_reactions
  add constraint group_social_reactions_target_type_check check (
    target_type in (
      'recap_feed', 'group_recap', 'metric_entry', 'photo_update', 'badge',
      'group_challenge', 'group_todo', 'group_note', 'chat_message'
    )
  );

alter table public.group_social_comments
  drop constraint if exists group_social_comments_target_type_check;
alter table public.group_social_comments
  add constraint group_social_comments_target_type_check check (
    target_type in (
      'recap_feed', 'group_recap', 'metric_entry', 'photo_update', 'badge',
      'group_challenge', 'group_todo', 'group_note', 'chat_message'
    )
  );

alter table public.group_social_reactions
  drop constraint if exists group_social_reactions_source_surface_check;
alter table public.group_social_reactions
  add constraint group_social_reactions_source_surface_check check (
    source_surface in ('feed', 'leaderboard_log', 'group_notes', 'chat')
  );

alter table public.group_social_comments
  drop constraint if exists group_social_comments_source_surface_check;
alter table public.group_social_comments
  add constraint group_social_comments_source_surface_check check (
    source_surface in ('feed', 'leaderboard_log', 'group_notes', 'chat')
  );

alter table public.group_notification_events
  drop constraint if exists group_notification_events_event_type_check;
alter table public.group_notification_events
  add constraint group_notification_events_event_type_check check (
    event_type in (
      'challenge_invitation', 'challenge_accepted',
      'challenge_all_accepted', 'challenge_standing',
      'challenge_reminder', 'challenge_result',
      'social_reaction', 'social_comment',
      'group_todo_completed', 'group_todo_all_completed',
      'group_note_created', 'group_note_updated',
      'group_schedule_created', 'group_schedule_updated'
    )
  );

alter table public.group_notification_events
  drop constraint if exists group_notification_events_interaction_surface_check;
alter table public.group_notification_events
  add constraint group_notification_events_interaction_surface_check check (
    interaction_surface is null
    or interaction_surface in ('feed', 'leaderboard_log', 'group_notes', 'chat')
  );

-- Notification copy for social actions, collaborative tasks, notes and plans
-- is user-authored metadata. Keep it behind the same block boundary as the
-- underlying content while preserving explicitly joined public challenges.
drop policy if exists group_notification_events_recipient_read
  on public.group_notification_events;
create policy group_notification_events_recipient_read
on public.group_notification_events
for select
to authenticated
using (
  recipient_id = (select auth.uid())
  and (
    public.is_group_member(group_id)
    or exists (
      select 1
        from public.group_challenges challenge
       where challenge.id = group_notification_events.challenge_id
         and challenge.audience = 'public'
         and (select auth.uid()) = any(challenge.participant_ids)
    )
  )
  and (
    event_type not in (
      'social_reaction', 'social_comment',
      'group_todo_completed', 'group_todo_all_completed',
      'group_note_created', 'group_note_updated',
      'group_schedule_created', 'group_schedule_updated'
    )
    or not public.habhub_users_blocked_either_way(
      actor_id,
      (select auth.uid())
    )
  )
);

-- One revision produces one canonical workspace event. Recipient feed rows are
-- private and actor-excluded; a single durable group outbox row fans push out
-- after applying each recipient's preference and block relationship.
create or replace function public.emit_group_workspace_notification()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid := (select auth.uid());
  v_actor_name text;
  v_actor_timezone text := 'UTC';
  v_event_type text;
  v_event_key text;
  v_item_title text;
  v_title text;
  v_detail text;
  v_target_type text;
  v_data jsonb;
  v_occurrence_date date;
begin
  if v_actor_id is null or not public.is_group_member(new.group_id) then
    return new;
  end if;
  select coalesce(nullif(btrim(profile.display_name), ''), 'A friend'),
         coalesce(nullif(profile.timezone, ''), 'UTC')
    into v_actor_name, v_actor_timezone
    from public.profiles profile
   where profile.id = v_actor_id;
  v_actor_name := coalesce(v_actor_name, 'A friend');
  v_item_title := coalesce(nullif(btrim(new.title), ''), 'Shared item');

  if tg_table_name = 'group_notes' then
    v_event_type := case when tg_op = 'INSERT'
      then 'group_note_created' else 'group_note_updated' end;
    v_event_key := 'group-note:' || new.id::text || ':r' || new.revision::text;
    v_target_type := 'group_note';
    v_title := left(
      v_actor_name || case when tg_op = 'INSERT'
        then ' added a group note' else ' updated a group note' end,
      120
    );
    v_detail := left(v_item_title || ' · Open Group Notes to read it.', 500);
    v_data := jsonb_build_object(
      'route', '/group-notes',
      'scope', 'group',
      'groupId', new.group_id,
      'noteId', new.id,
      'noteFocusAt', floor(extract(epoch from new.updated_at) * 1000)::bigint::text,
      'actorId', v_actor_id
    );
  elsif tg_table_name = 'group_schedule_items' then
    v_event_type := case when tg_op = 'INSERT'
      then 'group_schedule_created' else 'group_schedule_updated' end;
    v_event_key := 'group-schedule:' || new.id::text || ':r' || new.revision::text;
    v_target_type := 'group_schedule';
    v_title := left(
      v_actor_name || case when tg_op = 'INSERT'
        then ' added a group event' else ' updated a group event' end,
      120
    );
    v_detail := left(v_item_title || ' · Open Group Schedule for details.', 500);
    v_occurrence_date := case when new.all_day
      then (new.starts_at at time zone 'UTC')::date
      else (new.starts_at at time zone v_actor_timezone)::date
    end;
    v_data := jsonb_build_object(
      'route', '/group-schedule',
      'scope', 'group',
      'groupId', new.group_id,
      'scheduleItemId', new.id,
      'scheduleFocusAt', floor(extract(epoch from new.updated_at) * 1000)::bigint::text,
      'actorId', v_actor_id
    );
  else
    return new;
  end if;

  if not exists (
    select 1
      from public.group_members member
     where member.group_id = new.group_id
       and member.status = 'active'
       and member.user_id <> v_actor_id
       and not public.habhub_users_blocked_either_way(
         v_actor_id,
         member.user_id
       )
  ) then
    return new;
  end if;

  insert into public.group_notification_events (
    event_key, group_id, recipient_id, actor_id, event_type,
    challenge_id, title, detail, occurrence_date,
    target_type, target_id, reaction, interaction_surface, created_at
  )
  select
    v_event_key, new.group_id, member.user_id, v_actor_id, v_event_type,
    null, v_title, v_detail, v_occurrence_date,
    v_target_type, new.id::text, null, null, new.updated_at
  from public.group_members member
  where member.group_id = new.group_id
    and member.status = 'active'
    and member.user_id <> v_actor_id
    and not public.habhub_users_blocked_either_way(
      v_actor_id,
      member.user_id
    )
  on conflict (recipient_id, event_key) do nothing;

  insert into public.push_dispatch_events (
    event_key, group_id, dispatcher_id, category, event_type,
    audience, recipient_id, metric_slug, title, body, data, expires_at
  ) values (
    v_event_key, new.group_id, v_actor_id, 'metric', v_event_type,
    'group', null, null, v_title, v_detail, v_data,
    now() + interval '24 hours'
  ) on conflict (event_key) do nothing;
  return new;
end;
$$;

revoke all on function public.emit_group_workspace_notification()
  from public, anon, authenticated;

drop trigger if exists group_notes_emit_workspace_notification
  on public.group_notes;
create trigger group_notes_emit_workspace_notification
after insert or update on public.group_notes
for each row execute function public.emit_group_workspace_notification();

drop trigger if exists group_schedule_items_emit_workspace_notification
  on public.group_schedule_items;
create trigger group_schedule_items_emit_workspace_notification
after insert or update on public.group_schedule_items
for each row execute function public.emit_group_workspace_notification();

create or replace function public.valid_group_social_target(
  p_group_id uuid,
  p_target_type text,
  p_target_id text
)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_target_uuid uuid;
  v_occurrence_date date;
  v_event text;
  v_client_id text;
  v_story_id text;
  v_group_created_at timestamptz;
begin
  if not public.is_group_member(p_group_id)
     or p_target_id is null
     or char_length(p_target_id) < 1
     or (p_target_type = 'metric_entry' and char_length(p_target_id) > 400)
     or (p_target_type <> 'metric_entry' and char_length(p_target_id) > 240) then
    return false;
  end if;

  if p_target_type = 'metric_entry' then
    return public.resolve_group_social_metric_entry_id(
      p_group_id,
      p_target_id
    ) is not null;
  elsif p_target_type = 'photo_update' then
    return exists (
      select 1
        from public.photo_updates photo
        join public.group_members owner_membership
          on owner_membership.group_id = p_group_id
         and owner_membership.user_id = photo.owner_user_id
         and owner_membership.status = 'active'
       where photo.group_id = p_group_id
         and photo.client_generated_id = p_target_id
         and photo.visibility = 'group'
    );
  elsif p_target_type = 'group_todo' then
    begin
      v_target_uuid := p_target_id::uuid;
    exception when invalid_text_representation then
      return false;
    end;
    return exists (
      select 1 from public.group_todos todo
       where todo.id = v_target_uuid and todo.group_id = p_group_id
    );
  elsif p_target_type = 'group_note' then
    begin
      v_target_uuid := p_target_id::uuid;
    exception when invalid_text_representation then
      return false;
    end;
    return exists (
      select 1 from public.group_notes note
       where note.id = v_target_uuid
         and note.group_id = p_group_id
         and (
           note.creator_id = (select auth.uid())
           or public.habhub_message_visible_to_current_user(
             note.creator_id,
             null
           )
         )
    );
  elsif p_target_type = 'chat_message' then
    begin
      v_target_uuid := split_part(p_target_id, ':', 1)::uuid;
      v_client_id := substring(
        p_target_id from char_length(split_part(p_target_id, ':', 1)) + 2
      );
    exception when others then
      return false;
    end;
    if v_client_id is null or v_client_id = ''
       or p_target_id <> (v_target_uuid::text || ':' || v_client_id) then
      return false;
    end if;
    return exists (
      select 1 from public.messages message
       where message.group_id = p_group_id
         and message.sender_id = v_target_uuid
         and coalesce(message.client_generated_id, message.id::text) = v_client_id
         and (
           message.recipient_id is null
           or message.sender_id = (select auth.uid())
           or message.recipient_id = (select auth.uid())
         )
         and public.habhub_message_visible_to_current_user(
           message.sender_id,
           message.recipient_id
         )
    );
  elsif p_target_type = 'group_recap' then
    -- Aggregate recap stories have no source row or owner. Bind engagement to
    -- one renderer version, rolling period, a date inside the group's real
    -- lifetime, and either a fixed aggregate story or a group-owned metric.
    -- Active membership above is the sole audience; this identity
    -- intentionally cannot name a notification recipient.
    if p_target_id !~
      '^v1:week:[0-9]{4}-[0-9]{2}-[0-9]{2}:group-[a-z0-9][a-z0-9_-]{0,79}$' then
      return false;
    end if;
    begin
      v_occurrence_date := split_part(p_target_id, ':', 3)::date;
    exception when others then
      return false;
    end;
    v_story_id := split_part(p_target_id, ':', 4);
    if p_target_id <> (
      'v1:week:' || v_occurrence_date::text || ':' || v_story_id
    ) then
      return false;
    end if;

    select group_row.created_at
      into v_group_created_at
      from public.groups group_row
     where group_row.id = p_group_id;
    -- A group recap identity is shared by every member, so its validity must
    -- not change with the viewer's timezone. UTC - 1/+ 1 is the exact safe
    -- envelope for every real local calendar date from UTC-12 through UTC+14.
    if not found
       or v_occurrence_date < (v_group_created_at at time zone 'UTC')::date - 1
       or v_occurrence_date > (now() at time zone 'UTC')::date + 1 then
      return false;
    end if;

    if v_story_id in (
      'group-champion',
      'group-distance',
      'group-comeback',
      'group-finish'
    ) then
      return true;
    end if;

    return exists (
      select 1
        from public.metric_definitions definition
       where definition.group_id = p_group_id
         and definition.slug = substring(v_story_id from 7)
    );
  elsif p_target_type = 'recap_feed' then
    if p_target_id like 'leader:____-__-__' then
      begin
        v_occurrence_date := substring(p_target_id from 8)::date;
      exception when others then
        return false;
      end;
      return p_target_id = 'leader:' || v_occurrence_date::text and exists (
        select 1 from public.daily_metric_status status
         where status.group_id = p_group_id
           and status.local_date = v_occurrence_date
           and coalesce(status.visibility::text, 'status') <> 'private'
      );
    end if;
    begin
      v_target_uuid := split_part(p_target_id, ':', 2)::uuid;
      v_occurrence_date := split_part(p_target_id, ':', 3)::date;
    exception when others then
      return false;
    end;
    return p_target_id = (
      'leader:' || v_target_uuid::text || ':' || v_occurrence_date::text
    ) and exists (
      select 1
        from public.group_members member
        join public.daily_metric_status status
          on status.group_id = member.group_id
         and status.user_id = member.user_id
         and status.local_date = v_occurrence_date
         and coalesce(status.visibility::text, 'status') <> 'private'
       where member.group_id = p_group_id
         and member.user_id = v_target_uuid
         and member.status = 'active'
    );
  elsif p_target_type = 'badge' then
    begin
      v_target_uuid := split_part(p_target_id, ':', 1)::uuid;
      v_occurrence_date := right(p_target_id, 10)::date;
    exception when others then
      return false;
    end;
    return right(p_target_id, 11) = ':' || v_occurrence_date::text
       and exists (
         select 1 from public.group_members member
          where member.group_id = p_group_id
            and member.user_id = v_target_uuid
            and member.status = 'active'
       );
  elsif p_target_type = 'group_challenge' then
    begin
      v_target_uuid := split_part(p_target_id, ':', 1)::uuid;
      v_occurrence_date := split_part(p_target_id, ':', 2)::date;
      v_event := split_part(p_target_id, ':', 3);
    exception when others then
      return false;
    end;
    if p_target_id <> (
         v_target_uuid::text || ':' || v_occurrence_date::text || ':' || v_event
       )
       or v_event not in ('started', 'result') then
      return false;
    end if;
    return exists (
      select 1
        from public.group_challenges challenge
       where challenge.id = v_target_uuid
         and challenge.group_id = p_group_id
         and challenge.deleted_at is null
         and (
           (
             (challenge.recurrence is null
               or coalesce(challenge.recurrence ->> 'mode', 'once') = 'once')
             and v_occurrence_date = challenge.local_date
           )
           or (
             challenge.recurrence is not null
             and coalesce(challenge.recurrence ->> 'mode', 'once') <> 'once'
             and public.group_challenge_occurs_on(
               challenge.recurrence,
               challenge.local_date,
               v_occurrence_date
             )
           )
         )
         and (
           v_event = 'started'
           or exists (
             select 1 from public.group_notification_events result_event
              where result_event.challenge_id = challenge.id
                and result_event.occurrence_date = v_occurrence_date
                and result_event.event_type = 'challenge_result'
           )
         )
    );
  end if;
  return false;
end;
$$;

revoke all on function public.valid_group_social_target(uuid, text, text)
  from public, anon;
grant execute on function public.valid_group_social_target(uuid, text, text)
  to authenticated;

create or replace function public.resolve_group_social_notification_target(
  p_group_id uuid,
  p_target_type text,
  p_target_id text
)
returns table (
  recipient_id uuid,
  metric_slug text,
  item_label text,
  occurrence_date date
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_target_uuid uuid;
  v_target_date date;
  v_target_event text;
  v_client_id text;
begin
  if not public.valid_group_social_target(
    p_group_id,
    p_target_type,
    p_target_id
  ) then
    return;
  end if;

  if p_target_type = 'metric_entry' then
    return query
      select entry.user_id, definition.slug, definition.name, entry.local_date
        from public.metric_entries entry
        join public.metric_definitions definition
          on definition.id = entry.metric_id
       where definition.group_id = p_group_id
         and entry.id = public.resolve_group_social_metric_entry_id(
           p_group_id,
           p_target_id
         )
       limit 1;
  elsif p_target_type = 'photo_update' then
    return query
      select photo.owner_user_id, 'photos'::text, 'photo'::text,
             photo.local_date
        from public.photo_updates photo
       where photo.group_id = p_group_id
         and photo.client_generated_id = p_target_id
         and photo.visibility = 'group'
       order by photo.created_at desc
       limit 1;
  elsif p_target_type = 'badge' then
    return;
  elsif p_target_type = 'group_challenge' then
    begin
      v_target_uuid := split_part(p_target_id, ':', 1)::uuid;
      v_target_date := split_part(p_target_id, ':', 2)::date;
      v_target_event := split_part(p_target_id, ':', 3);
    exception when others then
      return;
    end;
    if v_target_event = 'result' then
      return query
        select (array_agg(placement.user_id))[1],
               challenge.metric_slug,
               coalesce(nullif(btrim(challenge.title), ''), 'challenge'),
               case
                 when challenge.recurrence is null
                      or coalesce(challenge.recurrence ->> 'mode', 'once') = 'once'
                   then challenge.end_date
                 else v_target_date
               end
          from public.group_challenges challenge
          join public.group_challenge_result_placements placement
            on placement.challenge_id = challenge.id
           and placement.occurrence_date = v_target_date
           and placement.winner = true
         where challenge.id = v_target_uuid
           and challenge.group_id = p_group_id
           and challenge.deleted_at is null
         group by challenge.metric_slug, challenge.title,
                  challenge.recurrence, challenge.end_date
        having count(*) = 1;
    else
      return query
        select challenge.creator_id,
               challenge.metric_slug,
               coalesce(nullif(btrim(challenge.title), ''), 'challenge'),
               v_target_date
          from public.group_challenges challenge
         where challenge.id = v_target_uuid
           and challenge.group_id = p_group_id
           and challenge.deleted_at is null
         limit 1;
    end if;
  elsif p_target_type = 'group_todo' then
    begin
      v_target_uuid := p_target_id::uuid;
    exception when others then
      return;
    end;
    return query
      select todo.creator_id, null::text,
             coalesce(nullif(btrim(todo.title), ''), 'group to-do'),
             todo.created_at::date
        from public.group_todos todo
       where todo.id = v_target_uuid
         and todo.group_id = p_group_id
       limit 1;
  elsif p_target_type = 'group_note' then
    begin
      v_target_uuid := p_target_id::uuid;
    exception when others then
      return;
    end;
    return query
      select note.creator_id, null::text,
             coalesce(nullif(btrim(note.title), ''), 'group note'),
             note.updated_at::date
        from public.group_notes note
       where note.id = v_target_uuid
         and note.group_id = p_group_id
       limit 1;
  elsif p_target_type = 'chat_message' then
    begin
      v_target_uuid := split_part(p_target_id, ':', 1)::uuid;
      v_client_id := substring(
        p_target_id from char_length(split_part(p_target_id, ':', 1)) + 2
      );
    exception when others then
      return;
    end;
    return query
      select message.sender_id, null::text, 'chat message'::text,
             message.created_at::date
        from public.messages message
       where message.group_id = p_group_id
         and message.sender_id = v_target_uuid
         and coalesce(message.client_generated_id, message.id::text) = v_client_id
       limit 1;
  elsif p_target_type = 'group_recap' then
    -- Aggregate stories are group-owned, not user-owned. Reactions and
    -- comments persist and broadcast, but they deliberately emit no direct
    -- recipient notification.
    return;
  elsif p_target_type = 'recap_feed' then
    if p_target_id like 'leader:____-__-__' then return; end if;
    begin
      v_target_uuid := split_part(p_target_id, ':', 2)::uuid;
      v_target_date := split_part(p_target_id, ':', 3)::date;
    exception when others then
      return;
    end;
    if p_target_id <> (
         'leader:' || v_target_uuid::text || ':' || v_target_date::text
       )
       or public.resolve_group_social_daily_leader(
         p_group_id,
         v_target_date
       ) is distinct from v_target_uuid then
      return;
    end if;
    return query
      select v_target_uuid, null::text, 'daily-leader update'::text,
             v_target_date;
  end if;
end;
$$;

revoke all on function public.resolve_group_social_notification_target(
  uuid, text, text
) from public, anon, authenticated;

create or replace function public.set_group_social_reaction(
  p_group_id uuid,
  p_target_type text,
  p_target_id text,
  p_reaction text,
  p_surface text
)
returns public.group_social_reactions
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid := auth.uid();
  v_canonical_target_id text := p_target_id;
  v_metric_entry_id uuid;
  v_row public.group_social_reactions%rowtype;
begin
  if v_actor_id is null then
    raise exception 'Sign in to react to a shared item.' using errcode = '42501';
  end if;
  if p_group_id is null or p_target_type is null or p_target_id is null then
    raise exception 'That social item is invalid.' using errcode = '22023';
  end if;
  if p_surface not in ('feed', 'leaderboard_log', 'group_notes', 'chat') then
    raise exception 'That interaction surface is invalid.' using errcode = '22023';
  end if;
  if not public.is_group_member(p_group_id) then
    raise exception 'You are not an active member of this group.' using errcode = '42501';
  end if;
  if p_target_type not in (
    'recap_feed', 'group_recap', 'metric_entry', 'photo_update', 'badge',
    'group_challenge', 'group_todo', 'group_note', 'chat_message'
  ) or not (
    char_length(p_target_id) between 1 and
      (case when p_target_type = 'metric_entry' then 400 else 240 end)
  ) then
    raise exception 'That social item is invalid.' using errcode = '22023';
  end if;

  if p_target_type = 'metric_entry' then
    v_metric_entry_id := public.resolve_group_social_metric_entry_id(
      p_group_id,
      p_target_id
    );
    if v_metric_entry_id is not null then
      v_canonical_target_id := v_metric_entry_id::text;
    end if;
  end if;

  if p_reaction is null then
    delete from public.group_social_reactions reaction
     where reaction.group_id = p_group_id
       and reaction.target_type = p_target_type
       and reaction.target_id in (p_target_id, v_canonical_target_id)
       and reaction.user_id = v_actor_id
    returning * into v_row;
    return v_row;
  end if;
  if p_target_type = 'metric_entry' and v_metric_entry_id is null then
    raise exception 'That shared item is no longer available.' using errcode = '42501';
  end if;
  if p_target_type <> 'metric_entry' and not public.valid_group_social_target(
    p_group_id,
    p_target_type,
    p_target_id
  ) then
    raise exception 'That shared item is no longer available.' using errcode = '42501';
  end if;
  if p_reaction not in ('heart', 'thumbs_up', 'thumbs_down', 'cheer') then
    raise exception 'That reaction is not supported.' using errcode = '22023';
  end if;
  if p_target_type = 'chat_message'
     and p_reaction not in ('thumbs_up', 'thumbs_down') then
    raise exception 'Chat messages support like and dislike reactions only.'
      using errcode = '22023';
  end if;

  insert into public.group_social_reactions (
    group_id, target_type, target_id, user_id, reaction, source_surface
  ) values (
    p_group_id, p_target_type, v_canonical_target_id, v_actor_id,
    p_reaction, p_surface
  )
  on conflict (group_id, target_type, target_id, user_id)
  do update set reaction = excluded.reaction,
                source_surface = excluded.source_surface
  returning * into v_row;
  return v_row;
end;
$$;

revoke all on function public.set_group_social_reaction(
  uuid, text, text, text, text
) from public, anon;
grant execute on function public.set_group_social_reaction(
  uuid, text, text, text, text
) to authenticated;

create or replace function public.add_group_social_comment_v2(
  p_group_id uuid,
  p_target_type text,
  p_target_id text,
  p_content text,
  p_surface text
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_actor_id uuid := auth.uid();
  v_row public.group_social_comments%rowtype;
  v_event_key text;
begin
  if v_actor_id is null then
    raise exception 'Sign in to comment on a shared item.'
      using errcode = '42501';
  end if;
  if p_surface not in ('feed', 'leaderboard_log', 'group_notes', 'chat') then
    raise exception 'That interaction surface is invalid.'
      using errcode = '22023';
  end if;
  if not (char_length(btrim(coalesce(p_content, ''))) between 1 and 1000) then
    raise exception 'Comments must be between 1 and 1000 characters.'
      using errcode = '22023';
  end if;

  insert into public.group_social_comments (
    group_id, target_type, target_id, user_id, content, source_surface
  ) values (
    p_group_id, p_target_type, p_target_id, v_actor_id,
    btrim(p_content), p_surface
  ) returning * into v_row;

  v_event_key := 'social-comment:' || v_row.id::text;
  if not exists (
    select 1
      from public.push_dispatch_events event
     where event.event_key = v_event_key
       and event.dispatcher_id = v_actor_id
  ) then
    v_event_key := null;
  end if;
  return jsonb_build_object(
    'comment', to_jsonb(v_row),
    'push_event_key', v_event_key
  );
end;
$$;

revoke all on function public.add_group_social_comment_v2(
  uuid, text, text, text, text
) from public, anon;
grant execute on function public.add_group_social_comment_v2(
  uuid, text, text, text, text
) to authenticated;

create or replace function public.emit_group_social_reaction_notification()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_recipient_id uuid;
  v_actor_name text;
  v_metric_slug text;
  v_item_label text;
  v_local_date date;
  v_reaction_label text;
  v_event_key text;
  v_title text;
  v_detail text;
  v_data jsonb;
  v_client_id text;
  v_message_recipient_id uuid;
  v_surface text := case
    when new.target_type = 'group_note' then 'group_notes'
    when new.target_type = 'chat_message' then 'chat'
    when new.source_surface = 'leaderboard_log'
         and new.target_type = 'metric_entry' then 'leaderboard_log'
    else 'feed'
  end;
begin
  if tg_op = 'UPDATE'
     and old.reaction is not distinct from new.reaction
     and old.source_surface is not distinct from new.source_surface then
    return new;
  end if;
  select target.recipient_id, target.metric_slug, target.item_label,
         target.occurrence_date
    into v_recipient_id, v_metric_slug, v_item_label, v_local_date
    from public.resolve_group_social_notification_target(
      new.group_id,
      new.target_type,
      new.target_id
    ) target
   limit 1;
  if v_recipient_id is null
     or v_recipient_id = new.user_id
     or not exists (
       select 1 from public.group_members member
        where member.group_id = new.group_id
          and member.user_id = v_recipient_id
          and member.status = 'active'
     ) then
    return new;
  end if;

  select coalesce(nullif(btrim(profile.display_name), ''), 'A friend')
    into v_actor_name
    from public.profiles profile
   where profile.id = new.user_id;
  v_actor_name := coalesce(v_actor_name, 'A friend');
  v_reaction_label := case new.reaction
    when 'heart' then 'loved'
    when 'thumbs_up' then 'liked'
    when 'thumbs_down' then 'disliked'
    when 'cheer' then 'cheered'
    else 'reacted to'
  end;
  v_title := left(
    v_actor_name || ' ' || v_reaction_label || ' your ' || case v_surface
      when 'leaderboard_log' then 'log'
      when 'group_notes' then 'group note'
      when 'chat' then 'message'
      else 'feed post'
    end,
    120
  );
  v_detail := left(
    case v_surface
      when 'leaderboard_log' then
        'Open the individual log to see the reaction.'
      when 'group_notes' then
        'Open Group Notes to see the reaction on ' ||
          coalesce(v_item_label, 'your note') || '.'
      when 'chat' then
        'Open Chat to see the reaction.'
      else
        'Open the group feed to see the reaction on your ' ||
          coalesce(v_item_label, 'shared item') || '.'
    end,
    500
  );
  v_event_key := 'social-reaction:' || new.group_id::text || ':' ||
    pg_catalog.md5(new.target_type || ':' || new.target_id) || ':' ||
    new.user_id::text || ':' ||
    floor(extract(epoch from new.updated_at) * 1000000)::bigint::text;

  if new.target_type = 'chat_message' then
    v_client_id := substring(
      new.target_id from char_length(split_part(new.target_id, ':', 1)) + 2
    );
    select message.recipient_id
      into v_message_recipient_id
      from public.messages message
     where message.group_id = new.group_id
       and message.sender_id = v_recipient_id
       and coalesce(message.client_generated_id, message.id::text) = v_client_id
     limit 1;
  end if;

  v_data := case v_surface
    when 'leaderboard_log' then
      jsonb_build_object(
        'route', '/leaderboard-detail',
        'scope', 'group',
        'groupId', new.group_id,
        'period', 'custom',
        'anchor', v_local_date,
        'metrics', v_metric_slug,
        'memberId', v_recipient_id,
        'entryId', new.target_id,
        'logFocusAt', floor(extract(epoch from new.updated_at) * 1000)::bigint::text,
        'reaction', new.reaction,
        'actorId', new.user_id
      )
    when 'group_notes' then
      jsonb_build_object(
        'route', '/group-notes',
        'scope', 'group',
        'groupId', new.group_id,
        'noteId', new.target_id,
        'reaction', new.reaction,
        'actorId', new.user_id
      )
    when 'chat' then
      jsonb_strip_nulls(jsonb_build_object(
        'route', '/chat',
        'groupId', new.group_id,
        'conversationType', case when v_message_recipient_id is null
          then 'group' else 'direct' end,
        'senderId', case when v_message_recipient_id is null
          then null else new.user_id end,
        'messageTargetId', new.target_id,
        'reaction', new.reaction,
        'actorId', new.user_id
      ))
    else
      jsonb_build_object(
        'route', '/recapfeed',
        'scope', 'group',
        'groupId', new.group_id,
        'period', 'custom',
        'anchor', v_local_date,
        'targetType', new.target_type,
        'targetId', new.target_id,
        'feedFocusAt', floor(extract(epoch from new.updated_at) * 1000)::bigint::text,
        'reaction', new.reaction,
        'actorId', new.user_id
      )
  end;

  insert into public.group_notification_events (
    event_key, group_id, recipient_id, actor_id, event_type,
    challenge_id, title, detail, occurrence_date,
    target_type, target_id, reaction, interaction_surface, created_at
  ) values (
    v_event_key, new.group_id, v_recipient_id, new.user_id,
    'social_reaction', null, v_title, v_detail, v_local_date,
    new.target_type, new.target_id, new.reaction, v_surface, new.updated_at
  ) on conflict (recipient_id, event_key) do nothing;

  insert into public.push_dispatch_events (
    event_key, group_id, dispatcher_id, category, event_type,
    audience, recipient_id, metric_slug, title, body, data, expires_at
  ) values (
    v_event_key, new.group_id, new.user_id, 'metric', 'social_reaction',
    'user', v_recipient_id, v_metric_slug, v_title, v_detail, v_data,
    now() + interval '24 hours'
  ) on conflict (event_key) do nothing;
  return new;
end;
$$;

revoke all on function public.emit_group_social_reaction_notification()
  from public, anon, authenticated;

create or replace function public.emit_group_social_comment_notification()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_recipient_id uuid;
  v_actor_name text;
  v_metric_slug text;
  v_item_label text;
  v_local_date date;
  v_event_key text;
  v_title text;
  v_detail text;
  v_data jsonb;
  v_client_id text;
  v_message_recipient_id uuid;
  v_surface text := case
    when new.target_type = 'group_note' then 'group_notes'
    when new.target_type = 'chat_message' then 'chat'
    when new.source_surface = 'leaderboard_log'
         and new.target_type = 'metric_entry' then 'leaderboard_log'
    else 'feed'
  end;
begin
  select target.recipient_id, target.metric_slug, target.item_label,
         target.occurrence_date
    into v_recipient_id, v_metric_slug, v_item_label, v_local_date
    from public.resolve_group_social_notification_target(
      new.group_id,
      new.target_type,
      new.target_id
    ) target
   limit 1;
  if v_recipient_id is null
     or v_recipient_id = new.user_id
     or not exists (
       select 1 from public.group_members member
        where member.group_id = new.group_id
          and member.user_id = v_recipient_id
          and member.status = 'active'
     ) then
    return new;
  end if;

  select coalesce(nullif(btrim(profile.display_name), ''), 'A friend')
    into v_actor_name
    from public.profiles profile
   where profile.id = new.user_id;
  v_actor_name := coalesce(v_actor_name, 'A friend');
  v_title := left(
    v_actor_name || ' commented on your ' || case v_surface
      when 'leaderboard_log' then 'log'
      when 'group_notes' then 'group note'
      when 'chat' then 'message'
      else 'feed post'
    end,
    120
  );
  v_detail := left(new.content, 500);
  v_event_key := 'social-comment:' || new.id::text;

  if new.target_type = 'chat_message' then
    v_client_id := substring(
      new.target_id from char_length(split_part(new.target_id, ':', 1)) + 2
    );
    select message.recipient_id
      into v_message_recipient_id
      from public.messages message
     where message.group_id = new.group_id
       and message.sender_id = v_recipient_id
       and coalesce(message.client_generated_id, message.id::text) = v_client_id
     limit 1;
  end if;

  v_data := case v_surface
    when 'leaderboard_log' then
      jsonb_build_object(
        'route', '/leaderboard-detail',
        'scope', 'group',
        'groupId', new.group_id,
        'period', 'custom',
        'anchor', v_local_date,
        'metrics', v_metric_slug,
        'memberId', v_recipient_id,
        'entryId', new.target_id,
        'logFocusAt', floor(extract(epoch from new.created_at) * 1000)::bigint::text,
        'commentId', new.id,
        'actorId', new.user_id
      )
    when 'group_notes' then
      jsonb_build_object(
        'route', '/group-notes',
        'scope', 'group',
        'groupId', new.group_id,
        'noteId', new.target_id,
        'commentId', new.id,
        'actorId', new.user_id
      )
    when 'chat' then
      jsonb_strip_nulls(jsonb_build_object(
        'route', '/chat',
        'groupId', new.group_id,
        'conversationType', case when v_message_recipient_id is null
          then 'group' else 'direct' end,
        'senderId', case when v_message_recipient_id is null
          then null else new.user_id end,
        'messageTargetId', new.target_id,
        'commentId', new.id,
        'actorId', new.user_id
      ))
    else
      jsonb_build_object(
        'route', '/recapfeed',
        'scope', 'group',
        'groupId', new.group_id,
        'period', 'custom',
        'anchor', v_local_date,
        'targetType', new.target_type,
        'targetId', new.target_id,
        'feedFocusAt', floor(extract(epoch from new.created_at) * 1000)::bigint::text,
        'commentId', new.id,
        'actorId', new.user_id
      )
  end;

  insert into public.group_notification_events (
    event_key, group_id, recipient_id, actor_id, event_type,
    challenge_id, title, detail, occurrence_date,
    target_type, target_id, reaction, interaction_surface, created_at
  ) values (
    v_event_key, new.group_id, v_recipient_id, new.user_id,
    'social_comment', null, v_title, v_detail, v_local_date,
    new.target_type, new.target_id, null, v_surface, new.created_at
  ) on conflict (recipient_id, event_key) do nothing;

  insert into public.push_dispatch_events (
    event_key, group_id, dispatcher_id, category, event_type,
    audience, recipient_id, metric_slug, title, body, data, expires_at
  ) values (
    v_event_key, new.group_id, new.user_id, 'metric', 'social_comment',
    'user', v_recipient_id, v_metric_slug, v_title, v_detail, v_data,
    now() + interval '24 hours'
  ) on conflict (event_key) do nothing;
  return new;
end;
$$;

revoke all on function public.emit_group_social_comment_notification()
  from public, anon, authenticated;

-- Recreate the reaction trigger explicitly because surface-only changes also
-- change the recipient's destination. Comment trigger remains INSERT-only.
drop trigger if exists group_social_reactions_emit_notification
  on public.group_social_reactions;
create trigger group_social_reactions_emit_notification
after insert or update of reaction, source_surface
on public.group_social_reactions
for each row execute function public.emit_group_social_reaction_notification();

-- Group task completion events are derived transactionally from the canonical
-- completion write. Each recipient gets one stable key per actor/task/local
-- occurrence, so retries and a same-day uncheck/recheck cannot spam the group.
create or replace function public.emit_group_todo_completion_event(
  p_group_id uuid,
  p_todo_id uuid,
  p_actor_id uuid,
  p_completed_at timestamptz,
  p_all_complete boolean,
  p_shared boolean,
  p_occurrence_date date
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_name text;
  v_todo_title text;
  v_event_type text := case when p_all_complete or p_shared
    then 'group_todo_all_completed' else 'group_todo_completed' end;
  v_event_key text;
  v_title text;
  v_detail text;
  v_recipient record;
begin
  if p_group_id is null or p_todo_id is null or p_actor_id is null
     or p_completed_at is null or p_occurrence_date is null then
    return;
  end if;
  if not exists (
    select 1 from public.group_members actor
     where actor.group_id = p_group_id
       and actor.user_id = p_actor_id
       and actor.status = 'active'
  ) then
    return;
  end if;
  select coalesce(nullif(btrim(profile.display_name), ''), 'A group member')
    into v_actor_name
    from public.profiles profile
   where profile.id = p_actor_id;
  select coalesce(nullif(btrim(todo.title), ''), 'Group task')
    into v_todo_title
    from public.group_todos todo
   where todo.id = p_todo_id
     and todo.group_id = p_group_id;
  if v_todo_title is null then return; end if;
  v_actor_name := coalesce(v_actor_name, 'A group member');
  v_title := left(case
    when p_shared then v_actor_name || ' completed a group task'
    when p_all_complete then 'Everyone completed ' || v_todo_title
    else v_actor_name || ' completed ' || v_todo_title
  end, 120);
  v_detail := left(case
    when p_shared then v_todo_title || ' is complete for the group.'
    when p_all_complete then
      v_actor_name || ' finished the final individual completion.'
    else 'Open Group tasks to see who has completed it.'
  end, 500);

  for v_recipient in
    select member.user_id
      from public.group_members member
     where member.group_id = p_group_id
       and member.status = 'active'
       and member.user_id <> p_actor_id
  loop
    v_event_key := 'group-todo:' || pg_catalog.md5(
      p_group_id::text || ':' || p_todo_id::text || ':' ||
      p_occurrence_date::text || ':' || p_actor_id::text || ':' || v_event_type
    ) || ':' || v_recipient.user_id::text;

    insert into public.group_notification_events (
      event_key, group_id, recipient_id, actor_id, event_type,
      challenge_id, title, detail, occurrence_date,
      target_type, target_id, reaction, interaction_surface, created_at
    ) values (
      v_event_key, p_group_id, v_recipient.user_id, p_actor_id, v_event_type,
      null, v_title, v_detail, p_occurrence_date,
      'group_todo', p_todo_id::text, null, null, p_completed_at
    ) on conflict (recipient_id, event_key) do nothing;

    insert into public.push_dispatch_events (
      event_key, group_id, dispatcher_id, category, event_type,
      audience, recipient_id, metric_slug, title, body, data, expires_at
    ) values (
      v_event_key, p_group_id, p_actor_id, 'metric', v_event_type,
      'user', v_recipient.user_id, null, v_title, v_detail,
      jsonb_build_object(
        'route', '/group',
        'scope', 'group',
        'groupId', p_group_id,
        'focusGroupTodo', p_todo_id,
        'todoFocusAt', floor(extract(epoch from p_completed_at) * 1000)::bigint::text,
        'notificationKind', v_event_type
      ),
      now() + interval '24 hours'
    ) on conflict (event_key) do nothing;
  end loop;
end;
$$;

revoke all on function public.emit_group_todo_completion_event(
  uuid, uuid, uuid, timestamptz, boolean, boolean, date
) from public, anon, authenticated;

create or replace function public.notify_group_todo_individual_completion()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_active_members integer;
  v_completed_members integer;
  v_timezone text;
  v_occurrence_date date;
begin
  if tg_op = 'UPDATE'
     and old.completed_at is not distinct from new.completed_at then
    return new;
  end if;
  select coalesce(valid_timezone.name, 'UTC')
    into v_timezone
    from public.group_todos todo
    join public.profiles creator on creator.id = todo.creator_id
    left join pg_catalog.pg_timezone_names valid_timezone
      on valid_timezone.name = creator.timezone
   where todo.id = new.todo_id
     and todo.group_id = new.group_id;
  if not found then return new; end if;
  v_timezone := coalesce(v_timezone, 'UTC');
  v_occurrence_date := (new.completed_at at time zone v_timezone)::date;

  select count(*)::integer
    into v_active_members
    from public.group_members member
   where member.group_id = new.group_id
     and member.status = 'active';
  select count(*)::integer
    into v_completed_members
    from public.group_todo_completions completion
    join public.group_members member
      on member.group_id = completion.group_id
     and member.user_id = completion.user_id
     and member.status = 'active'
   where completion.group_id = new.group_id
     and completion.todo_id = new.todo_id
     and (completion.completed_at at time zone v_timezone)::date =
       v_occurrence_date
     -- Multi-row maintenance/import statements may make later completions
     -- visible before every AFTER ROW trigger runs. Count only the state that
     -- existed by this completion's canonical timestamp so just the final
     -- actor emits the all-complete event.
     and completion.completed_at <= new.completed_at;

  perform public.emit_group_todo_completion_event(
    new.group_id,
    new.todo_id,
    new.user_id,
    new.completed_at,
    v_active_members > 0 and v_completed_members >= v_active_members,
    false,
    v_occurrence_date
  );
  return new;
end;
$$;

revoke all on function public.notify_group_todo_individual_completion()
  from public, anon, authenticated;

drop trigger if exists group_todo_completions_emit_notification
  on public.group_todo_completions;
create trigger group_todo_completions_emit_notification
after insert or update of completed_at on public.group_todo_completions
for each row execute function public.notify_group_todo_individual_completion();

create or replace function public.notify_group_todo_shared_completion()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_timezone text;
  v_occurrence_date date;
begin
  if new.completion_mode <> 'shared'
     or new.shared_completed_at is null
     or new.shared_completed_by is null
     or old.shared_completed_at is not null then
    return new;
  end if;
  select coalesce(valid_timezone.name, 'UTC')
    into v_timezone
    from public.profiles creator
    left join pg_catalog.pg_timezone_names valid_timezone
      on valid_timezone.name = creator.timezone
   where creator.id = new.creator_id;
  v_timezone := coalesce(v_timezone, 'UTC');
  v_occurrence_date := (new.shared_completed_at at time zone v_timezone)::date;
  perform public.emit_group_todo_completion_event(
    new.group_id,
    new.id,
    new.shared_completed_by,
    new.shared_completed_at,
    true,
    true,
    v_occurrence_date
  );
  return new;
end;
$$;

revoke all on function public.notify_group_todo_shared_completion()
  from public, anon, authenticated;

drop trigger if exists group_todos_emit_shared_completion_notification
  on public.group_todos;
create trigger group_todos_emit_shared_completion_notification
after update of shared_completed_at, shared_completed_by on public.group_todos
for each row execute function public.notify_group_todo_shared_completion();

-- Polymorphic social targets cannot use foreign keys. Remove their rows when
-- the canonical content disappears so stale engagement never accumulates.
create or replace function public.cleanup_group_note_social()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.group_social_comments comment
   where comment.group_id = old.group_id
     and comment.target_type = 'group_note'
     and comment.target_id = old.id::text;
  delete from public.group_social_reactions reaction
   where reaction.group_id = old.group_id
     and reaction.target_type = 'group_note'
     and reaction.target_id = old.id::text;
  return old;
end;
$$;

revoke all on function public.cleanup_group_note_social()
  from public, anon, authenticated;
drop trigger if exists group_notes_cleanup_social on public.group_notes;
create trigger group_notes_cleanup_social
after delete on public.group_notes
for each row execute function public.cleanup_group_note_social();

create or replace function public.cleanup_chat_message_social()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_target_id text;
begin
  if old.sender_id is null then return old; end if;
  v_target_id := old.sender_id::text || ':' ||
    coalesce(old.client_generated_id, old.id::text);
  delete from public.group_social_comments comment
   where comment.group_id = old.group_id
     and comment.target_type = 'chat_message'
     and comment.target_id = v_target_id;
  delete from public.group_social_reactions reaction
   where reaction.group_id = old.group_id
     and reaction.target_type = 'chat_message'
     and reaction.target_id = v_target_id;
  return old;
end;
$$;

revoke all on function public.cleanup_chat_message_social()
  from public, anon, authenticated;
drop trigger if exists messages_cleanup_social on public.messages;
create trigger messages_cleanup_social
after delete on public.messages
for each row execute function public.cleanup_chat_message_social();

comment on table public.group_notes is
  'Private-group collaborative notes with revision-checked member mutations.';
comment on table public.group_schedule_items is
  'Private-group shared schedule items with revision-checked member mutations.';

notify pgrst, 'reload schema';
