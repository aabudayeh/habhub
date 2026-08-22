-- Date-range and open-target challenges. Existing rows remain one-day,
-- target-based challenges, and all previous RPC signatures keep working.
alter table public.group_challenges
  add column if not exists end_date date;

update public.group_challenges
   set end_date = local_date
 where end_date is null;

alter table public.group_challenges
  drop constraint if exists group_challenges_target_value_check,
  drop constraint if exists group_challenges_period_check,
  drop constraint if exists group_challenges_period_recurrence_check,
  drop constraint if exists group_challenges_recurrence_shape;
alter table public.group_challenges
  alter column target_value drop not null,
  alter column end_date set not null;
alter table public.group_challenges
  add constraint group_challenges_target_value_check
    check (
      target_value is null
      or (target_value > 0 and target_value <= 1000000000000)
    ),
  add constraint group_challenges_period_check
    check (end_date >= local_date and end_date <= local_date + 366),
  add constraint group_challenges_period_recurrence_check
    check (recurrence is null or end_date = local_date),
  add constraint group_challenges_recurrence_shape
    check (
      recurrence is null
      or (
        jsonb_typeof(recurrence) = 'object'
        and coalesce(recurrence ->> 'mode', '') in (
          'daily', 'selected_days', 'every_other_day',
          'interval_days', 'days_of_month'
        )
      )
    );

create or replace function public.fill_group_challenge_end_date()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE'
     and new.local_date is distinct from old.local_date
     and new.end_date is not distinct from old.end_date
     and old.end_date = old.local_date then
    new.end_date := new.local_date;
  else
    new.end_date := coalesce(new.end_date, new.local_date);
  end if;
  return new;
end;
$$;

revoke all on function public.fill_group_challenge_end_date()
  from public, anon, authenticated;

drop trigger if exists group_challenges_fill_end_date
  on public.group_challenges;
create trigger group_challenges_fill_end_date
before insert or update of local_date, end_date
on public.group_challenges
for each row execute function public.fill_group_challenge_end_date();

create index if not exists group_challenges_group_end_date_idx
  on public.group_challenges (group_id, end_date desc, created_at desc)
  where deleted_at is null;

