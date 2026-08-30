-- Route social mutations through one server-owned boundary. Direct PostgREST
-- upserts can evaluate INSERT, UPDATE and SELECT policies in one statement;
-- legacy/cached clients were surfacing that as a generic RLS failure even for
-- an authorized shared entry. The RPC derives the actor from auth.uid(),
-- repeats the target privacy check, and never accepts a caller-supplied actor.

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
     or char_length(p_target_id) not between 1 and 240 then
    return false;
  end if;

  if p_target_type = 'metric_entry' then
    return exists (
      select 1
        from public.metric_entries entry
        join public.metric_definitions definition on definition.id = entry.metric_id
       where definition.group_id = p_group_id
         and entry.client_generated_id = p_target_id
         and entry.visibility = 'group'
    );
  elsif p_target_type = 'photo_update' then
    return exists (
      select 1 from public.photo_updates photo
       where photo.group_id = p_group_id
         and photo.client_generated_id = p_target_id
         and photo.visibility = 'group'
    );
  elsif p_target_type = 'group_todo' then
    begin
      v_target_uuid := p_target_id::uuid;
    exception when others then
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
  ) or char_length(p_target_id) not between 1 and 240 then
    raise exception 'That social item is invalid.' using errcode = '22023';
  end if;
  -- Removing the actor's own stale reaction does not expose target content and
  -- remains useful after the source log is deleted or made private.
  if p_reaction is null then
    delete from public.group_social_reactions reaction
     where reaction.group_id = p_group_id
       and reaction.target_type = p_target_type
       and reaction.target_id = p_target_id
       and reaction.user_id = v_actor_id
    returning * into v_row;
    return v_row;
  end if;
  if not public.valid_group_social_target(
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
    p_group_id, p_target_type, p_target_id, v_actor_id, p_reaction
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

comment on function public.set_group_social_reaction(uuid, text, text, text) is
  'Privacy-validates and toggles one authenticated group reaction without trusting a client actor id.';
