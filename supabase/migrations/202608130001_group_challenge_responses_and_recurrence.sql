-- Challenge invitations remain on the existing RLS-protected row. This keeps
-- explicit visibility stable while allowing each invitee to accept or decline
-- and lets clients derive bounded recurring occurrences without extra writes.
alter table public.group_challenges
  add column if not exists accepted_participant_ids uuid[],
  add column if not exists declined_participant_ids uuid[],
  add column if not exists recurrence jsonb;

-- Challenges created before invitation responses existed were opt-in by
-- definition, so preserve their behavior instead of turning them pending.
update public.group_challenges
   set accepted_participant_ids = participant_ids
 where accepted_participant_ids is null;
update public.group_challenges
   set declined_participant_ids = array[]::uuid[]
 where declined_participant_ids is null;

alter table public.group_challenges
  alter column accepted_participant_ids set default array[]::uuid[],
  alter column accepted_participant_ids set not null,
  alter column declined_participant_ids set default array[]::uuid[],
  alter column declined_participant_ids set not null;

alter table public.group_challenges
  drop constraint if exists group_challenges_accepted_subset,
  drop constraint if exists group_challenges_declined_subset,
  drop constraint if exists group_challenges_response_disjoint,
  drop constraint if exists group_challenges_creator_accepted,
  drop constraint if exists group_challenges_recurrence_shape;
alter table public.group_challenges
  add constraint group_challenges_accepted_subset
    check (accepted_participant_ids <@ participant_ids),
  add constraint group_challenges_declined_subset
    check (declined_participant_ids <@ participant_ids),
  add constraint group_challenges_response_disjoint
    check (not (accepted_participant_ids && declined_participant_ids)),
  add constraint group_challenges_creator_accepted
    check (creator_id = any(accepted_participant_ids)),
  add constraint group_challenges_recurrence_shape
    check (
      recurrence is null
      or (
        jsonb_typeof(recurrence) = 'object'
        and recurrence ->> 'mode' in (
          'daily', 'selected_days', 'every_other_day',
          'interval_days', 'days_of_month'
        )
      )
    );

create or replace function public.save_group_challenge(
  p_challenge_id uuid,
  p_group_id uuid,
  p_metric_slug text,
  p_title text,
  p_target_value numeric,
  p_local_date date,
  p_participant_ids uuid[],
  p_recurrence jsonb
)
returns public.group_challenges
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_participants uuid[];
  v_existing public.group_challenges;
  v_saved public.group_challenges;
  v_active_count integer;
  v_recurrence jsonb := p_recurrence;
  v_end_date date;
  v_mode text;
