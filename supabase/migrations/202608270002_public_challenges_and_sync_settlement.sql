-- Public challenge discovery/joining plus sync-safe group challenge results.
-- Health values remain outside this catalogue; joining is explicit consent to
-- use the selected tracker only for the challenge scoring dates.

alter table public.group_challenges
  add column if not exists audience text not null default 'group',
  add column if not exists participant_limit integer;

alter table public.group_challenges
  drop constraint if exists group_challenges_audience_check,
  drop constraint if exists group_challenges_participant_limit_check,
  drop constraint if exists group_challenges_participant_ids_check,
  drop constraint if exists group_challenges_participant_count_check;
do $migration$
declare
  v_constraint name;
begin
  -- The original anonymous check has a Postgres-generated name that can vary
  -- across restored projects. Remove it by definition before replacing it.
  for v_constraint in
    select constraint_row.conname
      from pg_catalog.pg_constraint constraint_row
     where constraint_row.conrelid = 'public.group_challenges'::regclass
       and constraint_row.contype = 'c'
       and pg_catalog.pg_get_constraintdef(constraint_row.oid)
         like '%cardinality(participant_ids)%>= 2%'
  loop
    execute format(
      'alter table public.group_challenges drop constraint %I',
      v_constraint
    );
  end loop;
end;
$migration$;
alter table public.group_challenges
  add constraint group_challenges_audience_check
    check (audience in ('group', 'public')),
  add constraint group_challenges_participant_limit_check
    check (
      participant_limit is null
      or participant_limit between 2 and 5000
    ),
  add constraint group_challenges_participant_count_check
    check (
      (audience = 'group' and cardinality(participant_ids) >= 2)
      or (
        audience = 'public'
        and cardinality(participant_ids) between 1 and 5000
      )
    );

create index if not exists group_challenges_public_catalog_idx
  on public.group_challenges (end_date desc, local_date, created_at desc)
  where deleted_at is null and audience = 'public';
create index if not exists group_challenges_public_accepted_gin_idx
  on public.group_challenges using gin (accepted_participant_ids)
  where deleted_at is null and audience = 'public';

-- A public join is explicit consent to publish only the challenge aggregate,
-- not raw entries or the account snapshot. This projection lets accounts that
-- do not belong to any group participate without weakening group-data RLS.
create table if not exists public.public_challenge_totals (
  challenge_id uuid not null
    references public.group_challenges(id) on delete cascade,
  occurrence_date date not null,
  user_id uuid not null references public.profiles(id) on delete cascade,
  total numeric not null default 0
    check (abs(total) <= 1000000000000000),
  has_data boolean not null default false,
  synced_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (challenge_id, occurrence_date, user_id)
);
create index if not exists public_challenge_totals_user_idx
  on public.public_challenge_totals (user_id, updated_at desc);
alter table public.public_challenge_totals enable row level security;
revoke all on table public.public_challenge_totals
  from public, anon, authenticated;

create table if not exists public.public_challenge_participant_syncs (
  challenge_id uuid not null
    references public.group_challenges(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  synced_at timestamptz not null default now(),
  primary key (challenge_id, user_id)
);
alter table public.public_challenge_participant_syncs enable row level security;
revoke all on table public.public_challenge_participant_syncs
  from public, anon, authenticated;

drop policy if exists group_challenges_invited_read
  on public.group_challenges;
create policy group_challenges_invited_read
on public.group_challenges
for select
to authenticated
using (
  (select auth.uid()) = any(participant_ids)
  and (audience = 'public' or public.is_group_member(group_id))
);

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
);