create or replace function public.save_group_challenge(
  p_challenge_id uuid,
  p_group_id uuid,
  p_metric_slug text,
  p_title text,
  p_target_value numeric,
  p_local_date date,
  p_end_date date,
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
  v_recurrence_end date;
  v_mode text;
  v_end_date date := coalesce(p_end_date, p_local_date);
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
    if v_existing.creator_id <> v_user_id
       and not public.is_group_admin(p_group_id) then
      raise exception 'Only the creator or a group administrator can edit this challenge.'
        using errcode = '42501';
    end if;
    if coalesce(
         case
           when v_existing.recurrence ->> 'endDate'
             ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
             then (v_existing.recurrence ->> 'endDate')::date
           else null
         end,
         v_existing.end_date,
         v_existing.local_date
       ) < current_date - 1 then
      raise exception 'Finished challenges cannot be edited.' using errcode = '22023';
    end if;
  end if;
  if p_target_value is not null
     and (p_target_value <= 0 or p_target_value > 1000000000000) then
    raise exception 'Challenge target must be greater than zero.' using errcode = '22023';
  end if;
  if p_local_date is null or v_end_date is null then
    raise exception 'Challenge dates are required.' using errcode = '22023';
  end if;
  if v_end_date < p_local_date or v_end_date > p_local_date + 366 then
    raise exception 'Challenge must end within one year of its start.' using errcode = '22023';
  end if;
  if p_challenge_id is null and p_local_date < current_date - 1 then
    raise exception 'Choose today or a future challenge date.' using errcode = '22023';
  end if;
  if p_title is not null
     and (char_length(btrim(p_title)) < 1 or char_length(btrim(p_title)) > 80) then
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

  if p_challenge_id is not null
     and v_existing.recurrence is not null
     and v_recurrence is null
     and v_existing.local_date < current_date - 1 then
    raise exception 'An ongoing repeating challenge cannot be converted after its first occurrence.'
      using errcode = '22023';
  end if;

  if v_recurrence is not null then
    if v_end_date <> p_local_date then
      raise exception 'Repeating challenges must use a one-day scoring period.'
        using errcode = '22023';
    end if;
    if jsonb_typeof(v_recurrence) <> 'object' then
      raise exception 'Challenge repeat settings are invalid.' using errcode = '22023';
    end if;
    v_mode := v_recurrence ->> 'mode';
    if v_mode is null or v_mode not in (
      'daily', 'selected_days', 'every_other_day',
      'interval_days', 'days_of_month'
    ) then
      raise exception 'Challenge repeat settings are invalid.' using errcode = '22023';
    end if;
    if p_local_date < current_date - 1 and (
      p_challenge_id is null
      or v_existing.recurrence is null
      or p_local_date is distinct from v_existing.local_date
      or (v_recurrence - 'endDate') is distinct from
        (v_existing.recurrence - 'endDate')
    ) then
      raise exception 'Repeating challenge starts cannot be moved further into the past.'
        using errcode = '22023';
    end if;
    if coalesce(v_recurrence ->> 'anchorDate', '') <> p_local_date::text
       or coalesce(v_recurrence ->> 'endDate', '') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then
      raise exception 'Challenge repeat dates are invalid.' using errcode = '22023';
    end if;
    begin
      v_recurrence_end := (v_recurrence ->> 'endDate')::date;
    exception when others then
      raise exception 'Challenge repeat dates are invalid.' using errcode = '22023';
    end;
    if v_recurrence_end < p_local_date
       or v_recurrence_end > p_local_date + 366 then
      raise exception 'Challenge repeat must end within one year.' using errcode = '22023';
    end if;
    if p_challenge_id is not null
       and v_existing.recurrence is not null
       and v_existing.local_date < current_date - 1
       and (
         p_metric_slug is distinct from v_existing.metric_slug
         or p_target_value is distinct from v_existing.target_value
         or p_local_date is distinct from v_existing.local_date
         or (v_recurrence - 'endDate') is distinct from
           (v_existing.recurrence - 'endDate')
         or v_recurrence_end < current_date - 1
       ) then
      raise exception 'Past repeat results are locked. Only the title and future repeat end may change.'
        using errcode = '22023';
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
    select count(*) into v_active_count
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
           end_date = v_end_date,
           participant_ids = v_participants,
           recurrence = v_recurrence
     where id = p_challenge_id
     returning * into v_saved;
  else
    insert into public.group_challenges (
      group_id, creator_id, metric_slug, title, target_value, local_date,
      end_date, participant_ids, accepted_participant_ids,
      declined_participant_ids, recurrence
    ) values (
      p_group_id, v_user_id, p_metric_slug, nullif(btrim(p_title), ''),
      p_target_value, p_local_date, v_end_date, v_participants,
      array[v_user_id], array[]::uuid[], v_recurrence
    ) returning * into v_saved;
  end if;
  return v_saved;
end;
$$;

revoke all on function public.save_group_challenge(
  uuid, uuid, text, text, numeric, date, date, uuid[], jsonb
) from public, anon;
grant execute on function public.save_group_challenge(
  uuid, uuid, text, text, numeric, date, date, uuid[], jsonb
) to authenticated;

-- SDKs released before date-range challenges used this recurrence-aware
-- overload. Route it through the hardened implementation so old clients
-- cannot bypass period, recurrence, or anti-backfill validation.
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
language sql
security definer
set search_path = ''
as $$
  select public.save_group_challenge(
    p_challenge_id,
    p_group_id,
    p_metric_slug,
    p_title,
    p_target_value,
    p_local_date,
    case
      when p_challenge_id is null then p_local_date
      else coalesce(
        (
          select case
            when challenge.end_date is null
              or challenge.end_date = challenge.local_date
              then p_local_date
            else challenge.end_date
          end
            from public.group_challenges challenge
           where challenge.id = p_challenge_id
        ),
        p_local_date
      )
    end,
    p_participant_ids,
    p_recurrence
  );
$$;

revoke all on function public.save_group_challenge(
  uuid, uuid, text, text, numeric, date, uuid[], jsonb
) from public, anon;
grant execute on function public.save_group_challenge(
  uuid, uuid, text, text, numeric, date, uuid[], jsonb
) to authenticated;

-- Rich challenge events remain recipient-scoped and RLS-protected.
alter table public.group_notification_events
  add column if not exists title text,
  add column if not exists detail text,
  add column if not exists occurrence_date date;
alter table public.group_notification_events
  drop constraint if exists group_notification_events_event_type_check,
  drop constraint if exists group_notification_events_title_check,
  drop constraint if exists group_notification_events_detail_check;
alter table public.group_notification_events
  add constraint group_notification_events_event_type_check check (
    event_type in (
      'challenge_invitation', 'challenge_accepted', 'challenge_standing',
      'challenge_reminder', 'challenge_result'
    )
  ),
  add constraint group_notification_events_title_check
    check (title is null or char_length(title) between 1 and 120),
  add constraint group_notification_events_detail_check
    check (detail is null or char_length(detail) between 1 and 500);

create table if not exists public.group_challenge_notification_state (
  challenge_id uuid not null
    references public.group_challenges(id) on delete cascade,
  occurrence_date date not null,
  recipient_id uuid not null references public.profiles(id) on delete cascade,
  last_leader_id uuid references public.profiles(id) on delete set null,
  last_standing_at timestamptz,
  last_reminder_at timestamptz,
  result_notified_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key (challenge_id, occurrence_date, recipient_id)
);
alter table public.group_challenge_notification_state enable row level security;
revoke all on table public.group_challenge_notification_state
  from public, anon, authenticated;

create table if not exists public.challenge_notification_runtime (
  singleton boolean primary key default true check (singleton),
  activated_at timestamptz not null default clock_timestamp()
);
insert into public.challenge_notification_runtime (singleton)
values (true)
on conflict (singleton) do nothing;
alter table public.challenge_notification_runtime enable row level security;
revoke all on table public.challenge_notification_runtime
  from public, anon, authenticated;

create or replace function public.reset_group_challenge_notification_state()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_reset_from date;
begin
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(new.id::text, 0)
  );
  if new.deleted_at is not null then
    delete from public.group_challenge_notification_state state
     where state.challenge_id = new.id;
    delete from public.group_notification_events event
     where event.challenge_id = new.id;
    delete from public.push_dispatch_events event
     where event.category = 'challenge'
       and event.dispatched_at is null
       and event.data ->> 'challengeId' = new.id::text;
    return new;
  end if;
  if row(
       old.metric_slug, old.target_value, old.local_date,
       old.end_date, old.recurrence, old.deleted_at
     ) is not distinct from row(
       new.metric_slug, new.target_value, new.local_date,
       new.end_date, new.recurrence, new.deleted_at
     ) then
    return new;
  end if;
  v_reset_from := case
    when old.recurrence is null and new.recurrence is null
      then least(old.local_date, new.local_date)
    else current_date - 1
  end;

  delete from public.group_challenge_notification_state state
   where state.challenge_id = new.id
     and state.occurrence_date >= v_reset_from;
  delete from public.group_notification_events event
   where event.challenge_id = new.id
     and event.event_type in (
       'challenge_standing', 'challenge_reminder', 'challenge_result'
     )
     and event.occurrence_date >= v_reset_from;
  delete from public.push_dispatch_events event
   where event.category = 'challenge'
     and event.event_type in (
       'challenge_standing', 'challenge_reminder', 'challenge_result'
     )
     and event.dispatched_at is null
     and event.data ->> 'challengeId' = new.id::text
     and case
       when coalesce(event.data ->> 'challengeOccurrenceDate', '')
         ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
         then (event.data ->> 'challengeOccurrenceDate')::date >= v_reset_from
       else false
     end;
  return new;