begin
  if v_user_id is null then
    raise exception 'Authentication required.' using errcode = '42501';
  end if;
  if not public.is_group_member(p_group_id) then
    raise exception 'Active group membership required.' using errcode = '42501';
  end if;
  if p_challenge_id is not null then
    select * into v_existing
      from public.group_challenges challenge
     where challenge.id = p_challenge_id
       and challenge.deleted_at is null
     for update;
    if not found or v_existing.group_id <> p_group_id then
      raise exception 'Challenge not found.' using errcode = 'P0002';
    end if;
    if v_existing.creator_id <> v_user_id and not public.is_group_admin(p_group_id) then
      raise exception 'Only the creator or a group administrator can edit this challenge.'
        using errcode = '42501';
    end if;
    -- Local dates can be one calendar day away from UTC at the date line.
    if v_existing.local_date < current_date - 1 then
      raise exception 'Finished challenges cannot be edited.' using errcode = '22023';
    end if;
  end if;
  if p_target_value is null or p_target_value <= 0 or p_target_value > 1000000000000 then
    raise exception 'Challenge target must be greater than zero.' using errcode = '22023';
  end if;
  if p_local_date is null then
    raise exception 'Challenge date is required.' using errcode = '22023';
  end if;
  if p_challenge_id is null and p_local_date < current_date - 1 then
    raise exception 'Choose today or a future challenge date.' using errcode = '22023';
  end if;
  if p_title is not null and (char_length(btrim(p_title)) < 1 or char_length(btrim(p_title)) > 80) then
    raise exception 'Challenge title must contain 1 to 80 characters.' using errcode = '22023';
  end if;
  if not exists (
    select 1
      from public.metric_definitions definition
     where definition.group_id = p_group_id
       and definition.slug = p_metric_slug
       and definition.archived_at is null
       and definition.data_type in ('number', 'calculated')
       and coalesce(definition.configuration #>> '{sections,group}', 'true') = 'true'
  ) then
    raise exception 'Choose an active numerical group tracker.' using errcode = '22023';
  end if;

  if v_recurrence is not null then
    if jsonb_typeof(v_recurrence) <> 'object' then
      raise exception 'Challenge repeat settings are invalid.' using errcode = '22023';
    end if;
    v_mode := v_recurrence ->> 'mode';
    if v_mode not in (
      'daily', 'selected_days', 'every_other_day',
      'interval_days', 'days_of_month'
    ) then
      raise exception 'Challenge repeat settings are invalid.' using errcode = '22023';
    end if;
    if coalesce(v_recurrence ->> 'anchorDate', '') <> p_local_date::text
       or coalesce(v_recurrence ->> 'endDate', '') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then
      raise exception 'Challenge repeat dates are invalid.' using errcode = '22023';
    end if;
    begin
      v_end_date := (v_recurrence ->> 'endDate')::date;
    exception when others then
      raise exception 'Challenge repeat dates are invalid.' using errcode = '22023';
    end;
    if v_end_date < p_local_date or v_end_date > p_local_date + 366 then
      raise exception 'Challenge repeat must end within one year.' using errcode = '22023';
    end if;
    if v_mode = 'selected_days' and (
      jsonb_typeof(v_recurrence -> 'daysOfWeek') is distinct from 'array'
      or jsonb_array_length(v_recurrence -> 'daysOfWeek') = 0
    ) then
      raise exception 'Choose at least one repeat weekday.' using errcode = '22023';
    end if;
    if v_mode = 'selected_days' and exists (
      select 1
        from jsonb_array_elements_text(v_recurrence -> 'daysOfWeek') item(value)
       where case
         when item.value ~ '^[0-9]$'
           then item.value::integer not between 0 and 6
         else true
       end
    ) then
      raise exception 'Challenge repeat weekdays are invalid.' using errcode = '22023';
    end if;
    if v_mode = 'days_of_month' and (
      jsonb_typeof(v_recurrence -> 'daysOfMonth') is distinct from 'array'
      or jsonb_array_length(v_recurrence -> 'daysOfMonth') = 0
    ) then
      raise exception 'Choose at least one repeat day.' using errcode = '22023';
    end if;
    if v_mode = 'days_of_month' and exists (
      select 1
        from jsonb_array_elements_text(v_recurrence -> 'daysOfMonth') item(value)
       where case
         when item.value ~ '^[0-9]{1,2}$'
           then item.value::integer not between 1 and 31
         else true
       end
    ) then
      raise exception 'Challenge repeat days are invalid.' using errcode = '22023';
    end if;
    if v_mode = 'interval_days' and (
      case
        when coalesce(v_recurrence ->> 'intervalDays', '') ~ '^[0-9]{1,2}$'
          then (v_recurrence ->> 'intervalDays')::integer not between 2 and 31
        else true
      end
    ) then
      raise exception 'Challenge repeat interval is invalid.' using errcode = '22023';
    end if;
  end if;

  if p_challenge_id is not null then
    -- Keep the invited RLS audience and response state immutable on edit.
    v_participants := v_existing.participant_ids;
  else
    select coalesce(array_agg(candidate.user_id order by candidate.user_id), array[]::uuid[])
      into v_participants
      from (
        select distinct requested.user_id
          from unnest(coalesce(p_participant_ids, array[]::uuid[]) || array[v_user_id])
            as requested(user_id)
         where requested.user_id is not null
      ) candidate;

    if cardinality(v_participants) < 2 or cardinality(v_participants) > 50 then
      raise exception 'Choose between 1 and 49 friends.' using errcode = '22023';
    end if;

    select count(*)
      into v_active_count
      from public.group_members member
     where member.group_id = p_group_id
       and member.status = 'active'
       and member.user_id = any(v_participants);
    if v_active_count <> cardinality(v_participants) then
      raise exception 'Every invited person must be an active group member.' using errcode = '22023';
    end if;
  end if;

  if p_challenge_id is not null then
    update public.group_challenges
       set metric_slug = p_metric_slug,
           title = nullif(btrim(p_title), ''),
           target_value = p_target_value,
           local_date = p_local_date,
           participant_ids = v_participants,
           recurrence = v_recurrence
     where id = p_challenge_id
     returning * into v_saved;
  else
    insert into public.group_challenges (
      group_id, creator_id, metric_slug, title, target_value, local_date,
      participant_ids, accepted_participant_ids, declined_participant_ids,
      recurrence
    ) values (
      p_group_id, v_user_id, p_metric_slug, nullif(btrim(p_title), ''),
      p_target_value, p_local_date, v_participants, array[v_user_id],
      array[]::uuid[], v_recurrence
    ) returning * into v_saved;
  end if;
  return v_saved;
end;
$$;

-- Keep the previous client signature working during rollout. New clients use
-- the overload above and always include p_recurrence.
create or replace function public.save_group_challenge(
  p_challenge_id uuid,
  p_group_id uuid,
  p_metric_slug text,
  p_title text,
  p_target_value numeric,
  p_local_date date,
  p_participant_ids uuid[]
)
returns public.group_challenges
language sql
security definer
set search_path = ''
as $$
  select public.save_group_challenge(
    p_challenge_id, p_group_id, p_metric_slug, p_title, p_target_value,
    p_local_date, p_participant_ids,
    case
      when p_challenge_id is null then null::jsonb
      else (
        select challenge.recurrence
          from public.group_challenges challenge
         where challenge.id = p_challenge_id
      )
    end
  );
$$;

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
begin
  if v_user_id is null then
    raise exception 'Authentication required.' using errcode = '42501';
  end if;
  select * into v_challenge
    from public.group_challenges challenge
   where challenge.id = p_challenge_id
     and challenge.deleted_at is null
   for update;
  if not found then
    raise exception 'Challenge not found.' using errcode = 'P0002';
  end if;
  if not public.is_group_member(v_challenge.group_id)
     or not (v_user_id = any(v_challenge.participant_ids)) then
    raise exception 'An active invitation is required.' using errcode = '42501';
  end if;
  if v_user_id = v_challenge.creator_id then
    return v_challenge;
  end if;
  if v_challenge.local_date < current_date - 1 then
    raise exception 'This challenge invitation has closed.' using errcode = '22023';
  end if;
  if p_accept is null then
    raise exception 'Choose whether to accept or decline.' using errcode = '22023';
  end if;

  if p_accept then
    update public.group_challenges
       set accepted_participant_ids = (
             select array_agg(candidate order by candidate)
               from (
                 select distinct unnest(
                   accepted_participant_ids || array[v_user_id]
                 ) candidate
               ) accepted
           ),
           declined_participant_ids = array_remove(
             declined_participant_ids, v_user_id
           )
     where id = p_challenge_id
     returning * into v_challenge;
  else
    update public.group_challenges
       set declined_participant_ids = (
             select array_agg(candidate order by candidate)
               from (
                 select distinct unnest(
                   declined_participant_ids || array[v_user_id]
                 ) candidate
               ) declined
           ),
           accepted_participant_ids = array_remove(
             accepted_participant_ids, v_user_id
           )
     where id = p_challenge_id
     returning * into v_challenge;
  end if;
  return v_challenge;
end;
$$;

revoke all on function public.save_group_challenge(
  uuid, uuid, text, text, numeric, date, uuid[], jsonb
) from public, anon;
grant execute on function public.save_group_challenge(
  uuid, uuid, text, text, numeric, date, uuid[], jsonb
) to authenticated;
revoke all on function public.respond_group_challenge(uuid, boolean)
  from public, anon;
grant execute on function public.respond_group_challenge(uuid, boolean)
  to authenticated;