create or replace function public.mark_group_notification_events_read(
  p_group_id uuid,
  p_event_ids uuid[]
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_updated integer := 0;
begin
  if v_user_id is null then
    raise exception 'Authentication required.' using errcode = '42501';
  end if;
  if cardinality(coalesce(p_event_ids, array[]::uuid[])) = 0 then return 0; end if;
  -- Recipient identity is the authorization boundary. This also lets a person
  -- acknowledge a public-challenge result without joining its source group.
  update public.group_notification_events event
     set read_at = coalesce(event.read_at, now())
   where event.group_id = p_group_id
     and event.recipient_id = v_user_id
     and event.id = any(p_event_ids)
     and event.read_at is null;
  get diagnostics v_updated = row_count;
  return v_updated;
end;
$$;

revoke all on function public.mark_group_notification_events_read(uuid, uuid[])
  from public, anon;
grant execute on function public.mark_group_notification_events_read(uuid, uuid[])
  to authenticated;

create or replace function public.publish_joined_public_challenge_totals(
  p_challenge_ids uuid[],
  p_rows jsonb
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_ids uuid[];
  v_written integer := 0;
begin
  if v_user_id is null then
    raise exception 'Authentication required.' using errcode = '42501';
  end if;
  select coalesce(array_agg(distinct challenge_id order by challenge_id), array[]::uuid[])
    into v_ids
    from unnest(coalesce(p_challenge_ids, array[]::uuid[])) item(challenge_id)
   where challenge_id is not null;
  if cardinality(v_ids) > 100 then
    raise exception 'Too many public challenges in one sync.' using errcode = '22023';
  end if;
  if p_rows is null or jsonb_typeof(p_rows) <> 'array'
     or jsonb_array_length(p_rows) > 500 then
    raise exception 'Public challenge totals are invalid.' using errcode = '22023';
  end if;

  if exists (
    select 1
      from unnest(v_ids) requested(challenge_id)
      left join public.group_challenges challenge
        on challenge.id = requested.challenge_id
       and challenge.audience = 'public'
       and challenge.deleted_at is null
       and v_user_id = any(challenge.accepted_participant_ids)
     where challenge.id is null
  ) then
    raise exception 'Public challenge participation is required.' using errcode = '42501';
  end if;

  -- Validate the whole batch set-wise before writing. Besides avoiding a
  -- per-row challenge lookup, requiring a row for every requested challenge
  -- makes the sync marker proof that its aggregate was refreshed atomically.
  if exists (
    with parsed as (
      select row."challengeId" as challenge_id,
             row."occurrenceDate" as occurrence_date,
             row.total,
             coalesce(row."hasData", false) as has_data
        from jsonb_to_recordset(p_rows) as row(
          "challengeId" uuid,
          "occurrenceDate" date,
          total numeric,
          "hasData" boolean
        )
    )
    select 1
      from parsed
      left join public.group_challenges challenge
        on challenge.id = parsed.challenge_id
     where parsed.challenge_id is null
        or not (parsed.challenge_id = any(v_ids))
        or parsed.occurrence_date is null
        or parsed.occurrence_date > current_date
        or (parsed.has_data and parsed.total is null)
        or abs(coalesce(parsed.total, 0)) > 1000000000000000
        or challenge.id is null
        or (
          (
            challenge.recurrence is null
            or challenge.recurrence ->> 'mode' = 'once'
          ) and parsed.occurrence_date <> challenge.local_date
        )
        or (
          challenge.recurrence is not null
          and challenge.recurrence ->> 'mode' <> 'once'
          and not public.group_challenge_occurs_on(
            challenge.recurrence,
            challenge.local_date,
            parsed.occurrence_date
          )
        )
  ) or exists (
    with parsed as (
      select row."challengeId" as challenge_id,
             row."occurrenceDate" as occurrence_date
        from jsonb_to_recordset(p_rows) as row(
          "challengeId" uuid,
          "occurrenceDate" date
        )
    )
    select 1
      from parsed
     group by parsed.challenge_id, parsed.occurrence_date
    having count(*) > 1
  ) or exists (
    with parsed as (
      select distinct row."challengeId" as challenge_id
        from jsonb_to_recordset(p_rows) as row("challengeId" uuid)
    )
    select 1
      from unnest(v_ids) requested(challenge_id)
     where not exists (
       select 1 from parsed where parsed.challenge_id = requested.challenge_id
     )
  ) then
    raise exception 'Public challenge total row is invalid.' using errcode = '22023';
  end if;

  insert into public.public_challenge_totals (
    challenge_id, occurrence_date, user_id,
    total, has_data, synced_at, updated_at
  )
  select row."challengeId", row."occurrenceDate", v_user_id,
         case when coalesce(row."hasData", false)
           then row.total else 0 end,
         coalesce(row."hasData", false),
         clock_timestamp(), clock_timestamp()
    from jsonb_to_recordset(p_rows) as row(
      "challengeId" uuid,
      "occurrenceDate" date,
      total numeric,
      "hasData" boolean
    )
  on conflict (challenge_id, occurrence_date, user_id) do update
    set total = excluded.total,
        has_data = excluded.has_data,
        synced_at = excluded.synced_at,
        updated_at = excluded.updated_at;
  get diagnostics v_written = row_count;

  insert into public.public_challenge_participant_syncs (
    challenge_id, user_id, synced_at
  )
  select requested.challenge_id, v_user_id, clock_timestamp()
    from unnest(v_ids) requested(challenge_id)
  on conflict (challenge_id, user_id) do update
    set synced_at = excluded.synced_at;
  return v_written;
end;
$$;

revoke all on function public.publish_joined_public_challenge_totals(uuid[], jsonb)
  from public, anon;
grant execute on function public.publish_joined_public_challenge_totals(uuid[], jsonb)
  to authenticated;

create or replace function public.list_public_challenges()
returns table (
  id uuid,
  group_id uuid,
  creator_id uuid,
  metric_slug text,
  title text,
  audience text,
  participant_limit integer,
  target_value numeric,
  local_date date,
  end_date date,
  participant_ids uuid[],
  accepted_participant_ids uuid[],
  declined_participant_ids uuid[],
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
  v_today date;
begin
  if v_user_id is null then
    raise exception 'Authentication required.' using errcode = '42501';
  end if;
  select (statement_timestamp() at time zone coalesce(zone.name, 'UTC'))::date
    into v_today
    from public.profiles profile
    left join pg_catalog.pg_timezone_names zone
      on zone.name = profile.timezone
   where profile.id = v_user_id;
  v_today := coalesce(v_today, current_date);

  return query
  select challenge.id,
         challenge.group_id,
         challenge.creator_id,
         challenge.metric_slug,
         challenge.title,
         challenge.audience,
         challenge.participant_limit,
         challenge.target_value,
         challenge.local_date,
         challenge.end_date,
         case
           when v_user_id = any(challenge.participant_ids)
             then challenge.participant_ids
           else array[]::uuid[]
         end,
         case
           when v_user_id = any(challenge.participant_ids)
             then challenge.accepted_participant_ids
           else array[]::uuid[]
         end,
         case
           when v_user_id = any(challenge.participant_ids)
             then challenge.declined_participant_ids
           else array[]::uuid[]
         end,
         challenge.recurrence,
         cardinality(challenge.participant_ids),
         cardinality(challenge.accepted_participant_ids),
         case
           when v_user_id = challenge.creator_id then 'creator'
           when v_user_id = any(challenge.accepted_participant_ids) then 'accepted'
           when v_user_id = any(challenge.declined_participant_ids) then 'declined'
           else 'not_invited'
         end,
         (
           public.group_challenge_join_deadline(challenge) >= v_today
           and not (v_user_id = any(challenge.accepted_participant_ids))
           and (
             v_user_id = any(challenge.participant_ids)
             or cardinality(challenge.participant_ids) < 5000
           )
           and (
             challenge.participant_limit is null
             or cardinality(challenge.accepted_participant_ids)
               < challenge.participant_limit
           )
         ),
         (
           cardinality(challenge.participant_ids) >= 5000
           or (
             challenge.participant_limit is not null
             and cardinality(challenge.accepted_participant_ids)
               >= challenge.participant_limit
           )
         ),
         challenge.created_at,
         challenge.updated_at
    from public.group_challenges challenge
   where challenge.audience = 'public'
     and challenge.deleted_at is null
     and public.group_challenge_join_deadline(challenge) >= v_today - 366
   order by
     case
       when public.group_challenge_join_deadline(challenge) >= v_today then 0
       else 1
     end,
     challenge.local_date,
     challenge.created_at desc
   limit 250;
end;
$$;

revoke all on function public.list_public_challenges()
  from public, anon, authenticated;
grant execute on function public.list_public_challenges()
  to authenticated;

create or replace function public.save_public_challenge(
  p_challenge_id uuid,
  p_group_id uuid,
  p_metric_slug text,
  p_title text,
  p_target_value numeric,
  p_local_date date,
  p_end_date date,
  p_participant_ids uuid[],
  p_recurrence jsonb,
  p_participant_limit integer
)
returns public.group_challenges
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_existing public.group_challenges;
  v_saved public.group_challenges;
  v_end_date date := coalesce(p_end_date, p_local_date);
  v_mode text;
  v_recurrence_end date;
begin
  if v_user_id is null then
    raise exception 'Authentication required.' using errcode = '42501';
  end if;
  if not public.is_group_member(p_group_id) then
    raise exception 'An active HabHub account is required.' using errcode = '42501';
  end if;
  if p_challenge_id is not null then
    select * into v_existing
      from public.group_challenges challenge
     where challenge.id = p_challenge_id
       and challenge.audience = 'public'
       and challenge.deleted_at is null
     for update;
    if not found then
      raise exception 'Public challenge not found.' using errcode = 'P0002';
    end if;
    if v_existing.creator_id <> v_user_id then
      raise exception 'Only the creator can edit a public challenge.'
        using errcode = '42501';
    end if;
    if public.group_challenge_join_deadline(v_existing) < current_date - 1 then
      raise exception 'Finished challenges cannot be edited.' using errcode = '22023';
    end if;
  end if;
  if p_target_value is not null
     and (p_target_value <= 0 or p_target_value > 1000000000000) then
    raise exception 'Challenge target must be greater than zero.' using errcode = '22023';
  end if;
  if p_local_date is null or v_end_date < p_local_date
     or v_end_date > p_local_date + 366 then
    raise exception 'Choose an end date within one year of the start date.'
      using errcode = '22023';
  end if;
  if p_challenge_id is null and p_local_date < current_date - 1 then
    raise exception 'Choose today or a future challenge date.' using errcode = '22023';
  end if;
  if p_title is not null
     and (char_length(btrim(p_title)) < 1 or char_length(btrim(p_title)) > 80) then
    raise exception 'Challenge title must contain 1 to 80 characters.'
      using errcode = '22023';
  end if;
  if p_participant_limit is not null
     and p_participant_limit not between 2 and 5000 then
    raise exception 'Participant limit must be between 2 and 5,000.'
      using errcode = '22023';
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
    raise exception 'Choose an active numerical tracker.' using errcode = '22023';
  end if;

  if p_recurrence is not null then
    if v_end_date <> p_local_date or jsonb_typeof(p_recurrence) <> 'object' then
      raise exception 'Repeating challenges must use a valid one-day scoring period.'
        using errcode = '22023';
    end if;
    v_mode := p_recurrence ->> 'mode';
    if v_mode is null or v_mode not in (
      'daily', 'selected_days', 'every_other_day',
      'interval_days', 'days_of_month'
    ) then
      raise exception 'Challenge repeat settings are invalid.' using errcode = '22023';
    end if;
    if coalesce(p_recurrence ->> 'anchorDate', '') <> p_local_date::text
       or coalesce(p_recurrence ->> 'endDate', '')
         !~ '^[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]$' then
      raise exception 'Challenge repeat dates are invalid.' using errcode = '22023';
    end if;
    begin
      v_recurrence_end := (p_recurrence ->> 'endDate')::date;
    exception when others then
      raise exception 'Challenge repeat dates are invalid.' using errcode = '22023';
    end;
    if v_recurrence_end < p_local_date
       or v_recurrence_end > p_local_date + 366 then
      raise exception 'Challenge repeat must end within one year.' using errcode = '22023';
    end if;
    if v_mode = 'selected_days' and (
      jsonb_typeof(p_recurrence -> 'daysOfWeek') is distinct from 'array'
      or jsonb_array_length(p_recurrence -> 'daysOfWeek') = 0
      or exists (
        select 1
          from jsonb_array_elements_text(p_recurrence -> 'daysOfWeek') item(value)
         where item.value !~ '^[0-6]$'
      )
    ) then
      raise exception 'Challenge repeat weekdays are invalid.' using errcode = '22023';
    end if;
    if v_mode = 'days_of_month' and (
      jsonb_typeof(p_recurrence -> 'daysOfMonth') is distinct from 'array'
      or jsonb_array_length(p_recurrence -> 'daysOfMonth') = 0
      or exists (
        select 1
          from jsonb_array_elements_text(p_recurrence -> 'daysOfMonth') item(value)
         where case
           when item.value ~ '^[0-9][0-9]?$'
             then item.value::integer not between 1 and 31
           else true
         end
      )
    ) then
      raise exception 'Challenge repeat days are invalid.' using errcode = '22023';
    end if;
    if v_mode = 'interval_days' and (
      case
        when coalesce(p_recurrence ->> 'intervalDays', '') ~ '^[0-9][0-9]?$'
          then (p_recurrence ->> 'intervalDays')::integer not between 2 and 31
        else true
      end
    ) then
      raise exception 'Challenge repeat interval is invalid.' using errcode = '22023';
    end if;
  end if;

  if p_challenge_id is not null
     and v_existing.local_date < current_date
     and (
       p_metric_slug is distinct from v_existing.metric_slug
       or p_target_value is distinct from v_existing.target_value
       or p_local_date is distinct from v_existing.local_date
       or v_end_date is distinct from v_existing.end_date
       or p_recurrence is distinct from v_existing.recurrence
     ) then
    raise exception 'Started challenge scoring rules are locked.' using errcode = '22023';
  end if;

  if p_challenge_id is null then
    insert into public.group_challenges (
      group_id, creator_id, metric_slug, title, audience,
      participant_limit, target_value, local_date, end_date,
      participant_ids, accepted_participant_ids,
      declined_participant_ids, recurrence
    ) values (
      p_group_id, v_user_id, p_metric_slug, nullif(btrim(p_title), ''),
      'public', p_participant_limit, p_target_value, p_local_date, v_end_date,
      array[v_user_id], array[v_user_id], array[]::uuid[], p_recurrence
    ) returning * into v_saved;
  else
    if p_participant_limit is not null
       and cardinality(v_existing.accepted_participant_ids) > p_participant_limit then
      raise exception 'The limit cannot exclude people who already joined.'
        using errcode = '22023';
    end if;
    update public.group_challenges
       set metric_slug = p_metric_slug,
           title = nullif(btrim(p_title), ''),
           participant_limit = p_participant_limit,
           target_value = p_target_value,
           local_date = p_local_date,
           end_date = v_end_date,
           recurrence = p_recurrence
     where id = p_challenge_id
     returning * into v_saved;
  end if;
  return v_saved;
end;
$$;

revoke all on function public.save_public_challenge(
  uuid, uuid, text, text, numeric, date, date, uuid[], jsonb, integer
) from public, anon;
grant execute on function public.save_public_challenge(
  uuid, uuid, text, text, numeric, date, date, uuid[], jsonb, integer
) to authenticated;

-- Preserve the established response mutation for group challenges and allow
-- any authenticated account to join a public challenge without approval.
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
  v_was_participant boolean;
  v_participants uuid[];
  v_accepted uuid[];
  v_declined uuid[];
begin
  if v_user_id is null then
    raise exception 'Authentication required.' using errcode = '42501';
  end if;
  select (statement_timestamp() at time zone coalesce(zone.name, 'UTC'))::date
    into v_local_today
    from public.profiles profile
    left join pg_catalog.pg_timezone_names zone on zone.name = profile.timezone
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
  if v_challenge.audience = 'group' then
    perform 1
      from public.group_members member
     where member.group_id = v_challenge.group_id
       and member.user_id = v_user_id
       and member.status = 'active'
     for update;
    if not found then
      raise exception 'Active group membership required.' using errcode = '42501';
    end if;
  end if;
  if v_user_id = v_challenge.creator_id then return v_challenge; end if;
  if p_accept is null then
    raise exception 'Choose whether to accept or decline.' using errcode = '22023';
  end if;
  if public.group_challenge_join_deadline(v_challenge) < v_local_today then
    raise exception 'This challenge has finished.' using errcode = '22023';
  end if;

  v_was_participant := v_user_id = any(v_challenge.participant_ids);
  if p_accept then
    if not v_was_participant and (
      (v_challenge.audience = 'group'
       and cardinality(v_challenge.participant_ids) >= 50)
      or (v_challenge.audience = 'public'
          and cardinality(v_challenge.participant_ids) >= 5000)
      or (
        v_challenge.participant_limit is not null
        and cardinality(v_challenge.accepted_participant_ids)
          >= v_challenge.participant_limit
      )
    ) then
      raise exception 'This challenge is full.' using errcode = '22023';
    end if;
    select coalesce(array_agg(distinct candidate order by candidate), array[]::uuid[])
      into v_participants
      from unnest(v_challenge.participant_ids || array[v_user_id]) joined(candidate);
    select coalesce(array_agg(distinct candidate order by candidate), array[]::uuid[])
      into v_accepted
      from unnest(v_challenge.accepted_participant_ids || array[v_user_id]) joined(candidate);
    v_declined := array_remove(v_challenge.declined_participant_ids, v_user_id);
    update public.group_challenges
       set participant_ids = v_participants,
           accepted_participant_ids = v_accepted,
           declined_participant_ids = v_declined
     where id = p_challenge_id
     returning * into v_challenge;
  else
    if not v_was_participant then
      raise exception 'Join the challenge before declining it.' using errcode = '42501';
    end if;
    select coalesce(array_agg(distinct candidate order by candidate), array[]::uuid[])
      into v_declined
      from unnest(v_challenge.declined_participant_ids || array[v_user_id]) joined(candidate);
    v_accepted := array_remove(v_challenge.accepted_participant_ids, v_user_id);
    update public.group_challenges
       set declined_participant_ids = v_declined,
           accepted_participant_ids = v_accepted
     where id = p_challenge_id
     returning * into v_challenge;
  end if;
  return v_challenge;
end;
$$;

revoke all on function public.respond_group_challenge(uuid, boolean)
  from public, anon;
grant execute on function public.respond_group_challenge(uuid, boolean)
  to authenticated;


-- The canonical scorer supports public participants without adding them to the
-- creator's group. One exact group-visible daily status is chosen per person
-- and date so an account represented in several groups is never double-counted.
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
  standing_position bigint,
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
      left join public.group_members member
        on member.group_id = challenge.group_id
       and member.user_id = accepted.user_id
       and member.status = 'active'
     where challenge.audience = 'public' or member.user_id is not null
  ),
  status_candidates as (
    select participant.user_id,
           status.local_date,
           status.exact_value,
           status.visibility,
           status.has_data,
           status.updated_at,
           row_number() over (
             partition by participant.user_id, status.local_date
             order by
               case when status.group_id = challenge.group_id then 0 else 1 end,
               status.updated_at desc,
               status.group_id
           ) as preference
      from challenge
      join participant on true
      join public.daily_metric_status status
        on status.user_id = participant.user_id
       and status.local_date between challenge.period_start and challenge.period_end
      join public.metric_definitions candidate_definition
        on candidate_definition.id = status.metric_id
       and candidate_definition.slug = challenge.metric_slug
       and candidate_definition.archived_at is null
     where challenge.audience = 'public'
        or (
          status.group_id = challenge.group_id
          and status.metric_id = challenge.metric_id
        )
  ),
  selected_status as (
    select * from status_candidates where preference = 1
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
               join public.metric_definitions prior_definition
                 on prior_definition.id = prior.metric_id
                and prior_definition.slug = challenge.metric_slug
                and prior_definition.archived_at is null
              where prior.user_id = participant.user_id
                and prior.local_date < challenge.period_start
                and prior.visibility::text = 'group'
                and prior.exact_value is not null
                and (
                  challenge.audience = 'public'
                  or (
                    prior.group_id = challenge.group_id
                    and prior.metric_id = challenge.metric_id
                  )
                )
              order by
                prior.local_date desc,
                case when prior.group_id = challenge.group_id then 0 else 1 end,
                prior.updated_at desc
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
      left join selected_status status on status.user_id = participant.user_id
     group by participant.user_id, profile.display_name,
              challenge.group_id, challenge.metric_id,
              challenge.metric_slug, challenge.period_start,
              challenge.ranking_direction, challenge.audience
  ),
  relational_totals as (
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
  projected_totals as (
    select participant.user_id,
           coalesce(profile.display_name, 'A friend') as display_name,
           projection.total,
           case when projection.has_data then 1 else 0 end::bigint as exact_days,
           false as has_private
      from challenge
      join participant on true
      left join public.profiles profile on profile.id = participant.user_id
      join public.public_challenge_totals projection
        on projection.challenge_id = challenge.id
       and projection.occurrence_date = challenge.period_start
       and projection.user_id = participant.user_id
     where challenge.audience = 'public'
  ),
  totals as (
    select relational.*
      from relational_totals relational
      cross join challenge
     where challenge.audience <> 'public'
        or not exists (
          select 1
            from public.public_challenge_totals projection
           where projection.challenge_id = challenge.id
             and projection.occurrence_date = challenge.period_start
             and projection.user_id = relational.user_id
        )
    union all
    select projected.* from projected_totals projected
  ),
  visible as (
    select totals.*
      from totals
     where totals.exact_days > 0
       and not exists (
         select 1 from totals private where coalesce(private.has_private, false)
       )
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
           row_number() over (order by scored.sort_value, scored.user_id)
             as standing_position,
           count(*) over () as competitor_count,
           min(scored.sort_value) filter (where scored.eligible) over ()
             as winning_value
      from scored
  )
  select ranked.user_id, ranked.display_name, ranked.total,
         ranked.sort_value as rank_value, ranked.standing_position,
         ranked.competitor_count >= 2
           and ranked.eligible
           and ranked.sort_value = ranked.winning_value as winner
    from ranked
   order by ranked.standing_position;
$$;

revoke all on function public.group_challenge_exact_standings(uuid, date, date)
  from public, anon, authenticated;
grant execute on function public.group_challenge_exact_standings(uuid, date, date)
  to service_role;

-- Name the accepting person in both the private feed and canonical push.
create or replace function public.name_group_challenge_acceptance()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid;
  v_name text;
  v_key text;
begin
  if new.deleted_at is not null then return new; end if;
  for v_user_id in
    select accepted.user_id
      from unnest(coalesce(new.accepted_participant_ids, array[]::uuid[])) accepted(user_id)
    except
    select accepted.user_id
      from unnest(coalesce(old.accepted_participant_ids, array[]::uuid[])) accepted(user_id)
  loop
    if v_user_id = new.creator_id then continue; end if;
    select coalesce(nullif(btrim(profile.display_name), ''), 'A friend')
      into v_name
      from public.profiles profile
     where profile.id = v_user_id;
    v_name := coalesce(v_name, 'A friend');
    v_key := 'challenge-accepted:' || new.id::text || ':' || v_user_id::text;
    update public.group_notification_events event
       set detail = left(v_name || ' accepted your challenge.', 500)
     where event.recipient_id = new.creator_id
       and event.event_key = v_key;
    update public.push_dispatch_events event
       set body = left(v_name || ' accepted your challenge.', 500),
           data = coalesce(event.data, '{}'::jsonb)
             || jsonb_build_object('acceptingName', v_name)
     where event.event_key = v_key
       and event.dispatched_at is null;
  end loop;
  return new;
end;
$$;

revoke all on function public.name_group_challenge_acceptance()
  from public, anon, authenticated;
drop trigger if exists zz_group_challenges_name_acceptance
  on public.group_challenges;
create trigger zz_group_challenges_name_acceptance
after update of accepted_participant_ids
on public.group_challenges
for each row execute function public.name_group_challenge_acceptance();

-- Patch the installed worker conservatively: completion now requires every
-- accepted participant to publish after their local end-of-day boundary, and
-- one durable waiting notification identifies accounts still outstanding.
do $migration$
declare
  v_definition text;
  v_old_pending text := $old$
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
$old$;
  v_new_pending text := $new$
             from unnest(occurrence.accepted_participant_ids) accepted(user_id)
             left join public.group_members member
               on member.group_id = occurrence.group_id
              and member.user_id = accepted.user_id
              and member.status = 'active'
             left join public.group_challenge_notification_state state
               on state.challenge_id = occurrence.id
              and state.occurrence_date = occurrence.occurrence_date
              and state.recipient_id = accepted.user_id
            where (occurrence.audience = 'public' or member.user_id is not null)
              and state.result_notified_at is null
$new$;
  v_old_sync text := $old$
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
$old$;
  v_new_sync text := $new$
    select coalesce(
             bool_and(
               (v_settlement_at at time zone coalesce(valid_timezone.name, 'UTC'))::date
                 > v_challenge.occurrence_end_date
               and coalesce(
                     case when v_challenge.audience = 'public'
                       then challenge_projection.synced_at
                       else member.last_data_synced_at
                     end,
                     '-infinity'::timestamptz
                   ) >= (
                     (v_challenge.occurrence_end_date + 1)::timestamp
                       at time zone coalesce(valid_timezone.name, 'UTC')
                   )
             ),
             false
           ),
           string_agg(
             coalesce(nullif(btrim(profile.display_name), ''), 'A participant'),
             ', ' order by coalesce(profile.display_name, accepted.user_id::text)
           ) filter (where
             coalesce(
               case when v_challenge.audience = 'public'
                 then challenge_projection.synced_at
                 else member.last_data_synced_at
               end,
               '-infinity'::timestamptz
             ) < (
               (v_challenge.occurrence_end_date + 1)::timestamp
                 at time zone coalesce(valid_timezone.name, 'UTC')
             )
           )
      into v_all_participants_finished, v_waiting_names
      from unnest(v_challenge.accepted_participant_ids) accepted(user_id)
      left join public.group_members member
        on member.group_id = v_challenge.group_id
       and member.user_id = accepted.user_id
       and member.status = 'active'
      left join public.public_challenge_participant_syncs challenge_projection
        on challenge_projection.challenge_id = v_challenge.id
       and challenge_projection.user_id = accepted.user_id
      left join public.profiles profile on profile.id = accepted.user_id
      left join pg_catalog.pg_timezone_names valid_timezone
        on valid_timezone.name = profile.timezone
     where v_challenge.audience = 'public' or member.user_id is not null;
$new$;
  v_old_recipient text := $old$
        from unnest(v_challenge.accepted_participant_ids) accepted(user_id)
        join public.group_members member
          on member.group_id = v_challenge.group_id
         and member.user_id = accepted.user_id
         and member.status = 'active'
        left join public.profiles profile on profile.id = member.user_id
        left join pg_catalog.pg_timezone_names valid_timezone
          on valid_timezone.name = profile.timezone
$old$;
  v_new_recipient text := $new$
        from unnest(v_challenge.accepted_participant_ids) accepted(user_id)
        left join public.group_members member
          on member.group_id = v_challenge.group_id
         and member.user_id = accepted.user_id
         and member.status = 'active'
        left join public.profiles profile on profile.id = accepted.user_id
        left join pg_catalog.pg_timezone_names valid_timezone
          on valid_timezone.name = profile.timezone
       where v_challenge.audience = 'public' or member.user_id is not null
$new$;
  v_old_finished text := $old$
      if v_recipient.local_today > v_challenge.occurrence_end_date then
        if v_all_participants_finished and v_state.result_notified_at is null then
$old$;
  v_new_finished text := $new$
      if v_recipient.local_today > v_challenge.occurrence_end_date then
        if not v_all_participants_finished then
          v_title := 'Waiting for challenge results';
          v_detail := left(
            'Waiting for ' || coalesce(v_waiting_names, 'participants') ||
              ' to sync after the challenge ended.',
            500
          );
          v_event_key := 'challenge-waiting-sync:' || v_challenge.id::text || ':' ||
            v_challenge.occurrence_date::text || ':' || v_recipient.user_id::text;
          insert into public.group_notification_events (
            event_key, group_id, recipient_id, actor_id, event_type,
            challenge_id, occurrence_date, title, detail
          ) values (
            v_event_key, v_challenge.group_id, v_recipient.user_id,
            v_challenge.creator_id, 'challenge_reminder', v_challenge.id,
            v_challenge.occurrence_date, v_title, v_detail
          ) on conflict on constraint group_notification_events_recipient_id_event_key_key
            do update set detail = excluded.detail;
          insert into public.push_dispatch_events (
            event_key, group_id, dispatcher_id, category, event_type,
            audience, recipient_id, metric_slug, title, body, data, expires_at
          ) values (
            v_event_key, v_challenge.group_id, v_challenge.creator_id,
            'challenge', 'challenge_reminder', 'user', v_recipient.user_id,
            v_challenge.metric_slug, v_title, v_detail,
            jsonb_build_object(
              'route', case when v_challenge.audience = 'public'
                then '/challenges' else '/group' end,
              'groupId', v_challenge.group_id,
              'challengeId', v_challenge.id,
              'challengeOccurrenceDate', v_challenge.occurrence_date,
              'challengeEvent', 'waiting_sync'
            ),
            clock_timestamp() + interval '7 days'
          ) on conflict on constraint push_dispatch_events_event_key_key do nothing
            returning push_dispatch_events.event_key into v_inserted;
          if v_inserted is not null then
            event_key := v_inserted;
            return next;
            v_inserted := null;
          end if;
          continue;
        end if;
        if v_all_participants_finished and v_state.result_notified_at is null then
$new$;
  v_old_result_detail text := $old$
          v_detail := 'The challenge is complete. Open the Leaderboard to see the final standings.';
$old$;
  v_new_result_detail text := $new$
          select ranked.* into v_self
            from (
              select standing.*, count(*) over () as competitor_count
                from public.group_challenge_exact_standings(
                  v_challenge.id,
                  v_challenge.occurrence_date,
                  v_challenge.occurrence_end_date
                ) standing
            ) ranked
           where ranked.user_id = v_recipient.user_id;
          v_detail := 'The challenge is complete. Open the Leaderboard to see the final standings.' ||
            case when v_self.user_id is not null
              then ' You placed #' || v_self.standing_position::text ||
                ' of ' || v_self.competitor_count::text || '.'
              else ''
            end;
$new$;
  v_old_result_route text := $old$
            jsonb_build_object(
              'route', '/group', 'groupId', v_challenge.group_id,
              'challengeId', v_challenge.id,
              'challengeOccurrenceDate', v_challenge.occurrence_date,
              'challengeEvent', 'result'
            ),
$old$;
  v_new_result_route text := $new$
            jsonb_build_object(
              'route', case when v_challenge.audience = 'public'
                then '/challenges' else '/group' end,
              'groupId', v_challenge.group_id,
              'challengeId', v_challenge.id,
              'challengeOccurrenceDate', v_challenge.occurrence_date,
              'challengeEvent', 'result'
            ),
$new$;
  v_old_live_route text := $old$
          jsonb_build_object(
            'route', '/group', 'groupId', v_challenge.group_id,
            'challengeId', v_challenge.id,
            'challengeOccurrenceDate', v_challenge.occurrence_date,
            'challengeEvent', case
              when v_kind = 'challenge_standing' then 'standing'
              else 'reminder'
            end
          ),
$old$;
  v_new_live_route text := $new$
          jsonb_build_object(
            'route', case when v_challenge.audience = 'public'
              then '/challenges' else '/group' end,
            'groupId', v_challenge.group_id,
            'challengeId', v_challenge.id,
            'challengeOccurrenceDate', v_challenge.occurrence_date,
            'challengeEvent', case
              when v_kind = 'challenge_standing' then 'standing'
              else 'reminder'
            end
          ),
$new$;
begin
  select pg_catalog.pg_get_functiondef(
           'public.stage_group_challenge_notifications(integer)'::regprocedure
         ) into v_definition;
  if pg_catalog.strpos(v_definition, '  v_all_participants_finished boolean;') = 0
     or pg_catalog.strpos(v_definition, v_old_pending) = 0
     or pg_catalog.strpos(v_definition, v_old_sync) = 0
     or pg_catalog.strpos(v_definition, v_old_recipient) = 0
     or pg_catalog.strpos(v_definition, v_old_finished) = 0
     or pg_catalog.strpos(v_definition, v_old_result_detail) = 0
     or pg_catalog.strpos(v_definition, v_old_result_route) = 0
     or pg_catalog.strpos(v_definition, v_old_live_route) = 0 then
    raise exception 'Unexpected challenge notification worker shape'
      using errcode = 'P0001';
  end if;
  v_definition := replace(
    v_definition,
    '  v_all_participants_finished boolean;',
    '  v_all_participants_finished boolean;' || chr(10) ||
      '  v_waiting_names text;'
  );
  v_definition := replace(v_definition, v_old_pending, v_new_pending);
  v_definition := replace(v_definition, v_old_sync, v_new_sync);
  v_definition := replace(v_definition, v_old_recipient, v_new_recipient);
  v_definition := replace(v_definition, v_old_finished, v_new_finished);
  v_definition := replace(
    v_definition,
    v_old_result_detail,
    v_new_result_detail
  );
  v_definition := replace(v_definition, v_old_result_route, v_new_result_route);
  v_definition := replace(v_definition, v_old_live_route, v_new_live_route);
  execute v_definition;
end;
$migration$;

notify pgrst, 'reload schema';