end;
$$;

revoke all on function public.reset_group_challenge_notification_state()
  from public, anon, authenticated;

drop trigger if exists group_challenges_reset_notification_state
  on public.group_challenges;
create trigger group_challenges_reset_notification_state
after update of metric_slug, target_value, local_date, end_date, recurrence, deleted_at
on public.group_challenges
for each row execute function public.reset_group_challenge_notification_state();

create or replace function public.group_challenge_exact_standings(
  p_challenge_id uuid,
  p_local_date date default null,
  p_end_date date default null
)
returns table (
  user_id uuid,
  display_name text,
  total numeric,
  rank_value numeric,
  position bigint,
  winner boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  with challenge as (
    select challenge.*, definition.id as metric_id,
           definition.ranking_direction,
           coalesce(p_local_date, challenge.local_date) as period_start,
           coalesce(p_end_date, p_local_date, challenge.end_date) as period_end
      from public.group_challenges challenge
      join public.metric_definitions definition
        on definition.group_id = challenge.group_id
       and definition.slug = challenge.metric_slug
       and definition.archived_at is null
     where challenge.id = p_challenge_id
       and challenge.deleted_at is null
  ),
  participant as (
    select accepted.user_id
      from challenge
      cross join lateral unnest(challenge.accepted_participant_ids)
        accepted(user_id)
      join public.group_members member
        on member.group_id = challenge.group_id
       and member.user_id = accepted.user_id
       and member.status = 'active'
  ),
  raw_totals as (
    select participant.user_id,
           coalesce(profile.display_name, 'A friend') as display_name,
           challenge.metric_slug,
           challenge.ranking_direction,
           coalesce(sum(status.exact_value) filter (
             where status.visibility::text = 'group'
               and status.exact_value is not null
           ), 0) as summed_total,
           (array_agg(status.exact_value order by status.local_date) filter (
             where status.visibility::text = 'group'
               and status.exact_value is not null
           ))[1] as first_value,
           (array_agg(status.exact_value order by status.local_date desc) filter (
             where status.visibility::text = 'group'
               and status.exact_value is not null
           ))[1] as latest_value,
           (
             select prior.exact_value
               from public.daily_metric_status prior
              where prior.group_id = challenge.group_id
                and prior.metric_id = challenge.metric_id
                and prior.user_id = participant.user_id
                and prior.local_date < challenge.period_start
                and prior.visibility::text = 'group'
                and prior.exact_value is not null
              order by prior.local_date desc, prior.updated_at desc
              limit 1
           ) as previous_value,
           count(status.exact_value) filter (
             where status.visibility::text = 'group'
               and status.exact_value is not null
           ) as exact_days,
           bool_or(
             coalesce(status.has_data, false)
             and coalesce(status.visibility::text, 'status') <> 'group'
           ) as has_private
      from challenge
      join participant on true
      left join public.profiles profile on profile.id = participant.user_id
      left join public.daily_metric_status status
        on status.group_id = challenge.group_id
       and status.metric_id = challenge.metric_id
       and status.user_id = participant.user_id
       and status.local_date between challenge.period_start and challenge.period_end
     group by participant.user_id, profile.display_name,
              challenge.group_id, challenge.metric_id,
              challenge.metric_slug, challenge.period_start,
              challenge.ranking_direction
  ),
  totals as (
    select raw_totals.user_id, raw_totals.display_name,
           case
             when raw_totals.metric_slug = 'weight' then
               case raw_totals.ranking_direction
                 when 'lower' then -(
                   raw_totals.latest_value - coalesce(
                     raw_totals.previous_value, raw_totals.first_value
                   )
                 )
                 when 'higher' then
                   raw_totals.latest_value - coalesce(
                     raw_totals.previous_value, raw_totals.first_value
                   )
                 else abs(
                   raw_totals.latest_value - coalesce(
                     raw_totals.previous_value, raw_totals.first_value
                   )
                 )
               end
             else raw_totals.summed_total
           end as total,
           raw_totals.exact_days,
           raw_totals.has_private
      from raw_totals
  ),
  visible as (
    select totals.*
      from totals
     where totals.exact_days > 0
       and not exists (select 1 from totals private where private.has_private)
  ),
  scored as (
    select visible.*,
           case
             when challenge.target_value is null
               or challenge.ranking_direction = 'higher' then -visible.total
             when challenge.ranking_direction = 'lower' then visible.total
             else abs(visible.total - challenge.target_value)
           end as sort_value,
           case
             when challenge.target_value is null then true
             when challenge.ranking_direction = 'higher'
               then visible.total >= challenge.target_value
             when challenge.ranking_direction = 'lower'
               then visible.total <= challenge.target_value
             else abs(visible.total - challenge.target_value)
               <= greatest(challenge.target_value * 0.01, 0.0001)
           end as eligible
      from visible
      cross join challenge
  ),
  ranked as (
    select scored.*,
           row_number() over (order by scored.sort_value, scored.user_id) as position,
           count(*) over () as competitor_count,
           min(scored.sort_value) filter (where scored.eligible) over ()
             as winning_value
      from scored
  )
  select ranked.user_id, ranked.display_name, ranked.total,
         ranked.sort_value as rank_value, ranked.position,
         ranked.competitor_count >= 2
           and ranked.eligible
           and ranked.sort_value = ranked.winning_value as winner
    from ranked
   order by ranked.position;
$$;

revoke all on function public.group_challenge_exact_standings(uuid, date, date)
  from public, anon, authenticated;
grant execute on function public.group_challenge_exact_standings(uuid, date, date)
  to service_role;

create or replace function public.group_challenge_occurs_on(
  p_recurrence jsonb,
  p_anchor_date date,
  p_candidate_date date
)
returns boolean
language sql
immutable
parallel safe
security definer
set search_path = ''
as $$
  select p_recurrence is not null
     and p_candidate_date >= p_anchor_date
     and p_candidate_date <= (p_recurrence ->> 'endDate')::date
     and case p_recurrence ->> 'mode'
       when 'daily' then true
       when 'selected_days' then exists (
         select 1
           from jsonb_array_elements_text(p_recurrence -> 'daysOfWeek') day(value)
          where day.value::integer = extract(dow from p_candidate_date)::integer
       )
       when 'every_other_day' then
         (p_candidate_date - p_anchor_date) % 2 = 0
       when 'interval_days' then
         (p_candidate_date - p_anchor_date) %
           greatest(1, (p_recurrence ->> 'intervalDays')::integer) = 0
       when 'days_of_month' then exists (
         select 1
           from jsonb_array_elements_text(p_recurrence -> 'daysOfMonth') day(value)
          where day.value::integer = extract(day from p_candidate_date)::integer
       )
       else false
     end;
$$;

revoke all on function public.group_challenge_occurs_on(jsonb, date, date)
  from public, anon, authenticated;
grant execute on function public.group_challenge_occurs_on(jsonb, date, date)
  to service_role;

-- The official client proves the privacy-filtered before/after rank change;
-- the server proves that exactly one fresh, group-visible source row committed.
-- Keep copy identity/value-free because standings are not recomputed here.
create or replace function public.enqueue_group_lead_push_event(
  p_group_id uuid,
  p_metric_slug text,
  p_source_entry_ids text[]
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_metric_id uuid;
  v_metric_name text;
  v_ids text[];
  v_entry_id uuid;
  v_source_provider text;
  v_latest timestamptz;
  v_event_key text;
begin
  if v_user_id is null or not public.is_group_member(p_group_id) then
    raise exception 'Active group membership required.' using errcode = '42501';
  end if;
  select array_agg(distinct source_id order by source_id)
    into v_ids
    from unnest(coalesce(p_source_entry_ids, array[]::text[]))
      source(source_id)
   where nullif(source_id, '') is not null;
  if cardinality(coalesce(v_ids, array[]::text[])) <> 1 then
    raise exception 'Exactly one committed source entry is required.'
      using errcode = '22023';
  end if;
  select definition.id, definition.name
    into v_metric_id, v_metric_name
    from public.metric_definitions definition
   where definition.group_id = p_group_id
     and definition.slug = p_metric_slug
     and definition.archived_at is null;
  if v_metric_id is null then
    raise exception 'Group tracker not found.' using errcode = 'P0002';
  end if;
  select entry.id, entry.source_provider, entry.updated_at
    into v_entry_id, v_source_provider, v_latest
    from public.metric_entries entry
   where entry.metric_id = v_metric_id
     and entry.user_id = v_user_id
     and entry.visibility = 'group'
     and entry.client_generated_id = any(v_ids)
     and entry.updated_at >= now() - interval '30 minutes';
  if v_source_provider = 'google_health' then return null; end if;
  if v_entry_id is null then
    raise exception 'Every source entry must be a fresh committed shared row.'
      using errcode = '42501';
  end if;
  v_event_key := 'lead:' || p_group_id::text || ':' || v_user_id::text || ':' ||
    v_entry_id::text || ':' ||
    floor(extract(epoch from v_latest) * 1000)::bigint::text;

  insert into public.push_dispatch_events (
    event_key, group_id, dispatcher_id, category, event_type, audience,
    metric_slug, title, body, data, expires_at
  ) values (
    v_event_key,
    p_group_id,
    v_user_id,
    'lead',
    'leaderboard_activity',
    'group_including_sender',
    p_metric_slug,
    'Lead changed',
    left(
      'New ' || v_metric_name ||
        ' activity changed first place. Open the Leaderboard for the latest standings.',
      500
    ),
    jsonb_build_object(
      'route', '/group',
      'groupId', p_group_id,
      'metricId', p_metric_slug
    ),
    now() + interval '30 minutes'
  ) on conflict (event_key) do nothing;
  return v_event_key;
end;
$$;

revoke all on function public.enqueue_group_lead_push_event(uuid, text, text[])
  from public, anon;
grant execute on function public.enqueue_group_lead_push_event(uuid, text, text[])
  to authenticated;

create or replace function public.stage_group_challenge_notifications(
  p_limit integer default 100
)
returns table (event_key text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_challenge record;
  v_recipient record;
  v_state public.group_challenge_notification_state;
  v_leader record;
  v_self record;
  v_neighbor record;
  v_old_leader_name text;
  v_winner_ids uuid[];
  v_winner_names text;
  v_actor_id uuid;
  v_title text;
  v_detail text;
  v_event_key text;
  v_gap numeric;
  v_duration integer;
  v_interval interval;
  v_group_preference jsonb;
  v_cadence text;
  v_kind text;
  v_inserted text;
  v_settlement_at timestamptz;
  v_all_participants_finished boolean;
begin
  for v_challenge in
    with base as (
      select challenge.*,
             coalesce(challenge.title, definition.name || ' challenge') as label,
             definition.name as metric_name,
             definition.unit,
             greatest(
               current_date - 30,
               (runtime.activated_at at time zone 'UTC')::date - 1
             ) as retry_from
        from public.group_challenges challenge
        join public.metric_definitions definition
          on definition.group_id = challenge.group_id
         and definition.slug = challenge.metric_slug
         and definition.archived_at is null
        cross join public.challenge_notification_runtime runtime
       where challenge.deleted_at is null
         and runtime.singleton
    ), occurrences as (
      select base.*, base.local_date as occurrence_date,
             base.end_date as occurrence_end_date
        from base
       where (
         base.recurrence is null
         or base.recurrence ->> 'mode' = 'once'
       )
         and base.end_date >= base.retry_from
      union all
      select base.*, candidate.day::date as occurrence_date,
             candidate.day::date as occurrence_end_date
        from base
        cross join lateral generate_series(
          greatest(base.local_date, base.retry_from),
          least((base.recurrence ->> 'endDate')::date, current_date + 1),
          interval '1 day'
        ) candidate(day)
       where base.recurrence is not null
         and base.recurrence ->> 'mode' <> 'once'
         and public.group_challenge_occurs_on(
           base.recurrence,
           base.local_date,
           candidate.day::date
         )
    )
    select occurrence.*
      from occurrences occurrence
     where occurrence.occurrence_date <= current_date + 1
       and (
         occurrence.occurrence_end_date >= current_date - 1
         or exists (
           select 1
             from unnest(occurrence.accepted_participant_ids) accepted(user_id)
             join public.group_members member
               on member.group_id = occurrence.group_id
              and member.user_id = accepted.user_id
              and member.status = 'active'
             left join public.group_challenge_notification_state state
               on state.challenge_id = occurrence.id
              and state.occurrence_date = occurrence.occurrence_date
              and state.recipient_id = accepted.user_id
            where state.result_notified_at is null
         )
       )
     order by
       md5(
         occurrence.id::text || ':' || occurrence.occurrence_date::text || ':' ||
         date_trunc('hour', statement_timestamp())::text
       ),
       occurrence.occurrence_end_date,
       occurrence.created_at
     limit greatest(1, least(coalesce(p_limit, 100), 500))
  loop
    perform pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended(v_challenge.id::text, 0)
    );
    if not exists (
      select 1
        from public.group_challenges current_challenge
       where current_challenge.id = v_challenge.id
         and current_challenge.deleted_at is null
         and current_challenge.updated_at = v_challenge.updated_at
    ) then
      continue;
    end if;
    v_settlement_at := clock_timestamp();
    select coalesce(
             bool_and(
               (v_settlement_at at time zone coalesce(valid_timezone.name, 'UTC'))::date
                 > v_challenge.occurrence_end_date
             ),
             false
           )
      into v_all_participants_finished
      from unnest(v_challenge.accepted_participant_ids) accepted(user_id)
      join public.group_members member
        on member.group_id = v_challenge.group_id
       and member.user_id = accepted.user_id
       and member.status = 'active'
      left join public.profiles profile on profile.id = member.user_id
      left join pg_catalog.pg_timezone_names valid_timezone
        on valid_timezone.name = profile.timezone;

    select * into v_leader
      from public.group_challenge_exact_standings(
        v_challenge.id,
        v_challenge.occurrence_date,
        v_challenge.occurrence_end_date
      )
     order by position limit 1;

    select array_agg(standing.user_id order by standing.user_id),
           string_agg(standing.display_name, ', ' order by standing.display_name),
           min(standing.user_id)
      into v_winner_ids, v_winner_names, v_actor_id
      from public.group_challenge_exact_standings(
        v_challenge.id,
        v_challenge.occurrence_date,
        v_challenge.occurrence_end_date
      ) standing
     where standing.winner;

    v_duration :=
      v_challenge.occurrence_end_date - v_challenge.occurrence_date + 1;
    v_interval := case
      when v_duration <= 7 then interval '1 day'
      when v_duration <= 31 then interval '2 days'
      when v_duration <= 92 then interval '7 days'
      else interval '14 days'
    end;

    for v_recipient in
      select member.user_id,
             (v_settlement_at at time zone coalesce(valid_timezone.name, 'UTC'))::date
               as local_today
        from unnest(v_challenge.accepted_participant_ids) accepted(user_id)
        join public.group_members member
          on member.group_id = v_challenge.group_id
         and member.user_id = accepted.user_id
         and member.status = 'active'
        left join public.profiles profile on profile.id = member.user_id
        left join pg_catalog.pg_timezone_names valid_timezone
          on valid_timezone.name = profile.timezone
    loop
      if v_recipient.local_today < v_challenge.occurrence_date then
        continue;
      end if;
      select coalesce(
               snapshot.payload #> array[
                 'settings', 'notifications', 'groupPreferencesByGroup',
                 v_challenge.group_id::text
               ],
               '{}'::jsonb
             )
        into v_group_preference
        from public.user_snapshots snapshot
       where snapshot.user_id = v_recipient.user_id;
      v_group_preference := coalesce(v_group_preference, '{}'::jsonb);
      v_cadence := coalesce(
        v_group_preference ->> 'challengeCadence',
        'balanced'
      );
      v_interval := case
        when v_cadence = 'frequent' then case
          when v_duration <= 7 then interval '12 hours'
          when v_duration <= 31 then interval '1 day'
          when v_duration <= 92 then interval '3 days'
          else interval '7 days'
        end
        when v_cadence = 'minimal' then case
          when v_duration <= 7 then interval '2 days'
          when v_duration <= 31 then interval '4 days'
          when v_duration <= 92 then interval '14 days'
          else interval '28 days'
        end
        else case
          when v_duration <= 7 then interval '1 day'
          when v_duration <= 31 then interval '2 days'
          when v_duration <= 92 then interval '7 days'
          else interval '14 days'
        end
      end;

      insert into public.group_challenge_notification_state (
        challenge_id, occurrence_date, recipient_id,
        last_leader_id, last_reminder_at
      ) values (
        v_challenge.id, v_challenge.occurrence_date, v_recipient.user_id,
        v_leader.user_id, clock_timestamp()
      ) on conflict (challenge_id, occurrence_date, recipient_id) do nothing;

      select * into v_state
        from public.group_challenge_notification_state state
       where state.challenge_id = v_challenge.id
         and state.occurrence_date = v_challenge.occurrence_date
         and state.recipient_id = v_recipient.user_id
       for update;

      if v_recipient.local_today > v_challenge.occurrence_end_date then
        if v_all_participants_finished and v_state.result_notified_at is null then
          v_title := case
            when v_recipient.user_id = any(
              coalesce(v_winner_ids, array[]::uuid[])
            )
              then 'You won ' || v_challenge.label
            when cardinality(coalesce(v_winner_ids, array[]::uuid[])) > 0
              then left(v_winner_names || ' won ' || v_challenge.label, 120)
            else left(v_challenge.label || ' complete', 120)
          end;
          v_detail := 'The challenge is complete. Open the Leaderboard to see the final standings.';
          v_event_key := 'challenge-result:' || v_challenge.id::text || ':' ||
            v_challenge.occurrence_date::text || ':' ||
            v_recipient.user_id::text;

          insert into public.group_notification_events (
            event_key, group_id, recipient_id, actor_id, event_type,
            challenge_id, occurrence_date, title, detail
          ) values (
            v_event_key, v_challenge.group_id, v_recipient.user_id,
            coalesce(v_actor_id, v_challenge.creator_id), 'challenge_result',
            v_challenge.id, v_challenge.occurrence_date,
            left(v_title, 120), left(v_detail, 500)
          ) on conflict (recipient_id, event_key) do nothing;

          insert into public.push_dispatch_events (
            event_key, group_id, dispatcher_id, category, event_type,
            audience, recipient_id, metric_slug, title, body, data,
            expires_at
          ) values (
            v_event_key, v_challenge.group_id, v_challenge.creator_id,
            'challenge', 'challenge_result', 'user', v_recipient.user_id,
            v_challenge.metric_slug, left(v_title, 120), left(v_detail, 500),
            jsonb_build_object(
              'route', '/group', 'groupId', v_challenge.group_id,
              'challengeId', v_challenge.id,
              'challengeOccurrenceDate', v_challenge.occurrence_date,
              'challengeEvent', 'result'
            ),
            clock_timestamp() + interval '7 days'
          ) on conflict (event_key) do nothing returning event_key into v_inserted;
          if v_inserted is not null then
            event_key := v_inserted;
            return next;
            v_inserted := null;
          end if;
          update public.group_challenge_notification_state
             set result_notified_at = clock_timestamp(),
                 updated_at = clock_timestamp()
           where challenge_id = v_challenge.id
             and occurrence_date = v_challenge.occurrence_date
             and recipient_id = v_recipient.user_id;
        end if;
        continue;
      end if;

      select * into v_self
        from public.group_challenge_exact_standings(
          v_challenge.id,
          v_challenge.occurrence_date,
          v_challenge.occurrence_end_date
        )
       where user_id = v_recipient.user_id;

      v_kind := null;
      if v_leader.user_id is not null
         and v_state.last_leader_id is distinct from v_leader.user_id
         and (
           v_recipient.user_id = v_state.last_leader_id
           or v_recipient.user_id = v_leader.user_id
         )
         and (
           v_state.last_standing_at is null
           or v_state.last_standing_at <= clock_timestamp() - interval '6 hours'
         ) then
        v_kind := 'challenge_standing';
        select profile.display_name into v_old_leader_name
          from public.profiles profile where profile.id = v_state.last_leader_id;
        v_title := case
          when v_recipient.user_id = v_leader.user_id
            then 'You took the lead'
          else v_leader.display_name || ' took the lead'
        end;
      elsif v_state.last_reminder_at <= clock_timestamp() - v_interval then
        v_kind := 'challenge_reminder';
        v_title := 'Keep pushing in ' || v_challenge.label;
      end if;

      if v_kind is not null then
        if v_self.user_id is null then
          v_detail := 'Log ' || v_challenge.metric_name ||
            ' to join the live standings.';
        elsif v_self.position = 1 then
          select * into v_neighbor
            from public.group_challenge_exact_standings(
              v_challenge.id,
              v_challenge.occurrence_date,
              v_challenge.occurrence_end_date
            )
           where position = 2;
          if v_neighbor.user_id is null then
            v_detail := 'You are first. Keep building your lead.';
          else
            v_gap := abs(v_self.rank_value - v_neighbor.rank_value);
            if v_gap = 0 then
              v_detail := 'You are tied with ' || v_neighbor.display_name ||
                ' for first.';
            else
              v_detail := 'You are first, ' || round(v_gap, 2)::text ||
                case when nullif(v_challenge.unit, '') is null then '' else ' ' || v_challenge.unit end ||
                ' ahead of ' || v_neighbor.display_name || '.';
            end if;
          end if;
        else
          select * into v_neighbor
            from public.group_challenge_exact_standings(
              v_challenge.id,
              v_challenge.occurrence_date,
              v_challenge.occurrence_end_date
            )
           where position = v_self.position - 1;
          v_gap := abs(
            coalesce(v_neighbor.rank_value, v_self.rank_value) - v_self.rank_value
          );
          if v_gap = 0 then
            v_detail := 'You are level with ' ||
              coalesce(v_neighbor.display_name, v_leader.display_name) || '.';
          else
            v_detail := 'You are ' || round(v_gap, 2)::text ||
              case when nullif(v_challenge.unit, '') is null then '' else ' ' || v_challenge.unit end ||
              ' behind ' || coalesce(v_neighbor.display_name, v_leader.display_name) || '.';
          end if;
        end if;

        v_event_key := case
          when v_kind = 'challenge_standing' then
            'challenge-standing:' || v_challenge.id::text || ':' ||
              v_challenge.occurrence_date::text || ':' ||
              v_leader.user_id::text || ':' || v_recipient.user_id::text || ':' ||
              floor(extract(epoch from clock_timestamp()) / 21600)::bigint::text
          else
            'challenge-reminder:' || v_challenge.id::text || ':' ||
              v_challenge.occurrence_date::text || ':' ||
              v_recipient.user_id::text || ':' || v_recipient.local_today::text
        end;

        insert into public.group_notification_events (
          event_key, group_id, recipient_id, actor_id, event_type,
          challenge_id, occurrence_date, title, detail
        ) values (
          v_event_key, v_challenge.group_id, v_recipient.user_id,
          coalesce(v_leader.user_id, v_challenge.creator_id),
          v_kind, v_challenge.id, v_challenge.occurrence_date,
          left(v_title, 120), left(v_detail, 500)
        ) on conflict (recipient_id, event_key) do nothing;

        insert into public.push_dispatch_events (
          event_key, group_id, dispatcher_id, category, event_type,
          audience, recipient_id, metric_slug, title, body, data,
          expires_at
        ) values (
          v_event_key, v_challenge.group_id, v_challenge.creator_id,
          'challenge', v_kind, 'user', v_recipient.user_id,
          v_challenge.metric_slug, left(v_title, 120), left(v_detail, 500),
          jsonb_build_object(
            'route', '/group', 'groupId', v_challenge.group_id,
            'challengeId', v_challenge.id,
            'challengeOccurrenceDate', v_challenge.occurrence_date,
            'challengeEvent', case
              when v_kind = 'challenge_standing' then 'standing'
              else 'reminder'
            end
          ),
          clock_timestamp() + interval '2 days'
        ) on conflict (event_key) do nothing returning event_key into v_inserted;
        if v_inserted is not null then
          event_key := v_inserted;
          return next;
          v_inserted := null;
        end if;
      end if;

      update public.group_challenge_notification_state
         set last_leader_id = v_leader.user_id,
             last_standing_at = case
               when v_kind = 'challenge_standing' then clock_timestamp()
               else last_standing_at
             end,
             last_reminder_at = case
               when v_kind = 'challenge_reminder' then clock_timestamp()
               else last_reminder_at
             end,
             updated_at = clock_timestamp()
       where challenge_id = v_challenge.id
         and occurrence_date = v_challenge.occurrence_date
         and recipient_id = v_recipient.user_id;
    end loop;
  end loop;
end;
$$;

revoke all on function public.stage_group_challenge_notifications(integer)
  from public, anon, authenticated;
grant execute on function public.stage_group_challenge_notifications(integer)
  to service_role;

-- The Edge worker drains server-authored event keys. Vault values are set at
-- deployment time, never embedded in source or exposed to clients.
create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;

create or replace function public.invoke_group_challenge_notification_worker()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_url text;
  v_secret text;
begin
  select secret.decrypted_secret into v_url
    from vault.decrypted_secrets secret
   where secret.name = 'challenge_notification_worker_url'
   order by secret.created_at desc limit 1;
  select secret.decrypted_secret into v_secret
    from vault.decrypted_secrets secret
   where secret.name = 'challenge_notification_worker_secret'
   order by secret.created_at desc limit 1;
  if nullif(v_url, '') is null or nullif(v_secret, '') is null then return; end if;
  perform net.http_post(
    url := v_url,
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || v_secret,
      'Content-Type', 'application/json'
    ),
    body := '{"limit":500}'::jsonb,
    timeout_milliseconds := 15000
  );
end;
$$;

revoke all on function public.invoke_group_challenge_notification_worker()
  from public, anon, authenticated;
grant execute on function public.invoke_group_challenge_notification_worker()
  to service_role;

select cron.unschedule(jobid)
  from cron.job
 where jobname = 'group-challenge-notifications-hourly';
select cron.schedule(
  'group-challenge-notifications-hourly',
  '17 * * * *',
  'select public.invoke_group_challenge_notification_worker()'
);

notify pgrst, 'reload schema';
