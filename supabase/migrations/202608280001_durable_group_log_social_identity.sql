-- Shared-log engagement needs a server-owned identity. Client-generated ids
-- are unique only within one account, can exceed the social target length, and
-- may be visible locally just before their relational outbox row is published.
-- Resolve those legacy ids at the definer boundary, but persist the canonical
-- metric_entries UUID. Target content remains protected by the existing entry
-- RLS policy; this helper is not callable by clients.

create or replace function public.resolve_group_social_metric_entry_id(
  p_group_id uuid,
  p_target_id text
)
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_target_uuid uuid;
  v_entry_id uuid;
  v_match_count integer;
begin
  if p_group_id is null
     or p_target_id is null
     or char_length(p_target_id) not between 1 and 400 then
    return null;
  end if;
  begin
    v_target_uuid := p_target_id::uuid;
  exception when invalid_text_representation then
    v_target_uuid := null;
  end;

  -- UUID-shaped client ids are common, so first try the canonical relational
  -- UUID, then independently try the legacy client id. Never guess when an
  -- old id collides across owners; only an unambiguous shared row is upgraded.
  if v_target_uuid is not null then
    select entry.id
      into v_entry_id
      from public.metric_entries entry
      join public.metric_definitions definition
        on definition.id = entry.metric_id
      join public.group_members owner_membership
        on owner_membership.group_id = p_group_id
       and owner_membership.user_id = entry.user_id
       and owner_membership.status = 'active'
     where definition.group_id = p_group_id
       and definition.archived_at is null
       and entry.visibility = 'group'
       and entry.id = v_target_uuid
       and not exists (
         select 1
           from public.metric_privacy_cache_fences fence
          where fence.group_id = p_group_id
            and fence.user_id = entry.user_id
            and fence.metric_id = entry.metric_id
            and (
              entry.account_revision is null
              or entry.account_revision <= fence.revision
            )
       )
     limit 1;
    if v_entry_id is not null then return v_entry_id; end if;
  end if;

  select count(*), (array_agg(candidate.id order by candidate.updated_at desc, candidate.id))[1]
    into v_match_count, v_entry_id
    from (
      select entry.id, entry.updated_at
        from public.metric_entries entry
        join public.metric_definitions definition
          on definition.id = entry.metric_id
        join public.group_members owner_membership
          on owner_membership.group_id = p_group_id
         and owner_membership.user_id = entry.user_id
         and owner_membership.status = 'active'
       where definition.group_id = p_group_id
         and definition.archived_at is null
         and entry.visibility = 'group'
         and entry.client_generated_id = p_target_id
         and not exists (
           select 1
             from public.metric_privacy_cache_fences fence
            where fence.group_id = p_group_id
              and fence.user_id = entry.user_id
              and fence.metric_id = entry.metric_id
              and (
                entry.account_revision is null
                or entry.account_revision <= fence.revision
              )
         )
       order by entry.updated_at desc, entry.id
       limit 2
    ) candidate;
  return case when v_match_count = 1 then v_entry_id else null end;
end;
$$;

revoke all on function public.resolve_group_social_metric_entry_id(uuid, text)
  from public, anon, authenticated;

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
    if p_target_id not like 'leader:____-__-__' then return false; end if;
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

  -- Removing the actor's own stale reaction does not expose target content and
  -- remains useful after the source log is deleted or made private.
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
  if p_reaction not in ('heart', 'thumbs_up', 'thumbs_down') then
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

-- Preserve existing reactions/comments while moving any unambiguous legacy
-- client id to the server UUID used by current clients.
insert into public.group_social_reactions (
  group_id, target_type, target_id, user_id, reaction, created_at, updated_at
)
select reaction.group_id, reaction.target_type, resolved.id::text,
       reaction.user_id, reaction.reaction, reaction.created_at, reaction.updated_at
  from public.group_social_reactions reaction
  join lateral (
    select public.resolve_group_social_metric_entry_id(
      reaction.group_id,
      reaction.target_id
    ) as id
  ) resolved on resolved.id is not null
 where reaction.target_type = 'metric_entry'
   and reaction.target_id <> resolved.id::text
on conflict (group_id, target_type, target_id, user_id) do update
  set reaction = case
        when excluded.updated_at >= public.group_social_reactions.updated_at
          then excluded.reaction
        else public.group_social_reactions.reaction
      end,
      created_at = least(
        public.group_social_reactions.created_at,
        excluded.created_at
      ),
      updated_at = greatest(
        public.group_social_reactions.updated_at,
        excluded.updated_at
      );

delete from public.group_social_reactions reaction
 where reaction.target_type = 'metric_entry'
   and public.resolve_group_social_metric_entry_id(
     reaction.group_id,
     reaction.target_id
   ) is distinct from null
   and reaction.target_id <> public.resolve_group_social_metric_entry_id(
     reaction.group_id,
     reaction.target_id
   )::text;

update public.group_social_comments comment
   set target_id = public.resolve_group_social_metric_entry_id(
     comment.group_id,
     comment.target_id
   )::text
 where comment.target_type = 'metric_entry'
   and public.resolve_group_social_metric_entry_id(
     comment.group_id,
     comment.target_id
   ) is not null
   and comment.target_id <> public.resolve_group_social_metric_entry_id(
     comment.group_id,
     comment.target_id
   )::text;

-- Keep comments and mixed-version direct reaction writes on the same stable
-- identity as the RPC. The trigger runs before RLS WITH CHECK; an unresolved
-- or private target remains unchanged and is still rejected by that policy.
create or replace function public.canonicalize_group_social_metric_target()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_entry_id uuid;
begin
  if new.target_type <> 'metric_entry' then return new; end if;
  v_entry_id := public.resolve_group_social_metric_entry_id(
    new.group_id,
    new.target_id
  );
  if v_entry_id is not null then new.target_id := v_entry_id::text; end if;
  return new;
end;
$$;

revoke all on function public.canonicalize_group_social_metric_target()
  from public, anon, authenticated;

drop trigger if exists group_social_reactions_canonicalize_metric_target
  on public.group_social_reactions;
create trigger group_social_reactions_canonicalize_metric_target
before insert or update of group_id, target_type, target_id
on public.group_social_reactions
for each row execute function public.canonicalize_group_social_metric_target();

drop trigger if exists group_social_comments_canonicalize_metric_target
  on public.group_social_comments;
create trigger group_social_comments_canonicalize_metric_target
before insert or update of group_id, target_type, target_id
on public.group_social_comments
for each row execute function public.canonicalize_group_social_metric_target();

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
      'route', '/recap',
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

comment on function public.set_group_social_reaction(uuid, text, text, text) is
  'Privacy-validates a group reaction and stores a canonical server-owned shared-log identity.';
