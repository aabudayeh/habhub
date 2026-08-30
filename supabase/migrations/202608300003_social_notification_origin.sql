-- Preserve the UI surface where a social interaction happened. Reactions and
-- comments still share one canonical target and one authorization boundary;
-- the surface is used only to return the recipient to the representation that
-- the actor actually used (feed card versus Leaderboard individual log).

alter table public.group_social_reactions
  add column if not exists source_surface text not null default 'feed';
alter table public.group_social_reactions
  drop constraint if exists group_social_reactions_source_surface_check;
alter table public.group_social_reactions
  add constraint group_social_reactions_source_surface_check check (
    source_surface in ('feed', 'leaderboard_log')
  );

alter table public.group_social_comments
  add column if not exists source_surface text not null default 'feed';
alter table public.group_social_comments
  drop constraint if exists group_social_comments_source_surface_check;
alter table public.group_social_comments
  add constraint group_social_comments_source_surface_check check (
    source_surface in ('feed', 'leaderboard_log')
  );

alter table public.group_notification_events
  add column if not exists interaction_surface text;
alter table public.group_notification_events
  drop constraint if exists group_notification_events_interaction_surface_check;
alter table public.group_notification_events
  add constraint group_notification_events_interaction_surface_check check (
    interaction_surface is null
    or interaction_surface in ('feed', 'leaderboard_log')
  );

-- Keep the four-argument RPC for installed clients. Current clients call this
-- overload so the server, rather than a notification-tap heuristic, owns the
-- destination surface.
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
  if p_surface not in ('feed', 'leaderboard_log') then
    raise exception 'That interaction surface is invalid.' using errcode = '22023';
  end if;
  if not public.is_group_member(p_group_id) then
    raise exception 'You are not an active member of this group.' using errcode = '42501';
  end if;
  if p_target_type not in (
    'recap_feed', 'metric_entry', 'photo_update',
    'badge', 'group_challenge', 'group_todo'
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
  v_surface text := case
    when new.source_surface = 'leaderboard_log'
         and new.target_type = 'metric_entry'
      then 'leaderboard_log'
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
    v_actor_name || ' ' || v_reaction_label || ' your ' ||
      case when v_surface = 'leaderboard_log' then 'log' else 'feed post' end,
    120
  );
  v_detail := left(
    case when v_surface = 'leaderboard_log'
      then 'Open the individual log to see the reaction.'
      else 'Open the group feed to see the reaction on your ' ||
        coalesce(v_item_label, 'shared item') || '.'
    end,
    500
  );
  v_event_key := 'social-reaction:' || new.group_id::text || ':' ||
    pg_catalog.md5(new.target_type || ':' || new.target_id) || ':' ||
    new.user_id::text || ':' ||
    floor(extract(epoch from new.updated_at) * 1000000)::bigint::text;
  v_data := case when v_surface = 'leaderboard_log' then
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
  v_surface text := case
    when new.source_surface = 'leaderboard_log'
         and new.target_type = 'metric_entry'
      then 'leaderboard_log'
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
    v_actor_name || ' commented on your ' ||
      case when v_surface = 'leaderboard_log' then 'log' else 'feed post' end,
    120
  );
  v_detail := left(new.content, 500);
  v_event_key := 'social-comment:' || new.id::text;
  v_data := case when v_surface = 'leaderboard_log' then
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

notify pgrst, 'reload schema';
