-- Active challenge discovery remains separate from the participant-scoped
-- table policy. That keeps historical Leaderboard reads and their 200-row
-- bound unchanged while letting active group members find live/upcoming rows.
create or replace function public.group_challenge_join_deadline(
  p_challenge public.group_challenges
)
returns date
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_recurrence_end date;
begin
  if coalesce(p_challenge.recurrence ->> 'endDate', '')
       ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then
    begin
      v_recurrence_end := (p_challenge.recurrence ->> 'endDate')::date;
    exception
      when datetime_field_overflow or invalid_datetime_format then
      -- A corrupt legacy recurrence must fail closed for this row, not abort
      -- active-challenge discovery for the whole group.
      v_recurrence_end := null;
    end;
  end if;
  return coalesce(
    v_recurrence_end,
    p_challenge.end_date,
    p_challenge.local_date
  );
end;
$$;

revoke all on function public.group_challenge_join_deadline(
  public.group_challenges
) from public, anon, authenticated;

drop function if exists public.list_active_group_challenges(uuid);
create function public.list_active_group_challenges(
  p_group_id uuid
)
returns table (
  id uuid,
  group_id uuid,
  creator_id uuid,
  metric_slug text,
  title text,
  target_value numeric,
  local_date date,
  end_date date,
  recurrence jsonb,
  participant_count integer,
  accepted_count integer,
  viewer_participation text,
  eligible_to_join boolean,
  is_full boolean,
  created_at timestamptz,
  updated_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_local_today date;
begin
  if v_user_id is null then
    raise exception 'Authentication required.' using errcode = '42501';
  end if;
  select (statement_timestamp() at time zone coalesce(valid_timezone.name, 'UTC'))::date
    into v_local_today
    from public.profiles profile
    left join pg_catalog.pg_timezone_names valid_timezone
      on valid_timezone.name = profile.timezone
   where profile.id = v_user_id;
  v_local_today := coalesce(v_local_today, current_date);
  if p_group_id is null or not public.is_group_member(p_group_id) then
    raise exception 'Active group membership required.' using errcode = '42501';
  end if;

  return query
  select challenge.id,
         challenge.group_id,
         challenge.creator_id,
         challenge.metric_slug,
         challenge.title,
         challenge.target_value,
         challenge.local_date,
         challenge.end_date,
         challenge.recurrence,
         cardinality(challenge.participant_ids) as participant_count,
         cardinality(challenge.accepted_participant_ids) as accepted_count,
         case
           when v_user_id = challenge.creator_id then 'creator'
           when v_user_id = any(challenge.accepted_participant_ids) then 'accepted'
           when v_user_id = any(challenge.declined_participant_ids) then 'declined'
           when v_user_id = any(challenge.participant_ids) then 'invited'
           else 'not_invited'
         end as viewer_participation,
         (
           v_user_id <> challenge.creator_id
           and not (v_user_id = any(challenge.accepted_participant_ids))
           and (
             v_user_id = any(challenge.participant_ids)
             or cardinality(challenge.participant_ids) < 50
           )
         ) as eligible_to_join,
         cardinality(challenge.participant_ids) >= 50 as is_full,
         challenge.created_at,
         challenge.updated_at
    from public.group_challenges challenge
   where challenge.group_id = p_group_id
     and challenge.deleted_at is null
     and public.group_challenge_join_deadline(challenge) >= v_local_today
   order by
     case when challenge.local_date <= v_local_today then 0 else 1 end,
     challenge.local_date,
     challenge.created_at desc
   limit 100;
end;
$$;

comment on function public.list_active_group_challenges(uuid) is
  'Bounded live/upcoming challenge metadata, counts, and caller state for active members of one group.';

revoke all on function public.list_active_group_challenges(uuid)
  from public, anon, authenticated;
grant execute on function public.list_active_group_challenges(uuid)
  to authenticated;

-- Reuse the existing invitation response mutation for one-tap self-join. A
-- non-invited caller may only add their own authenticated UUID, must still be
-- an active group member, and cannot bypass the existing 50-person bound.
create or replace function public.respond_group_challenge(
  p_challenge_id uuid,
  p_accept boolean
)
returns public.group_challenges
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_challenge public.group_challenges;
  v_local_today date;
  v_join_deadline date;
  v_was_participant boolean;
  v_participants uuid[];
  v_accepted uuid[];
  v_declined uuid[];
begin
  if v_user_id is null then
    raise exception 'Authentication required.' using errcode = '42501';
  end if;
  select (statement_timestamp() at time zone coalesce(valid_timezone.name, 'UTC'))::date
    into v_local_today
    from public.profiles profile
    left join pg_catalog.pg_timezone_names valid_timezone
      on valid_timezone.name = profile.timezone
   where profile.id = v_user_id;
  v_local_today := coalesce(v_local_today, current_date);

  select * into v_challenge
    from public.group_challenges challenge
   where challenge.id = p_challenge_id
     and challenge.deleted_at is null
   for update;
  if not found then
    raise exception 'Challenge not found.' using errcode = 'P0002';
  end if;
  -- Hold the active membership row through the challenge update. A concurrent
  -- removal/status change must settle first instead of passing a stale check.
  perform 1
    from public.group_members member
   where member.group_id = v_challenge.group_id
     and member.user_id = v_user_id
     and member.status = 'active'
   for update;
  if not found then
    raise exception 'Active group membership required.' using errcode = '42501';
  end if;
  if v_user_id = v_challenge.creator_id then
    return v_challenge;
  end if;
  if p_accept is null then
    raise exception 'Choose whether to accept or decline.' using errcode = '22023';
  end if;

  v_join_deadline := public.group_challenge_join_deadline(v_challenge);
  if v_join_deadline < v_local_today then
    raise exception 'This challenge has finished.' using errcode = '22023';
  end if;

  v_was_participant := v_user_id = any(v_challenge.participant_ids);
  if p_accept then
    if not v_was_participant
       and cardinality(v_challenge.participant_ids) >= 50 then
      raise exception 'This challenge already has 50 participants.'
        using errcode = '22023';
    end if;

    select coalesce(
             array_agg(distinct candidate order by candidate),
             array[]::uuid[]
           )
      into v_participants
      from unnest(v_challenge.participant_ids || array[v_user_id])
        joined(candidate);
    select coalesce(
             array_agg(distinct candidate order by candidate),
             array[]::uuid[]
           )
      into v_accepted
      from unnest(v_challenge.accepted_participant_ids || array[v_user_id])
        accepted(candidate);
    v_declined := array_remove(
      v_challenge.declined_participant_ids,
      v_user_id
    );

    update public.group_challenges
       set participant_ids = v_participants,
           accepted_participant_ids = v_accepted,
           declined_participant_ids = v_declined
     where id = p_challenge_id
     returning * into v_challenge;
  else
    if not v_was_participant then
      raise exception 'An active invitation is required to decline.'
        using errcode = '42501';
    end if;

    select coalesce(
             array_agg(distinct candidate order by candidate),
             array[]::uuid[]
           )
      into v_declined
      from unnest(v_challenge.declined_participant_ids || array[v_user_id])
        declined(candidate);
    v_accepted := array_remove(
      v_challenge.accepted_participant_ids,
      v_user_id
    );

    update public.group_challenges
       set declined_participant_ids = v_declined,
           accepted_participant_ids = v_accepted
     where id = p_challenge_id
     returning * into v_challenge;
  end if;

  return v_challenge;
end;
$$;

comment on function public.respond_group_challenge(uuid, boolean) is
  'Accepts/declines an invitation or lets an active group member self-join a non-finished challenge.';

revoke all on function public.respond_group_challenge(uuid, boolean)
  from public, anon, authenticated;
grant execute on function public.respond_group_challenge(uuid, boolean)
  to authenticated;

notify pgrst, 'reload schema';
