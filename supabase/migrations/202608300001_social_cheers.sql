-- Add a positive Cheer reaction without weakening target authorization. The
-- existing RPC remains the only client mutation path and still resolves every
-- shared-log target through the active group/privacy fence.

alter table public.group_social_reactions
  drop constraint if exists group_social_reactions_reaction_check;
alter table public.group_social_reactions
  add constraint group_social_reactions_reaction_check check (
    reaction in ('heart', 'thumbs_up', 'thumbs_down', 'cheer')
  );

alter table public.group_notification_events
  drop constraint if exists group_notification_events_reaction_check;
alter table public.group_notification_events
  add constraint group_notification_events_reaction_check check (
    reaction is null
    or reaction in ('heart', 'thumbs_up', 'thumbs_down', 'cheer')
  );

create or replace function public.set_group_social_reaction(
  p_group_id uuid,
  p_target_type text,
  p_target_id text,
  p_reaction text
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
    group_id, target_type, target_id, user_id, reaction
  ) values (
    p_group_id, p_target_type, v_canonical_target_id, v_actor_id, p_reaction
  )
  on conflict (group_id, target_type, target_id, user_id)
  do update set reaction = excluded.reaction
  returning * into v_row;
  return v_row;
end;
$$;

revoke all on function public.set_group_social_reaction(uuid, text, text, text)
  from public, anon;
grant execute on function public.set_group_social_reaction(uuid, text, text, text)
  to authenticated;

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
  v_metric_name text;
  v_local_date date;
  v_reaction_label text;
  v_event_key text;
  v_title text;
  v_detail text;
  v_data jsonb;
begin
  if not public.is_group_member(new.group_id) then return new; end if;

  if new.target_type = 'metric_entry' then
    select entry.user_id, definition.slug, definition.name, entry.local_date
      into v_recipient_id, v_metric_slug, v_metric_name, v_local_date
      from public.metric_entries entry
      join public.metric_definitions definition on definition.id = entry.metric_id
     where definition.group_id = new.group_id
       and entry.id = public.resolve_group_social_metric_entry_id(
         new.group_id,
         new.target_id
       )
     limit 1;
  elsif new.target_type = 'photo_update' then
    select photo.owner_user_id, 'photos', 'photo', photo.local_date
      into v_recipient_id, v_metric_slug, v_metric_name, v_local_date
      from public.photo_updates photo
     where photo.group_id = new.group_id
       and photo.client_generated_id = new.target_id
       and photo.visibility = 'group'
     order by photo.created_at desc
     limit 1;
  else
    return new;
  end if;
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
    into v_actor_name from public.profiles profile where profile.id = new.user_id;
  v_actor_name := coalesce(v_actor_name, 'A friend');
  v_reaction_label := case new.reaction
    when 'heart' then 'loved'
    when 'thumbs_up' then 'liked'
    when 'cheer' then 'cheered'
    else 'reacted to'
  end;
  v_title := left(v_actor_name || ' ' || v_reaction_label || ' your shared log', 120);
  v_detail := left(
    case when v_metric_name = 'photo'
      then 'Open the group feed to see the reaction on your photo.'
      else 'Open the shared ' || coalesce(v_metric_name, 'tracker') || ' log.'
    end,
    500
  );
  v_event_key := 'social:' || new.group_id::text || ':' ||
    pg_catalog.md5(new.target_type || ':' || new.target_id) || ':' ||
    new.user_id::text || ':' ||
    floor(extract(epoch from new.updated_at) * 1000000)::bigint::text;
  v_data := case when new.target_type = 'metric_entry' then
    jsonb_build_object(
      'route', '/leaderboard-detail',
      'groupId', new.group_id,
      'period', 'custom',
      'anchor', v_local_date,
      'metricId', v_metric_slug,
      'entryId', new.target_id,
      'targetType', new.target_type,
      'targetId', new.target_id,
      'reaction', new.reaction,
      'actorId', new.user_id
    )
  else
    jsonb_build_object(
      'route', '/(tabs)/recapfeed',
      'scope', 'group',
      'groupId', new.group_id,
      'highlight', 'photo:' || new.target_id,
      'targetType', new.target_type,
      'targetId', new.target_id,
      'reaction', new.reaction,
      'actorId', new.user_id
    )
  end;

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
