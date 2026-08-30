-- Durable recipient notifications for group-feed interactions whose owner can
-- be proven from a canonical server-side identity.
-- Target ownership is resolved from server-owned rows/identities; the client
-- never chooses a notification recipient, title, route, or push audience.

alter table public.group_notification_events
  drop constraint if exists group_notification_events_event_type_check,
  drop constraint if exists group_notification_events_social_target_check;
alter table public.group_notification_events
  add constraint group_notification_events_event_type_check check (
    event_type in (
      'challenge_invitation', 'challenge_accepted',
      'challenge_all_accepted', 'challenge_standing',
      'challenge_reminder', 'challenge_result',
      'social_reaction', 'social_comment'
    )
  ),
  add constraint group_notification_events_social_target_check check (
    event_type not in ('social_reaction', 'social_comment')
    or (
      target_type is not null
      and target_id is not null
      and char_length(target_type) between 1 and 48
      and char_length(target_id) between 1 and 240
    )
  );

-- Daily-leader resolution is used only when somebody deliberately interacts
-- with that one feed card. This covering index keeps the lookup bounded and
-- avoids turning ambient status sync into extra notification work.
create index if not exists daily_metric_status_group_date_user_social_idx
  on public.daily_metric_status (group_id, local_date, user_id)
  include (metric_id, score_contribution);

-- A leader headline is derived rather than stored, so notification delivery
-- must fail closed whenever the server cannot identify one unique top member.
-- The client includes the member it rendered in the target identity below;
-- the resolver will emit only when that member still matches this result.
create or replace function public.resolve_group_social_daily_leader(
  p_group_id uuid,
  p_local_date date
)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  with member_scores as (
    select status.user_id,
           sum(
             status.score_contribution * greatest(definition.score_weight, 0)
           ) / nullif(sum(greatest(definition.score_weight, 0)), 0) as score
      from public.daily_metric_status status
      join public.metric_definitions definition
        on definition.id = status.metric_id
       and definition.group_id = status.group_id
      join public.group_members member
        on member.group_id = status.group_id
       and member.user_id = status.user_id
       and member.status = 'active'
     where status.group_id = p_group_id
       and status.local_date = p_local_date
       and coalesce(status.visibility::text, 'status') <> 'private'
       and greatest(definition.score_weight, 0) > 0
     group by status.user_id
  ), leaders as (
    select score.user_id
      from member_scores score
     where score.score > 0
       and score.score = (select max(candidate.score) from member_scores candidate)
  )
  select case
    when count(*) = 1 then (array_agg(leader.user_id))[1]
    else null::uuid
  end
    from leaders leader;
$$;

revoke all on function public.resolve_group_social_daily_leader(uuid, date)
  from public, anon, authenticated;

-- New clients identify a daily-leader target as
-- leader:<rendered-member-uuid>:<local-date>. Keep the legacy date-only form
-- readable for mixed-version rows, but it will never resolve a notification
-- recipient because it cannot prove who the viewer saw. Badge identities stay
-- valid social UI keys, but remain unsuitable notification identities until a
-- server-owned earned-badge row exists.
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
    -- Badges are presently derived on-device and have no canonical earned row.
    -- Their target id starts with a member UUID, but that client-owned value is
    -- not authorization to address a notification to that member. Reactions
    -- and comments remain valid group UI state; delivery stays silent until a
    -- server-owned badge identity can prove the recipient.
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
      -- The client attaches a member identity to a result card only when it
      -- has one unambiguous winner. Mirror that rule instead of arbitrarily
      -- notifying one person from a tied podium.
      return query
        select min(placement.user_id),
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
      select todo.creator_id, null::text, 'group to-do'::text,
             todo.created_at::date
        from public.group_todos todo
       where todo.id = v_target_uuid
         and todo.group_id = p_group_id
       limit 1;
  elsif p_target_type = 'recap_feed' then
    -- Legacy leader:<date> rows cannot prove which tied/locally-derived leader
    -- the viewer saw. Keep them readable through valid_group_social_target,
    -- but never infer a notification recipient from the date alone.
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
begin
  -- The RPC's conflict path may replay after a committed response is lost.
  -- `UPDATE OF reaction` fires even when the assigned value is unchanged, so
  -- compare row values before deriving a timestamp-based immutable event key.
  if tg_op = 'UPDATE' and old.reaction is not distinct from new.reaction then
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
    v_actor_name || ' ' || v_reaction_label || ' your feed post',
    120
  );
  v_detail := left(
    'Open the group feed to see the reaction on your ' ||
      coalesce(v_item_label, 'shared item') || '.',
    500
  );
  v_event_key := 'social-reaction:' || new.group_id::text || ':' ||
    pg_catalog.md5(new.target_type || ':' || new.target_id) || ':' ||
    new.user_id::text || ':' ||
    floor(extract(epoch from new.updated_at) * 1000000)::bigint::text;
  v_data := jsonb_build_object(
    'route', '/recapfeed',
    'scope', 'group',
    'groupId', new.group_id,
    'period', 'custom',
    'anchor', v_local_date,
    'targetType', new.target_type,
    'targetId', new.target_id,
    'feedFocusAt',
      floor(extract(epoch from new.updated_at) * 1000)::bigint::text,
    'reaction', new.reaction,
    'actorId', new.user_id
  );

  insert into public.group_notification_events (
    event_key, group_id, recipient_id, actor_id, event_type,
    challenge_id, title, detail, occurrence_date,
    target_type, target_id, reaction, created_at
  ) values (
    v_event_key, new.group_id, v_recipient_id, new.user_id,
    'social_reaction', null, v_title, v_detail, v_local_date,
    new.target_type, new.target_id, new.reaction, new.updated_at
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

drop trigger if exists group_social_reactions_emit_notification
  on public.group_social_reactions;
create trigger group_social_reactions_emit_notification
after insert or update of reaction on public.group_social_reactions
for each row execute function public.emit_group_social_reaction_notification();

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
  v_title := left(v_actor_name || ' commented on your feed post', 120);
  v_detail := left(new.content, 500);
  v_event_key := 'social-comment:' || new.id::text;
  v_data := jsonb_build_object(
    'route', '/recapfeed',
    'scope', 'group',
    'groupId', new.group_id,
    'period', 'custom',
    'anchor', v_local_date,
    'targetType', new.target_type,
    'targetId', new.target_id,
    'feedFocusAt',
      floor(extract(epoch from new.created_at) * 1000)::bigint::text,
    'commentId', new.id,
    'actorId', new.user_id
  );

  insert into public.group_notification_events (
    event_key, group_id, recipient_id, actor_id, event_type,
    challenge_id, title, detail, occurrence_date,
    target_type, target_id, reaction, created_at
  ) values (
    v_event_key, new.group_id, v_recipient_id, new.user_id,
    'social_comment', null, v_title, v_detail, v_local_date,
    new.target_type, new.target_id, null, new.created_at
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

drop trigger if exists group_social_comments_emit_notification
  on public.group_social_comments;
create trigger group_social_comments_emit_notification
after insert on public.group_social_comments
for each row execute function public.emit_group_social_comment_notification();

comment on function public.resolve_group_social_notification_target(
  uuid, text, text
) is 'Resolves a validated social target owner without trusting a client-supplied recipient.';
