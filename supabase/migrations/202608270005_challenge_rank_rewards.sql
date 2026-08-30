-- Personal challenge visibility and withdrawal state is private account data.
-- Create it before the scoring helpers so a recurring withdrawal can apply to
-- future occurrences without rewriting an earlier occurrence's participant
-- roster while that result is still waiting to settle.
create table if not exists public.group_challenge_user_preferences (
  challenge_id uuid not null
    references public.group_challenges(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  hidden boolean not null default false,
  pinned boolean not null default false,
  withdrawn_at timestamptz,
  withdrawn_from_date date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (challenge_id, user_id)
);

create index if not exists group_challenge_user_preferences_user_idx
  on public.group_challenge_user_preferences (user_id, updated_at desc);

alter table public.group_challenge_user_preferences enable row level security;
revoke all on table public.group_challenge_user_preferences
  from public, anon, authenticated;
grant select on table public.group_challenge_user_preferences to authenticated;

drop policy if exists group_challenge_user_preferences_owner_read
  on public.group_challenge_user_preferences;
create policy group_challenge_user_preferences_owner_read
on public.group_challenge_user_preferences
for select
to authenticated
using (user_id = (select auth.uid()));

-- All challenge lifecycle comparisons use the signed-in account's day. The
-- UTC fallback is deterministic for credential-free/service contexts and for
-- legacy profiles whose timezone is missing or invalid.
create or replace function public.challenge_account_local_date(p_user_id uuid)
returns date
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (
      select (statement_timestamp() at time zone valid_timezone.name)::date
        from public.profiles profile
        join pg_catalog.pg_timezone_names valid_timezone
          on valid_timezone.name = profile.timezone
       where profile.id = p_user_id
    ),
    (statement_timestamp() at time zone 'UTC')::date
  );
$$;

revoke all on function public.challenge_account_local_date(uuid)
  from public, anon, authenticated;

-- A recurring-series withdrawal starts on one local occurrence date. Keeping
-- the accepted roster intact preserves every earlier occurrence that has not
-- settled yet; consumers use this helper to omit only current/future dates.
create or replace function public.group_challenge_occurrence_participant_ids(
  p_challenge_id uuid,
  p_occurrence_date date
)
returns table (user_id uuid)
language sql
stable
security definer
set search_path = ''
as $$
  select accepted.user_id
    from public.group_challenges challenge
    cross join lateral unnest(challenge.accepted_participant_ids)
      accepted(user_id)
   where challenge.id = p_challenge_id
     and challenge.deleted_at is null
     and not exists (
       select 1
         from public.group_challenge_user_preferences preference
        where preference.challenge_id = challenge.id
          and preference.user_id = accepted.user_id
          and preference.withdrawn_at is not null
          and preference.withdrawn_from_date is not null
          and preference.withdrawn_from_date <= p_occurrence_date
     );
$$;

revoke all on function public.group_challenge_occurrence_participant_ids(
  uuid, date
) from public, anon, authenticated;

-- Competition ranks share a place for equal scoring values (1, 1, 3). Patch
-- the already-installed scorer narrowly so every result consumer agrees.
do $migration$
declare
  v_definition text;
  v_old_rank text := 'row_number() over (order by scored.sort_value, scored.user_id)';
  v_new_rank text := 'rank() over (order by scored.sort_value)';
  v_old_participants text := 'unnest(challenge.accepted_participant_ids)';
  v_new_participants text :=
    'public.group_challenge_occurrence_participant_ids(' ||
    'challenge.id, challenge.period_start)';
begin
  select pg_catalog.pg_get_functiondef(
           'public.group_challenge_exact_standings(uuid,date,date)'::regprocedure
         )
    into v_definition;
  if pg_catalog.strpos(v_definition, v_old_rank) = 0
     or pg_catalog.strpos(v_definition, v_old_participants) = 0 then
    raise exception 'Unexpected challenge standings rank shape'
      using errcode = 'P0001';
  end if;
  v_definition := replace(v_definition, v_old_rank, v_new_rank);
  v_definition := replace(
    v_definition,
    v_old_participants,
    v_new_participants
  );
  execute v_definition;
end;
$migration$;

-- A public competition can only use a built-in slug whose meaning is shared
-- by every account. Keep this predicate reusable so the forward guard and the
-- legacy repair cannot drift apart.
create or replace function public.is_public_challenge_metric_slug(p_slug text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_slug = any(array[
    'steps','food','exercise','deficit','energy_burned','water','workout',
    'weight','protein','fat','carbs','fiber','sodium','workout_duration',
    'body_fat','lean_body_mass','body_water_mass','bone_mass',
    'blood_pressure_systolic','blood_pressure_diastolic','pulse',
    'workout_distance','sugar','saturated_fat','cholesterol','potassium',
    'calcium','iron','magnesium','vitamin_c','vitamin_d','vitamin_b12',
    'sugar_alcohol','starch','trans_fat','monounsaturated_fat',
    'polyunsaturated_fat','omega_3','omega_6','phosphorus','zinc','copper',
    'manganese','selenium','iodine','chloride','chromium','molybdenum',
    'vitamin_a','vitamin_e','vitamin_k','vitamin_b1','vitamin_b2',
    'vitamin_b3','vitamin_b5','vitamin_b6','vitamin_b9','folic_acid',
    'biotin','alcohol','caffeine','weekly_deficit_balance','sleep',
    'blood_glucose','menstrual_cycle','menstrual_flow','cycle_day',
    'days_until_period','overall_score','todo_completion',
    'intermittent_fasting','reading','study','work','screen_time'
  ]::text[]);
$$;

revoke all on function public.is_public_challenge_metric_slug(text)
  from public, anon, authenticated;

-- Group discovery can safely hold a creator-only legacy row until another
-- active group member joins it. Normal creation RPC validation still requires
-- the intended multi-person participant list.
alter table public.group_challenges
  drop constraint if exists group_challenges_participant_count_check;
alter table public.group_challenges
  add constraint group_challenges_participant_count_check
    check (
      (
        audience = 'group'
        and cardinality(participant_ids) between 1 and 50
      )
      or (
        audience = 'public'
        and cardinality(participant_ids) between 1 and 5000
      )
    );

-- Rows created while public challenges temporarily accepted custom metrics
-- are not portable across accounts. Preserve them and their history, but move
-- them back behind their source group's membership boundary. Public challenges
-- could contain thousands of accounts, so retain only the creator and up to 49
-- original participants who are still active members of that source group.
-- This restores the same hard 50-person invariant as every normal group
-- challenge and keeps durable result pages provably below the API row cap.
with bounded_legacy_participants as (
  select challenge.id,
         array(
           select candidate.user_id
             from (
               select challenge.creator_id as user_id, 0 as priority
               union all
               select member.user_id, 1 as priority
                 from public.group_members member
                where member.group_id = challenge.group_id
                  and member.status = 'active'
                  and member.user_id = any(challenge.participant_ids)
                  and member.user_id <> challenge.creator_id
             ) candidate
            group by candidate.user_id
            order by min(candidate.priority), candidate.user_id
            limit 50
         )::uuid[] as participant_ids
    from public.group_challenges challenge
   where challenge.audience = 'public'
     and not public.is_public_challenge_metric_slug(challenge.metric_slug)
)
update public.group_challenges challenge
   set audience = 'group',
       participant_limit = null,
       participant_ids = bounded.participant_ids,
       accepted_participant_ids = array(
         select participant.user_id
           from unnest(bounded.participant_ids) participant(user_id)
          where participant.user_id = challenge.creator_id
             or participant.user_id = any(challenge.accepted_participant_ids)
          order by participant.user_id
       ),
       declined_participant_ids = array(
         select participant.user_id
           from unnest(bounded.participant_ids) participant(user_id)
          where participant.user_id <> challenge.creator_id
            and participant.user_id = any(challenge.declined_participant_ids)
          order by participant.user_id
       )
  from bounded_legacy_participants bounded
 where challenge.id = bounded.id;

create or replace function public.enforce_public_challenge_metric_portability()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.audience = 'public'
     and not public.is_public_challenge_metric_slug(new.metric_slug) then
    raise exception 'Public challenges require a built-in tracker.'
      using errcode = '22023';
  end if;
  return new;
end;
$$;

revoke all on function public.enforce_public_challenge_metric_portability()
  from public, anon, authenticated;
drop trigger if exists group_challenges_public_metric_portability
  on public.group_challenges;
create trigger group_challenges_public_metric_portability
before insert or update of audience, metric_slug on public.group_challenges
for each row execute function public.enforce_public_challenge_metric_portability();

-- The legacy challenge-level marker cannot prove which recurring occurrence
-- was refreshed. Keep it intact for zero-downtime compatibility with the
-- previously deployed Edge worker, while all new settlement paths use this
-- occurrence-scoped table. Deploying the database before the Edge function is
-- therefore safe in either order.
create table if not exists public.public_challenge_occurrence_syncs (
  challenge_id uuid not null
    references public.group_challenges(id) on delete cascade,
  occurrence_date date not null,
  user_id uuid not null references public.profiles(id) on delete cascade,
  synced_at timestamptz not null default now(),
  source_updated_at timestamptz,
  primary key (challenge_id, occurrence_date, user_id)
);
create index if not exists public_challenge_occurrence_syncs_user_idx
  on public.public_challenge_occurrence_syncs
    (user_id, occurrence_date desc, challenge_id);
alter table public.public_challenge_occurrence_syncs enable row level security;
revoke all on table public.public_challenge_occurrence_syncs
  from public, anon, authenticated;

-- A private, aggregate-only cache lets group-less public participants be
-- scored without reparsing their full account snapshot once per challenge.
-- It stores one strict group-visible daily value plus a restricted-source bit;
-- raw entries, labels, notes, and photos never leave the owner snapshot.
create table if not exists public.public_challenge_snapshot_daily_cache (
  user_id uuid not null references public.profiles(id) on delete cascade,
  metric_slug text not null,
  local_date date not null,
  exact_value numeric,
  has_group boolean not null,
  has_restricted boolean not null,
  source_updated_at timestamptz not null,
  primary key (user_id, metric_slug, local_date)
);
alter table public.public_challenge_snapshot_daily_cache enable row level security;
revoke all on table public.public_challenge_snapshot_daily_cache
  from public, anon, authenticated;

create table if not exists public.public_challenge_snapshot_cache_state (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  source_updated_at timestamptz,
  metric_fingerprint text,
  updated_at timestamptz not null default clock_timestamp()
);
alter table public.public_challenge_snapshot_cache_state enable row level security;
revoke all on table public.public_challenge_snapshot_cache_state
  from public, anon, authenticated;

create or replace function public.refresh_public_challenge_snapshot_cache(
  p_user_id uuid
)
returns timestamptz
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_payload jsonb;
  v_source_updated_at timestamptz;
  v_cached_updated_at timestamptz;
  v_metric_fingerprint text;
  v_cached_metric_fingerprint text;
begin
  if p_user_id is null then
    raise exception 'A projection account is required.' using errcode = '22023';
  end if;
  select snapshot.payload, snapshot.updated_at
    into v_payload, v_source_updated_at
    from public.user_snapshots snapshot
   where snapshot.user_id = p_user_id;

  select pg_catalog.md5(coalesce(string_agg(
           accepted.metric_slug,
           '|' order by accepted.metric_slug
         ), ''))
    into v_metric_fingerprint
    from (
      select distinct challenge.metric_slug
        from public.group_challenges challenge
       where challenge.audience = 'public'
         and challenge.deleted_at is null
         and challenge.accepted_participant_ids @> array[p_user_id]
    ) accepted;

  insert into public.public_challenge_snapshot_cache_state (user_id)
  values (p_user_id)
  on conflict (user_id) do nothing;
  select state.source_updated_at, state.metric_fingerprint
    into v_cached_updated_at, v_cached_metric_fingerprint
    from public.public_challenge_snapshot_cache_state state
   where state.user_id = p_user_id
   for update;
  if v_cached_updated_at is not distinct from v_source_updated_at
     and v_cached_metric_fingerprint is not distinct from v_metric_fingerprint then
    return v_source_updated_at;
  end if;

  delete from public.public_challenge_snapshot_daily_cache cache
   where cache.user_id = p_user_id;
  if v_source_updated_at is not null
     and jsonb_typeof(v_payload -> 'metrics') = 'array'
     and jsonb_typeof(v_payload -> 'entries') = 'array' then
    with accepted_metrics as materialized (
      select distinct challenge.metric_slug
        from public.group_challenges challenge
       where challenge.audience = 'public'
         and challenge.deleted_at is null
         and challenge.accepted_participant_ids @> array[p_user_id]
    ), snapshot_metrics as (
      select distinct on (metric.value ->> 'id')
             metric.value ->> 'id' as metric_slug,
             coalesce(nullif(metric.value ->> 'aggregation', ''), 'sum')
               as aggregation_method
        from jsonb_array_elements(v_payload -> 'metrics')
          with ordinality metric(value, ordinal)
        join accepted_metrics accepted
          on accepted.metric_slug = (metric.value ->> 'id')
       where nullif(metric.value ->> 'id', '') is not null
       order by metric.value ->> 'id', metric.ordinal desc
    ), snapshot_entries as (
      select entry.value ->> 'metricId' as metric_slug,
             parsed.local_date,
             coalesce(entry.value ->> 'recordedAt', '') as recorded_at,
             entry.ordinal,
             coalesce(entry.value ->> 'visibility', '') as visibility,
             case jsonb_typeof(entry.value -> 'value')
               when 'boolean' then
                 case when (entry.value ->> 'value')::boolean then 1 else 0 end
               else (entry.value ->> 'value')::numeric
             end as numeric_value
        from jsonb_array_elements(v_payload -> 'entries')
          with ordinality entry(value, ordinal)
        cross join lateral (
          select public.google_health_projection_date(
            entry.value ->> 'localDate', null
          ) as local_date
        ) parsed
       where nullif(entry.value ->> 'metricId', '') is not null
         and parsed.local_date is not null
         and (
           nullif(entry.value ->> 'userId', '') is null
           or entry.value ->> 'userId' = p_user_id::text
         )
         and jsonb_typeof(entry.value -> 'value') in ('number', 'boolean')
    )
    insert into public.public_challenge_snapshot_daily_cache (
      user_id, metric_slug, local_date, exact_value,
      has_group, has_restricted, source_updated_at
    )
    select p_user_id,
           entry.metric_slug,
           entry.local_date,
           case metric.aggregation_method
             when 'latest' then (
               array_agg(
                 entry.numeric_value
                 order by entry.recorded_at desc, entry.ordinal
               ) filter (where entry.visibility = 'group')
             )[1]
             when 'average' then avg(entry.numeric_value)
               filter (where entry.visibility = 'group')
             when 'max' then max(entry.numeric_value)
               filter (where entry.visibility = 'group')
             when 'min' then min(entry.numeric_value)
               filter (where entry.visibility = 'group')
             else sum(entry.numeric_value)
               filter (where entry.visibility = 'group')
           end,
           bool_or(entry.visibility = 'group'),
           bool_or(entry.visibility <> 'group'),
           v_source_updated_at
      from snapshot_entries entry
      join snapshot_metrics metric on metric.metric_slug = entry.metric_slug
     group by entry.metric_slug, entry.local_date, metric.aggregation_method;
  end if;
  update public.public_challenge_snapshot_cache_state
     set source_updated_at = v_source_updated_at,
         metric_fingerprint = v_metric_fingerprint,
         updated_at = clock_timestamp()
   where user_id = p_user_id;
  return v_source_updated_at;
end;
$$;

revoke all on function public.refresh_public_challenge_snapshot_cache(uuid)
  from public, anon, authenticated;

-- The refresh function parses a snapshot once per source revision; this
-- scorer performs only indexed relational/daily-cache reads thereafter.
create or replace function public.compute_public_challenge_total(
  p_challenge_id uuid,
  p_occurrence_date date,
  p_user_id uuid
)
returns table (total numeric, has_data boolean)
language sql
stable
security definer
set search_path = ''
as $$
  with challenge as (
    select challenge.group_id,
           challenge.metric_slug,
           definition.ranking_direction,
           p_occurrence_date as period_start,
           case
             when challenge.recurrence is null
               or coalesce(challenge.recurrence ->> 'mode', 'once') = 'once'
               then challenge.end_date
             else p_occurrence_date
           end as period_end
      from public.group_challenges challenge
      join public.metric_definitions definition
        on definition.group_id = challenge.group_id
       and definition.slug = challenge.metric_slug
       and definition.archived_at is null
     where challenge.id = p_challenge_id
       and challenge.audience = 'public'
       and challenge.deleted_at is null
       and challenge.accepted_participant_ids @> array[p_user_id]
       and not exists (
         select 1
           from public.group_challenge_user_preferences preference
          where preference.challenge_id = challenge.id
            and preference.user_id = p_user_id
            and preference.withdrawn_at is not null
            and preference.withdrawn_from_date is not null
            and preference.withdrawn_from_date <= p_occurrence_date
       )
  ), status_candidates as (
    select status.local_date,
           status.exact_value,
           status.visibility,
           status.has_data,
           row_number() over (
             partition by status.local_date
             order by
               case when status.group_id = challenge.group_id then 0 else 1 end,
               status.updated_at desc,
               status.group_id
           ) as preference
      from challenge
      join public.daily_metric_status status
        on status.user_id = p_user_id
       and status.local_date between challenge.period_start and challenge.period_end
      join public.metric_definitions candidate_definition
        on candidate_definition.id = status.metric_id
       and candidate_definition.slug = challenge.metric_slug
       and candidate_definition.archived_at is null
  ), selected_status as (
    select * from status_candidates where preference = 1
  ), status_raw as (
    select challenge.group_id,
           challenge.metric_slug,
           challenge.ranking_direction,
           challenge.period_start,
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
              where prior.user_id = p_user_id
                and prior.local_date < challenge.period_start
                and prior.visibility::text = 'group'
                and prior.exact_value is not null
              order by prior.local_date desc,
                       case when prior.group_id = challenge.group_id then 0 else 1 end,
                       prior.updated_at desc
              limit 1
           ) as previous_value,
           count(status.exact_value) filter (
             where status.visibility::text = 'group'
               and status.exact_value is not null
           ) as exact_days,
           count(status.local_date) as source_rows,
           coalesce(bool_or(
             coalesce(status.has_data, false)
             and coalesce(status.visibility::text, 'status') <> 'group'
           ), false) as has_private
      from challenge
      left join selected_status status on true
     group by challenge.group_id, challenge.metric_slug,
              challenge.ranking_direction, challenge.period_start
  ), cache_raw as (
    select challenge.metric_slug,
           challenge.ranking_direction,
           coalesce(sum(cache.exact_value), 0) as summed_total,
           (array_agg(cache.exact_value order by cache.local_date) filter (
             where cache.exact_value is not null
           ))[1] as first_value,
           (array_agg(cache.exact_value order by cache.local_date desc) filter (
             where cache.exact_value is not null
           ))[1] as latest_value,
           (
             select prior.exact_value
               from public.public_challenge_snapshot_daily_cache prior
               join public.user_snapshots snapshot
                 on snapshot.user_id = prior.user_id
                and snapshot.updated_at = prior.source_updated_at
              where prior.user_id = p_user_id
                and prior.metric_slug = challenge.metric_slug
                and prior.local_date < challenge.period_start
                and prior.has_group
                and prior.exact_value is not null
              order by prior.local_date desc
              limit 1
           ) as previous_value,
           count(cache.exact_value) as exact_days,
           coalesce(bool_or(
             cache.has_restricted and not cache.has_group
           ), false) as has_private
      from challenge
      left join public.public_challenge_snapshot_daily_cache cache
        on cache.user_id = p_user_id
       and cache.metric_slug = challenge.metric_slug
       and cache.local_date between challenge.period_start and challenge.period_end
       and exists (
         select 1
           from public.user_snapshots snapshot
          where snapshot.user_id = p_user_id
            and snapshot.updated_at = cache.source_updated_at
       )
     group by challenge.metric_slug, challenge.ranking_direction,
              challenge.period_start
  ), raw as (
    select status.metric_slug,
           status.ranking_direction,
           status.summed_total,
           status.first_value,
           status.latest_value,
           status.previous_value,
           status.exact_days,
           status.has_private
      from status_raw status
     where status.source_rows > 0
    union all
    select cache.metric_slug,
           cache.ranking_direction,
           cache.summed_total,
           cache.first_value,
           cache.latest_value,
           cache.previous_value,
           cache.exact_days,
           cache.has_private
      from cache_raw cache
     where not exists (
       select 1 from status_raw status where status.source_rows > 0
     )
  )
  select case
           when raw.exact_days = 0 or raw.has_private then 0
           when raw.metric_slug = 'weight' then
             case raw.ranking_direction
               when 'lower' then -(
                 raw.latest_value - coalesce(raw.previous_value, raw.first_value)
               )
               when 'higher' then
                 raw.latest_value - coalesce(raw.previous_value, raw.first_value)
               else abs(
                 raw.latest_value - coalesce(raw.previous_value, raw.first_value)
               )
             end
           else raw.summed_total
         end as total,
         raw.exact_days > 0 and not raw.has_private as has_data
    from raw;
$$;

revoke all on function public.compute_public_challenge_total(uuid,date,uuid)
  from public, anon, authenticated;

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
  v_local_today date;
  v_source_updated_at timestamptz;
  v_ids uuid[];
  v_synced_at timestamptz := clock_timestamp();
  v_written integer := 0;
begin
  if v_user_id is null then
    raise exception 'Authentication required.' using errcode = '42501';
  end if;
  v_local_today := public.challenge_account_local_date(v_user_id);
  select coalesce(array_agg(distinct challenge_id order by challenge_id), array[]::uuid[])
    into v_ids
    from unnest(coalesce(p_challenge_ids, array[]::uuid[])) item(challenge_id)
   where challenge_id is not null;
  if cardinality(v_ids) > 100 or p_rows is null
     or jsonb_typeof(p_rows) <> 'array'
     or jsonb_array_length(p_rows) > 500 then
    raise exception 'Public challenge refresh is invalid.' using errcode = '22023';
  end if;
  if cardinality(v_ids) = 0 then return 0; end if;
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

  if exists (
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
      left join public.group_challenges challenge on challenge.id = parsed.challenge_id
     where parsed.challenge_id is null
        or not (parsed.challenge_id = any(v_ids))
        or parsed.occurrence_date is null
        or parsed.occurrence_date > v_local_today
        or challenge.id is null
        or (
          (challenge.recurrence is null
            or coalesce(challenge.recurrence ->> 'mode', 'once') = 'once')
          and parsed.occurrence_date <> challenge.local_date
        )
        or (
          challenge.recurrence is not null
          and coalesce(challenge.recurrence ->> 'mode', 'once') <> 'once'
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
    select 1 from parsed
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
    raise exception 'Public challenge occurrence is invalid.' using errcode = '22023';
  end if;
  v_source_updated_at := public.refresh_public_challenge_snapshot_cache(
    v_user_id
  );

  with parsed as (
      select row."challengeId" as challenge_id,
             row."occurrenceDate" as occurrence_date
        from jsonb_to_recordset(p_rows) as row(
          "challengeId" uuid,
          "occurrenceDate" date
        )
  ), written as (
    insert into public.public_challenge_totals (
      challenge_id, occurrence_date, user_id,
      total, has_data, synced_at, updated_at
    )
    select parsed.challenge_id,
           parsed.occurrence_date,
           v_user_id,
           computed.total,
           computed.has_data,
           v_synced_at,
           v_synced_at
      from parsed
      cross join lateral public.compute_public_challenge_total(
        parsed.challenge_id,
        parsed.occurrence_date,
        v_user_id
      ) computed
    on conflict (challenge_id, occurrence_date, user_id) do update
      set total = excluded.total,
          has_data = excluded.has_data,
          synced_at = excluded.synced_at,
          updated_at = excluded.updated_at
    returning challenge_id, occurrence_date
  )
  insert into public.public_challenge_occurrence_syncs (
    challenge_id, occurrence_date, user_id, synced_at, source_updated_at
  )
  select distinct written.challenge_id,
         written.occurrence_date,
         v_user_id,
         v_synced_at,
         v_source_updated_at
    from written
  on conflict (challenge_id, occurrence_date, user_id) do update
    set synced_at = excluded.synced_at,
        source_updated_at = excluded.source_updated_at;
  get diagnostics v_written = row_count;
  return v_written;
end;
$$;

revoke all on function public.publish_joined_public_challenge_totals(uuid[], jsonb)
  from public, anon;
grant execute on function public.publish_joined_public_challenge_totals(uuid[], jsonb)
  to authenticated;

-- One account cursor bounds accepted-challenge discovery without imposing a
-- catalogue limit. It is private worker state: a new account snapshot or any
-- accepted-challenge catalogue change resets the cursor, while repeated no-op
-- syncs do not regenerate every historical recurring occurrence.
create table if not exists public.public_challenge_projection_cursors (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  source_updated_at timestamptz not null,
  catalogue_fingerprint text not null,
  projection_date date not null,
  challenge_id uuid,
  before_occurrence_date date,
  updated_at timestamptz not null default clock_timestamp()
);
alter table public.public_challenge_projection_cursors enable row level security;
revoke all on table public.public_challenge_projection_cursors
  from public, anon, authenticated;

-- Project every accepted public occurrence in bounded, durable batches. The
-- account snapshot timestamp is the projection watermark: after a batch writes
-- its occurrence markers, a retry naturally advances to older/outstanding
-- occurrences instead of starting over. This removes both catalogue limits and
-- the former 30-day settlement deadlock without trusting a client-supplied
-- score or timestamp.
create or replace function public.project_public_challenge_totals_batch(
  p_user_id uuid,
  p_limit integer default 500
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_local_today date;
  v_timezone text;
  v_source_updated_at timestamptz;
  v_catalogue_fingerprint text;
  v_cursor_source_updated_at timestamptz;
  v_cursor_catalogue_fingerprint text;
  v_cursor_projection_date date;
  v_challenge_cursor uuid;
  v_before_occurrence_date date;
  v_selected_challenge_id uuid;
  v_synced_at timestamptz := clock_timestamp();
  v_pending integer := 0;
  v_written integer := 0;
  v_has_more boolean := false;
begin
  if p_user_id is null then
    raise exception 'A projection account is required.' using errcode = '22023';
  end if;
  if p_limit is null or p_limit not between 1 and 500 then
    raise exception 'Public challenge projection batch is invalid.'
      using errcode = '22023';
  end if;
  -- The projection writer runs after every account snapshot sync. Most accounts
  -- are not participating in a public challenge, so use the accepted-roster GIN
  -- index to return before reading or parsing their snapshot at all.
  if not exists (
    select 1
      from public.group_challenges challenge
     where challenge.audience = 'public'
       and challenge.deleted_at is null
       and challenge.accepted_participant_ids @> array[p_user_id]
  ) then
    return 0;
  end if;
  v_source_updated_at := public.refresh_public_challenge_snapshot_cache(
    p_user_id
  );
  if v_source_updated_at is null then return 0; end if;
  v_local_today := public.challenge_account_local_date(p_user_id);
  select coalesce(valid_timezone.name, 'UTC')
    into v_timezone
    from public.profiles profile
    left join pg_catalog.pg_timezone_names valid_timezone
      on valid_timezone.name = profile.timezone
   where profile.id = p_user_id;
  v_timezone := coalesce(v_timezone, 'UTC');

  select pg_catalog.md5(coalesce(string_agg(
           challenge.id::text || ':' || challenge.updated_at::text,
           '|' order by challenge.id
         ), ''))
    into v_catalogue_fingerprint
    from public.group_challenges challenge
   where challenge.audience = 'public'
     and challenge.deleted_at is null
     and challenge.accepted_participant_ids @> array[p_user_id];

  insert into public.public_challenge_projection_cursors (
    user_id, source_updated_at, catalogue_fingerprint, projection_date
  ) values (
    p_user_id, v_source_updated_at, v_catalogue_fingerprint, v_local_today
  ) on conflict (user_id) do nothing;

  select cursor.source_updated_at,
         cursor.catalogue_fingerprint,
         cursor.projection_date,
         cursor.challenge_id,
         cursor.before_occurrence_date
    into v_cursor_source_updated_at,
         v_cursor_catalogue_fingerprint,
         v_cursor_projection_date,
         v_challenge_cursor,
         v_before_occurrence_date
    from public.public_challenge_projection_cursors cursor
   where cursor.user_id = p_user_id
   for update;
  if v_cursor_source_updated_at is distinct from v_source_updated_at
     or v_cursor_catalogue_fingerprint is distinct from v_catalogue_fingerprint
     or v_cursor_projection_date is distinct from v_local_today then
    update public.public_challenge_projection_cursors
       set source_updated_at = v_source_updated_at,
           catalogue_fingerprint = v_catalogue_fingerprint,
           projection_date = v_local_today,
           challenge_id = null,
           before_occurrence_date = null,
           updated_at = clock_timestamp()
     where user_id = p_user_id;
    v_challenge_cursor := null;
    v_before_occurrence_date := null;
  end if;
  v_synced_at := clock_timestamp();

  if v_before_occurrence_date is not null then
    v_selected_challenge_id := v_challenge_cursor;
  else
    select challenge.id
      into v_selected_challenge_id
      from public.group_challenges challenge
     where challenge.audience = 'public'
       and challenge.deleted_at is null
       and challenge.accepted_participant_ids @> array[p_user_id]
       and (v_challenge_cursor is null or challenge.id > v_challenge_cursor)
     order by challenge.id
     limit 1;
  end if;
  if v_selected_challenge_id is null then return 0; end if;
  update public.public_challenge_projection_cursors
     set challenge_id = v_selected_challenge_id,
         updated_at = clock_timestamp()
   where user_id = p_user_id;

  -- Materialize the bounded occurrence page first. This makes both the
  -- relational and snapshot projections set-based and lets the common path
  -- skip JSON expansion completely when daily status already covers the page.
  create temporary table if not exists pg_temp.public_challenge_projection_pending (
    challenge_id uuid not null,
    occurrence_date date not null,
    period_end date not null,
    group_id uuid not null,
    metric_slug text not null,
    ranking_direction text not null,
    primary key (challenge_id, occurrence_date)
  ) on commit drop;
  truncate table pg_temp.public_challenge_projection_pending;

  with base as (
    select challenge.*,
           definition.ranking_direction::text as ranking_direction
      from public.group_challenges challenge
      join public.metric_definitions definition
        on definition.group_id = challenge.group_id
       and definition.slug = challenge.metric_slug
       and definition.archived_at is null
     where challenge.audience = 'public'
       and challenge.deleted_at is null
       and challenge.accepted_participant_ids @> array[p_user_id]
       and challenge.id = v_selected_challenge_id
  ), occurrences as (
    select base.id as challenge_id,
           base.local_date as occurrence_date,
           base.end_date as period_end,
           base.group_id,
           base.metric_slug,
           base.ranking_direction
      from base
     where (
       base.recurrence is null
       or coalesce(base.recurrence ->> 'mode', 'once') = 'once'
     )
       and base.local_date <= v_local_today
    union all
    select base.id,
           candidate.day::date,
           candidate.day::date,
           base.group_id,
           base.metric_slug,
           base.ranking_direction
      from base
      cross join lateral generate_series(
        base.local_date,
        least((base.recurrence ->> 'endDate')::date, v_local_today),
        interval '1 day'
      ) candidate(day)
     where base.recurrence is not null
       and coalesce(base.recurrence ->> 'mode', 'once') <> 'once'
       and public.group_challenge_occurs_on(
         base.recurrence,
         base.local_date,
         candidate.day::date
       )
  )
  insert into pg_temp.public_challenge_projection_pending (
    challenge_id, occurrence_date, period_end,
    group_id, metric_slug, ranking_direction
  )
    select occurrence.challenge_id,
           occurrence.occurrence_date,
           occurrence.period_end,
           occurrence.group_id,
           occurrence.metric_slug,
           occurrence.ranking_direction
      from occurrences occurrence
      left join public.public_challenge_occurrence_syncs marker
        on marker.challenge_id = occurrence.challenge_id
       and marker.occurrence_date = occurrence.occurrence_date
       and marker.user_id = p_user_id
     where not exists (
       select 1
         from public.group_challenge_user_preferences preference
        where preference.challenge_id = occurrence.challenge_id
          and preference.user_id = p_user_id
          and preference.withdrawn_at is not null
          and preference.withdrawn_from_date is not null
          and preference.withdrawn_from_date <= occurrence.occurrence_date
     )
       and (
         v_before_occurrence_date is null
         or occurrence.occurrence_date < v_before_occurrence_date
       )
       and not exists (
         select 1
           from public.group_challenge_result_settlements settlement
          where settlement.challenge_id = occurrence.challenge_id
            and settlement.occurrence_date = occurrence.occurrence_date
       )
       and (
         marker.synced_at is null
         or marker.source_updated_at is null
         or marker.source_updated_at < v_source_updated_at
         or marker.synced_at < (
           (occurrence.period_end + 1)::timestamp at time zone v_timezone
         )
       )
     order by occurrence.occurrence_date desc, occurrence.challenge_id desc
     limit p_limit;
  get diagnostics v_pending = row_count;
  if v_pending = 0 then
    update public.public_challenge_projection_cursors
       set before_occurrence_date = null,
           updated_at = clock_timestamp()
     where user_id = p_user_id;
    select exists (
      select 1
        from public.group_challenges challenge
       where challenge.audience = 'public'
         and challenge.deleted_at is null
         and challenge.accepted_participant_ids @> array[p_user_id]
         and challenge.id > v_selected_challenge_id
    ) into v_has_more;
    return case when v_has_more then p_limit else 0 end;
  end if;

  with status_candidates as (
    select pending.challenge_id,
           pending.occurrence_date,
           status.local_date,
           status.exact_value,
           status.visibility,
           status.has_data,
           row_number() over (
             partition by pending.challenge_id,
                          pending.occurrence_date,
                          status.local_date
             order by
               case when status.group_id = pending.group_id then 0 else 1 end,
               status.updated_at desc,
               status.group_id
           ) as preference
      from pg_temp.public_challenge_projection_pending pending
      join public.daily_metric_status status
        on status.user_id = p_user_id
       and status.local_date between pending.occurrence_date
                                 and pending.period_end
      join public.metric_definitions candidate_definition
        on candidate_definition.id = status.metric_id
       and candidate_definition.slug = pending.metric_slug
       and candidate_definition.archived_at is null
  ), selected_status as (
    select * from status_candidates where preference = 1
  ), status_raw as (
    select pending.challenge_id,
           pending.occurrence_date,
           pending.metric_slug,
           pending.ranking_direction,
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
                and prior_definition.slug = pending.metric_slug
                and prior_definition.archived_at is null
              where prior.user_id = p_user_id
                and prior.local_date < pending.occurrence_date
                and prior.visibility::text = 'group'
                and prior.exact_value is not null
              order by prior.local_date desc,
                       case when prior.group_id = pending.group_id then 0 else 1 end,
                       prior.updated_at desc
              limit 1
           ) as previous_value,
           count(status.exact_value) filter (
             where status.visibility::text = 'group'
               and status.exact_value is not null
           ) as exact_days,
           count(status.local_date) as source_rows,
           coalesce(bool_or(
             coalesce(status.has_data, false)
             and coalesce(status.visibility::text, 'status') <> 'group'
           ), false) as has_private
      from pg_temp.public_challenge_projection_pending pending
      left join selected_status status
        on status.challenge_id = pending.challenge_id
       and status.occurrence_date = pending.occurrence_date
     group by pending.challenge_id, pending.occurrence_date,
              pending.metric_slug, pending.ranking_direction,
              pending.group_id
  ), snapshot_daily as (
    select pending.challenge_id,
           pending.occurrence_date,
           cache.local_date,
           cache.exact_value as daily_value,
           cache.has_group,
           cache.has_restricted
      from pg_temp.public_challenge_projection_pending pending
      join public.public_challenge_snapshot_daily_cache cache
        on cache.user_id = p_user_id
       and cache.metric_slug = pending.metric_slug
       and cache.local_date between pending.occurrence_date
                                and pending.period_end
       and cache.source_updated_at = v_source_updated_at
  ), snapshot_raw as (
    select pending.challenge_id,
           pending.occurrence_date,
           pending.metric_slug,
           pending.ranking_direction,
           coalesce(sum(daily.daily_value), 0) as summed_total,
           (array_agg(daily.daily_value order by daily.local_date) filter (
             where daily.daily_value is not null
           ))[1] as first_value,
           (array_agg(daily.daily_value order by daily.local_date desc) filter (
             where daily.daily_value is not null
           ))[1] as latest_value,
           previous.numeric_value as previous_value,
           count(daily.daily_value) as exact_days,
           coalesce(bool_or(
             daily.has_restricted and not daily.has_group
           ), false) as has_private
      from pg_temp.public_challenge_projection_pending pending
      left join snapshot_daily daily
        on daily.challenge_id = pending.challenge_id
       and daily.occurrence_date = pending.occurrence_date
      left join lateral (
        select prior.exact_value as numeric_value
          from public.public_challenge_snapshot_daily_cache prior
         where pending.metric_slug = 'weight'
           and prior.user_id = p_user_id
           and prior.metric_slug = pending.metric_slug
           and prior.local_date < pending.occurrence_date
           and prior.has_group
           and prior.exact_value is not null
           and prior.source_updated_at = v_source_updated_at
         order by prior.local_date desc
         limit 1
      ) previous on true
     group by pending.challenge_id, pending.occurrence_date,
              pending.metric_slug, pending.ranking_direction,
              previous.numeric_value
  ), raw as (
    select status.challenge_id,
           status.occurrence_date,
           status.metric_slug,
           status.ranking_direction,
           status.summed_total,
           status.first_value,
           status.latest_value,
           status.previous_value,
           status.exact_days,
           status.has_private
      from status_raw status
     where status.source_rows > 0
    union all
    select snapshot.challenge_id,
           snapshot.occurrence_date,
           snapshot.metric_slug,
           snapshot.ranking_direction,
           snapshot.summed_total,
           snapshot.first_value,
           snapshot.latest_value,
           snapshot.previous_value,
           snapshot.exact_days,
           snapshot.has_private
      from snapshot_raw snapshot
      join status_raw status
        on status.challenge_id = snapshot.challenge_id
       and status.occurrence_date = snapshot.occurrence_date
     where status.source_rows = 0
  ), computed as (
    select raw.challenge_id,
           raw.occurrence_date,
           case
             when raw.exact_days = 0 or raw.has_private then 0
             when raw.metric_slug = 'weight' then
               case raw.ranking_direction
                 when 'lower' then -(
                   raw.latest_value - coalesce(raw.previous_value, raw.first_value)
                 )
                 when 'higher' then
                   raw.latest_value - coalesce(raw.previous_value, raw.first_value)
                 else abs(
                   raw.latest_value - coalesce(raw.previous_value, raw.first_value)
                 )
               end
             else raw.summed_total
           end as total,
           raw.exact_days > 0 and not raw.has_private as has_data
      from raw
  ), written as (
    insert into public.public_challenge_totals (
      challenge_id, occurrence_date, user_id,
      total, has_data, synced_at, updated_at
    )
    select computed.challenge_id,
           computed.occurrence_date,
           p_user_id,
           computed.total,
           computed.has_data,
           v_synced_at,
           v_synced_at
      from computed
    on conflict (challenge_id, occurrence_date, user_id) do update
      set total = excluded.total,
          has_data = excluded.has_data,
          synced_at = excluded.synced_at,
          updated_at = excluded.updated_at
    returning challenge_id, occurrence_date
  ), marked as (
    insert into public.public_challenge_occurrence_syncs (
      challenge_id, occurrence_date, user_id, synced_at, source_updated_at
    )
    select written.challenge_id,
           written.occurrence_date,
           p_user_id,
           v_synced_at,
           v_source_updated_at
      from written
    on conflict (challenge_id, occurrence_date, user_id) do update
      set synced_at = excluded.synced_at,
          source_updated_at = excluded.source_updated_at
    returning challenge_id
  )
  select count(*)::integer into v_written from marked;
  if v_pending >= p_limit then
    select min(pending.occurrence_date)
      into v_before_occurrence_date
      from pg_temp.public_challenge_projection_pending pending;
    update public.public_challenge_projection_cursors
       set before_occurrence_date = v_before_occurrence_date,
           updated_at = clock_timestamp()
     where user_id = p_user_id;
    v_has_more := true;
  else
    update public.public_challenge_projection_cursors
       set before_occurrence_date = null,
           updated_at = clock_timestamp()
     where user_id = p_user_id;
    select exists (
      select 1
        from public.group_challenges challenge
       where challenge.audience = 'public'
         and challenge.deleted_at is null
         and challenge.accepted_participant_ids @> array[p_user_id]
         and challenge.id > v_selected_challenge_id
    ) into v_has_more;
  end if;
  return case when v_has_more then p_limit else v_written end;
end;
$$;

revoke all on function public.project_public_challenge_totals_batch(uuid, integer)
  from public, anon, authenticated;
grant execute on function public.project_public_challenge_totals_batch(uuid, integer)
  to service_role;

create or replace function public.project_my_public_challenge_totals_batch(
  p_limit integer default 500
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
begin
  if v_user_id is null then
    raise exception 'Authentication required.' using errcode = '42501';
  end if;
  return public.project_public_challenge_totals_batch(v_user_id, p_limit);
end;
$$;

revoke all on function public.project_my_public_challenge_totals_batch(integer)
  from public, anon;
grant execute on function public.project_my_public_challenge_totals_batch(integer)
  to authenticated;

-- A creator may revisit a finished public card and correct its title. The
-- existing started-challenge guard immediately below in save_public_challenge
-- still locks metric, target, dates, and recurrence, so settled scoring cannot
-- be rewritten.
do $migration$
declare
  v_definition text;
  v_finished_guard text := $guard$
    if public.group_challenge_join_deadline(v_existing) < current_date - 1 then
      raise exception 'Finished challenges cannot be edited.' using errcode = '22023';
    end if;
$guard$;
  v_creator_guard text := $guard$
    if v_existing.creator_id <> v_user_id then
      raise exception 'Only the creator can edit a public challenge.'
        using errcode = '42501';
    end if;
$guard$;
  v_creator_and_group_guard text := $guard$
    if v_existing.creator_id <> v_user_id then
      raise exception 'Only the creator can edit a public challenge.'
        using errcode = '42501';
    end if;
    if v_existing.group_id <> p_group_id then
      raise exception 'A public challenge cannot move between groups.'
        using errcode = '22023';
    end if;
$guard$;
begin
  select pg_catalog.pg_get_functiondef(
    'public.save_public_challenge(uuid,uuid,text,text,numeric,date,date,uuid[],jsonb,integer)'::regprocedure
  ) into v_definition;
  if pg_catalog.strpos(v_definition, v_finished_guard) = 0
     or pg_catalog.strpos(v_definition, v_creator_guard) = 0 then
    raise exception 'Unexpected public challenge edit guard shape'
      using errcode = 'P0001';
  end if;
  v_definition := replace(v_definition, v_finished_guard, E'\n');
  v_definition := replace(
    v_definition,
    v_creator_guard,
    v_creator_and_group_guard
  );
  v_definition := replace(
    v_definition,
    'current_date',
    'public.challenge_account_local_date(v_user_id)'
  );
  execute v_definition;
end;
$migration$;

-- One occurrence-level marker is the canonical settlement fact. Recipient
-- notifications are delivery records and may be retained or retried
-- independently; they must never define whether a result is final.
create table if not exists public.group_challenge_result_settlements (
  challenge_id uuid not null
    references public.group_challenges(id) on delete cascade,
  occurrence_date date not null,
  settled_at timestamptz not null default clock_timestamp(),
  primary key (challenge_id, occurrence_date)
);
alter table public.group_challenge_result_settlements enable row level security;
revoke all on table public.group_challenge_result_settlements
  from public, anon, authenticated;

-- Final results are immutable. The worker emits recipient-scoped result events
-- only after every occurrence participant has synced past the deadline. The
-- first event claims this marker and computes the standings exactly once;
-- later recipient events are O(1) and cannot append or rewrite placements.
create table if not exists public.group_challenge_result_placements (
  challenge_id uuid not null
    references public.group_challenges(id) on delete cascade,
  occurrence_date date not null,
  user_id uuid not null references public.profiles(id) on delete cascade,
  total numeric not null,
  standing_position bigint not null check (standing_position > 0),
  competitor_count bigint not null check (competitor_count > 0),
  winner boolean not null default false,
  settled_at timestamptz not null default clock_timestamp(),
  primary key (challenge_id, occurrence_date, user_id)
);
create index if not exists group_challenge_result_placements_user_idx
  on public.group_challenge_result_placements
    (user_id, occurrence_date desc, challenge_id);
alter table public.group_challenge_result_placements enable row level security;
revoke all on table public.group_challenge_result_placements
  from public, anon, authenticated;

create or replace function public.snapshot_group_challenge_result(
  p_challenge_id uuid,
  p_occurrence_date date,
  p_settled_at timestamptz default clock_timestamp()
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_challenge public.group_challenges;
  v_period_end date;
begin
  select * into v_challenge
    from public.group_challenges challenge
   where challenge.id = p_challenge_id
     and challenge.deleted_at is null;
  if not found or p_occurrence_date is null then return; end if;
  if v_challenge.recurrence is null
     or coalesce(v_challenge.recurrence ->> 'mode', 'once') = 'once' then
    if p_occurrence_date <> v_challenge.local_date then return; end if;
    v_period_end := v_challenge.end_date;
  else
    if not public.group_challenge_occurs_on(
      v_challenge.recurrence,
      v_challenge.local_date,
      p_occurrence_date
    ) then return; end if;
    v_period_end := p_occurrence_date;
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      p_challenge_id::text || ':' || p_occurrence_date::text,
      0
    )
  );
  insert into public.group_challenge_result_settlements (
    challenge_id, occurrence_date, settled_at
  ) values (
    p_challenge_id,
    p_occurrence_date,
    coalesce(p_settled_at, clock_timestamp())
  ) on conflict (challenge_id, occurrence_date) do nothing;
  if not found then return; end if;

  insert into public.group_challenge_result_placements (
    challenge_id, occurrence_date, user_id, total,
    standing_position, competitor_count, winner, settled_at
  )
  select p_challenge_id,
         p_occurrence_date,
         standing.user_id,
         standing.total,
         standing.standing_position,
         standing.competitor_count,
         standing.winner,
         coalesce(p_settled_at, clock_timestamp())
    from (
      select exact_standing.*,
             count(*) over () as competitor_count
        from public.group_challenge_exact_standings(
          p_challenge_id,
          p_occurrence_date,
          v_period_end
        ) exact_standing
    ) standing
  on conflict (challenge_id, occurrence_date, user_id) do nothing;
end;
$$;

revoke all on function public.snapshot_group_challenge_result(
  uuid, date, timestamptz
) from public, anon, authenticated;

create or replace function public.capture_group_challenge_result_snapshot()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.event_type = 'challenge_result'
     and new.challenge_id is not null
     and new.occurrence_date is not null then
    perform public.snapshot_group_challenge_result(
      new.challenge_id,
      new.occurrence_date,
      new.created_at
    );
  end if;
  return new;
end;
$$;

revoke all on function public.capture_group_challenge_result_snapshot()
  from public, anon, authenticated;
drop trigger if exists group_notification_events_capture_result_snapshot
  on public.group_notification_events;
create trigger group_notification_events_capture_result_snapshot
after insert on public.group_notification_events
for each row execute function public.capture_group_challenge_result_snapshot();

-- Freeze any canonical results emitted before this release once. Subsequent
-- log edits cannot rewrite these rows.
do $migration$
declare
  v_result record;
begin
  for v_result in
    select event.challenge_id,
           event.occurrence_date,
           min(event.created_at) as settled_at
      from public.group_notification_events event
     where event.event_type = 'challenge_result'
       and event.challenge_id is not null
       and event.occurrence_date is not null
     group by event.challenge_id, event.occurrence_date
  loop
    perform public.snapshot_group_challenge_result(
      v_result.challenge_id,
      v_result.occurrence_date,
      v_result.settled_at
    );
  end loop;
end;
$migration$;

-- Occurrence-aware private rank cards. Active rows remain live; ended rows are
-- returned only from the immutable snapshot created with the canonical event.
create or replace function public.list_my_challenge_standings(
  p_challenge_ids uuid[],
  p_occurrence_dates date[]
)
returns table (
  challenge_id uuid,
  occurrence_date date,
  viewer_total numeric,
  standing_position bigint,
  competitor_count bigint,
  viewer_winner boolean
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
  v_local_today := public.challenge_account_local_date(v_user_id);
  if cardinality(coalesce(p_challenge_ids, array[]::uuid[]))
       <> cardinality(coalesce(p_occurrence_dates, array[]::date[]))
     or cardinality(coalesce(p_challenge_ids, array[]::uuid[])) > 50 then
    raise exception 'Challenge occurrence request is invalid.'
      using errcode = '22023';
  end if;

  return query
  with requested as (
    select distinct request.challenge_id, request.occurrence_date
      from unnest(
        coalesce(p_challenge_ids, array[]::uuid[]),
        coalesce(p_occurrence_dates, array[]::date[])
      ) request(challenge_id, occurrence_date)
     where request.challenge_id is not null
       and request.occurrence_date is not null
  ), eligible as (
    select challenge.*,
           requested.occurrence_date,
           case
             when challenge.recurrence is null
               or coalesce(challenge.recurrence ->> 'mode', 'once') = 'once'
               then challenge.end_date
             else requested.occurrence_date
           end as occurrence_end_date,
           exists (
             select 1
               from public.group_challenge_result_settlements settlement
              where settlement.challenge_id = challenge.id
                and settlement.occurrence_date = requested.occurrence_date
           ) as settled
      from requested
      join public.group_challenges challenge
        on challenge.id = requested.challenge_id
     where challenge.deleted_at is null
       and v_user_id = any(challenge.accepted_participant_ids)
       and (
         challenge.audience = 'public'
         or public.is_group_member(challenge.group_id)
       )
       and (
         (
           (challenge.recurrence is null
             or coalesce(challenge.recurrence ->> 'mode', 'once') = 'once')
           and requested.occurrence_date = challenge.local_date
         )
         or (
           challenge.recurrence is not null
           and coalesce(challenge.recurrence ->> 'mode', 'once') <> 'once'
           and public.group_challenge_occurs_on(
             challenge.recurrence,
             challenge.local_date,
             requested.occurrence_date
           )
         )
       )
  )
  select eligible.id,
         eligible.occurrence_date,
         standing.total,
         standing.standing_position,
         coalesce(standing.competitor_count, 0),
         coalesce(standing.winner, false)
    from eligible
    left join lateral (
      select snapshot.total,
             snapshot.standing_position,
             snapshot.competitor_count,
             snapshot.winner
        from public.group_challenge_result_placements snapshot
       where eligible.settled
         and snapshot.challenge_id = eligible.id
         and snapshot.occurrence_date = eligible.occurrence_date
         and snapshot.user_id = v_user_id
      union all
      select live.total,
             live.standing_position,
             live.competitor_count,
             live.winner
        from (
          select exact_standing.*,
                 count(*) over () as competitor_count
            from public.group_challenge_exact_standings(
              eligible.id,
              eligible.occurrence_date,
              eligible.occurrence_end_date
            ) exact_standing
        ) live
       where not eligible.settled
         and eligible.occurrence_end_date >= v_local_today
         and live.user_id = v_user_id
    ) standing on true
   where standing.standing_position is not null;
end;
$$;

revoke all on function public.list_my_challenge_standings(uuid[], date[])
  from public, anon;
grant execute on function public.list_my_challenge_standings(uuid[], date[])
  to authenticated;

-- Accepted participants may inspect active standings, then the immutable
-- finalized snapshot. Public participants consent to the public projection;
-- group challenges retain active-membership enforcement.
create or replace function public.list_challenge_standings(
  p_challenge_id uuid,
  p_occurrence_date date
)
returns table (
  user_id uuid,
  display_name text,
  total numeric,
  standing_position bigint,
  competitor_count bigint,
  synced_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_challenge public.group_challenges;
  v_period_end date;
  v_settled boolean;
  v_local_today date;
begin
  if v_user_id is null then
    raise exception 'Authentication required.' using errcode = '42501';
  end if;
  v_local_today := public.challenge_account_local_date(v_user_id);
  select * into v_challenge
   from public.group_challenges challenge
   where challenge.id = p_challenge_id
     and challenge.deleted_at is null;
  if not found
     or not (v_user_id = any(v_challenge.accepted_participant_ids))
     or (
       v_challenge.audience = 'group'
       and not public.is_group_member(v_challenge.group_id)
     ) then
    raise exception 'Challenge participation is required.'
      using errcode = '42501';
  end if;
  if v_challenge.recurrence is null
     or coalesce(v_challenge.recurrence ->> 'mode', 'once') = 'once' then
    if p_occurrence_date <> v_challenge.local_date then return; end if;
    v_period_end := v_challenge.end_date;
  else
    if not public.group_challenge_occurs_on(
      v_challenge.recurrence,
      v_challenge.local_date,
      p_occurrence_date
    ) then return; end if;
    v_period_end := p_occurrence_date;
  end if;
  select exists (
       select 1
         from public.group_challenge_result_settlements settlement
        where settlement.challenge_id = v_challenge.id
          and settlement.occurrence_date = p_occurrence_date
     ) into v_settled;
  if not v_settled and v_period_end < v_local_today then return; end if;

  return query
  with ranked_standing as (
    select standing.user_id,
           coalesce(profile.display_name, 'A participant') as display_name,
           standing.total,
           standing.standing_position,
           standing.competitor_count,
           projection.synced_at,
           row_number() over (
             order by standing.standing_position,
                      coalesce(profile.display_name, 'A participant'),
                      standing.user_id
           ) as display_row
      from (
      select snapshot.user_id,
             snapshot.total,
             snapshot.standing_position,
             snapshot.competitor_count
        from public.group_challenge_result_placements snapshot
       where v_settled
         and snapshot.challenge_id = v_challenge.id
         and snapshot.occurrence_date = p_occurrence_date
      union all
      select live.user_id,
             live.total,
             live.standing_position,
             live.competitor_count
        from (
          select exact_standing.*,
                 count(*) over () as competitor_count
            from public.group_challenge_exact_standings(
              v_challenge.id,
              p_occurrence_date,
              v_period_end
            ) exact_standing
        ) live
       where not v_settled
      ) standing
      left join public.profiles profile on profile.id = standing.user_id
      left join public.public_challenge_totals projection
        on projection.challenge_id = v_challenge.id
       and projection.occurrence_date = p_occurrence_date
       and projection.user_id = standing.user_id
  )
  select ranked.user_id,
         ranked.display_name,
         ranked.total,
         ranked.standing_position,
         ranked.competitor_count,
         ranked.synced_at
    from ranked_standing ranked
   where v_challenge.audience = 'group'
      or ranked.display_row <= 100
      or ranked.user_id = v_user_id
   order by ranked.standing_position, ranked.display_name, ranked.user_id
   limit 101;
end;
$$;

revoke all on function public.list_challenge_standings(uuid, date)
  from public, anon;
grant execute on function public.list_challenge_standings(uuid, date)
  to authenticated;

-- Batch finalized placements for Badge Cabinet and public profiles. Group
-- members may see their group's frozen standings; a public challenge returns
-- only the caller's own placement outside that group.
create or replace function public.list_challenge_result_placements(
  p_challenge_ids uuid[],
  p_occurrence_dates date[]
)
returns table (
  challenge_id uuid,
  occurrence_date date,
  user_id uuid,
  total numeric,
  standing_position bigint,
  competitor_count bigint,
  winner boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
begin
  if v_user_id is null then
    raise exception 'Authentication required.' using errcode = '42501';
  end if;
  if cardinality(coalesce(p_challenge_ids, array[]::uuid[]))
       <> cardinality(coalesce(p_occurrence_dates, array[]::date[]))
     or cardinality(coalesce(p_challenge_ids, array[]::uuid[])) > 50 then
    raise exception 'Challenge occurrence request is invalid.'
      using errcode = '22023';
  end if;

  return query
  with requested as (
    select distinct request.challenge_id, request.occurrence_date
      from unnest(
        coalesce(p_challenge_ids, array[]::uuid[]),
        coalesce(p_occurrence_dates, array[]::date[])
      ) request(challenge_id, occurrence_date)
  ), authorized as (
    select challenge.id,
           challenge.audience,
           requested.occurrence_date
      from requested
      join public.group_challenges challenge on challenge.id = requested.challenge_id
     where challenge.deleted_at is null
       and v_user_id = any(challenge.accepted_participant_ids)
       and (
         challenge.audience = 'public'
         or public.is_group_member(challenge.group_id)
       )
       and exists (
         select 1
           from public.group_challenge_result_settlements settlement
          where settlement.challenge_id = challenge.id
            and settlement.occurrence_date = requested.occurrence_date
       )
  )
  select snapshot.challenge_id,
         snapshot.occurrence_date,
         snapshot.user_id,
         snapshot.total,
         snapshot.standing_position,
         snapshot.competitor_count,
         snapshot.winner
    from authorized
    join public.group_challenge_result_placements snapshot
      on snapshot.challenge_id = authorized.id
     and snapshot.occurrence_date = authorized.occurrence_date
   where authorized.audience = 'group'
      or snapshot.user_id = v_user_id
   order by snapshot.occurrence_date desc,
            snapshot.standing_position,
            snapshot.user_id;
end;
$$;

revoke all on function public.list_challenge_result_placements(uuid[], date[])
  from public, anon;
grant execute on function public.list_challenge_result_placements(uuid[], date[])
  to authenticated;

-- Durable group history for Badge Cabinet, profiles, and recaps. This is not
-- sourced from the bounded notification inbox, so newer activity cannot make
-- a settled outcome disappear from the client.
create or replace function public.list_group_challenge_result_placements(
  p_group_id uuid,
  p_before_occurrence_date date default null,
  p_before_challenge_id uuid default null,
  p_page_size integer default 20
)
returns table (
  challenge_id uuid,
  occurrence_date date,
  user_id uuid,
  total numeric,
  standing_position bigint,
  competitor_count bigint,
  winner boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null
     or not public.is_group_member(p_group_id) then
    raise exception 'Active group membership is required.'
      using errcode = '42501';
  end if;
  -- A group challenge has at most 50 participants. Twenty complete
  -- occurrences fit within the common 1,000-row API response cap; allowing a
  -- larger page could let PostgREST truncate midway through an occurrence and
  -- cause the client cursor to skip durable placements.
  if p_page_size is null or p_page_size not between 1 and 20
     or ((p_before_occurrence_date is null)
       <> (p_before_challenge_id is null)) then
    raise exception 'Challenge result page is invalid.'
      using errcode = '22023';
  end if;
  return query
  with occurrence_page as (
    select distinct snapshot.challenge_id,
           snapshot.occurrence_date
      from public.group_challenge_result_placements snapshot
      join public.group_challenges challenge
        on challenge.id = snapshot.challenge_id
       and challenge.group_id = p_group_id
       and challenge.audience = 'group'
       and challenge.deleted_at is null
     where p_before_occurrence_date is null
        or snapshot.occurrence_date < p_before_occurrence_date
        or (
          snapshot.occurrence_date = p_before_occurrence_date
          and snapshot.challenge_id < p_before_challenge_id
        )
     order by snapshot.occurrence_date desc, snapshot.challenge_id desc
     limit p_page_size
  )
  select snapshot.challenge_id,
         snapshot.occurrence_date,
         snapshot.user_id,
         snapshot.total,
         snapshot.standing_position,
         snapshot.competitor_count,
         snapshot.winner
    from occurrence_page page
    join public.group_challenge_result_placements snapshot
      on snapshot.challenge_id = page.challenge_id
     and snapshot.occurrence_date = page.occurrence_date
   order by snapshot.occurrence_date desc,
            snapshot.challenge_id desc,
            snapshot.standing_position,
            snapshot.user_id;
end;
$$;

revoke all on function public.list_group_challenge_result_placements(
  uuid, date, uuid, integer
)
  from public, anon;
grant execute on function public.list_group_challenge_result_placements(
  uuid, date, uuid, integer
)
  to authenticated;

-- Preserve all existing notification-worker privacy and settlement rules, and
-- narrowly replace only its already-deployed generic result detail.
do $migration$
declare
  v_definition text;
  v_old_result_detail text := $old$
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
          select standing.* into v_neighbor
            from public.group_challenge_exact_standings(
              v_challenge.id,
              v_challenge.occurrence_date,
              v_challenge.occurrence_end_date
            ) standing
           where standing.standing_position = 2
           order by standing.display_name
           limit 1;
          v_detail := case
            when v_self.user_id is null then
              coalesce(v_winner_names, 'The leader') ||
                ' won. Final standings are ready.'
            when v_self.standing_position = 1 then
              'You finished #1' || case when v_neighbor.user_id is not null
                then '. ' || v_neighbor.display_name || ' finished second'
                else '' end || '.'
            when v_self.standing_position = 2 then
              'You finished #2 behind ' ||
                coalesce(v_winner_names, 'the winner') || '.'
            else
              coalesce(v_winner_names, 'The leader') || ' won' ||
                case when v_neighbor.user_id is not null
                  then ', with ' || v_neighbor.display_name || ' in second'
                  else '' end || '. You placed #' ||
                v_self.standing_position::text || ' of ' ||
                v_self.competitor_count::text || '.'
          end || ' Open Challenges to view the result.';
$new$;
begin
  select pg_catalog.pg_get_functiondef(
           'public.stage_group_challenge_notifications(integer)'::regprocedure
         )
    into v_definition;

  if pg_catalog.strpos(v_definition, v_old_result_detail) = 0 then
    raise exception 'Unexpected challenge result notification shape'
      using errcode = 'P0001';
  end if;

  v_definition := replace(
    v_definition,
    v_old_result_detail,
    v_new_result_detail
  );
  execute v_definition;
end;
$migration$;

-- A challenge can be removed from one member's Leaderboard without deleting
-- the shared competition. Withdrawal is durable and cannot be reversed by a
-- client or by a later invitation edit.
create or replace function public.set_my_challenge_preference(
  p_challenge_id uuid,
  p_hidden boolean,
  p_pinned boolean
)
returns public.group_challenge_user_preferences
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_saved public.group_challenge_user_preferences;
begin
  if v_user_id is null then
    raise exception 'Authentication required.' using errcode = '42501';
  end if;
  if p_hidden is null or p_pinned is null then
    raise exception 'Challenge preferences are invalid.' using errcode = '22023';
  end if;
  if not exists (
    select 1
      from public.group_challenges challenge
     where challenge.id = p_challenge_id
       and challenge.deleted_at is null
       and (
         challenge.creator_id = v_user_id
         or v_user_id = any(challenge.participant_ids)
       )
  ) then
    raise exception 'Challenge participation is required.' using errcode = '42501';
  end if;

  insert into public.group_challenge_user_preferences (
    challenge_id, user_id, hidden, pinned, updated_at
  ) values (
    p_challenge_id, v_user_id, p_hidden, p_pinned, clock_timestamp()
  )
  on conflict (challenge_id, user_id) do update
    set hidden = excluded.hidden,
        pinned = excluded.pinned,
        updated_at = excluded.updated_at
  returning * into v_saved;
  return v_saved;
end;
$$;

revoke all on function public.set_my_challenge_preference(
  uuid, boolean, boolean
) from public, anon;
grant execute on function public.set_my_challenge_preference(
  uuid, boolean, boolean
) to authenticated;

create or replace function public.withdraw_from_group_challenge(
  p_challenge_id uuid
)
returns public.group_challenge_user_preferences
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_challenge public.group_challenges;
  v_local_today date;
  v_saved public.group_challenge_user_preferences;
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
  if v_challenge.creator_id = v_user_id then
    raise exception 'The creator can delete the shared challenge instead.'
      using errcode = '42501';
  end if;
  if not (v_user_id = any(v_challenge.participant_ids)) then
    raise exception 'Challenge participation is required.' using errcode = '42501';
  end if;

  v_local_today := public.challenge_account_local_date(v_user_id);

  insert into public.group_challenge_user_preferences (
    challenge_id, user_id, hidden, pinned, withdrawn_at,
    withdrawn_from_date, updated_at
  ) values (
    p_challenge_id, v_user_id, true, false,
    clock_timestamp(), v_local_today, clock_timestamp()
  )
  on conflict (challenge_id, user_id) do update
    set hidden = true,
        pinned = false,
        withdrawn_at = coalesce(
          public.group_challenge_user_preferences.withdrawn_at,
          excluded.withdrawn_at
        ),
        withdrawn_from_date = coalesce(
          public.group_challenge_user_preferences.withdrawn_from_date,
          excluded.withdrawn_from_date
        ),
        updated_at = excluded.updated_at
  returning * into v_saved;

  -- A one-off that has not ended can remove the account from its roster. A
  -- recurring row keeps its accepted series roster intact: the occurrence
  -- participant helper excludes this account from today forward while every
  -- earlier unsnapshotted occurrence retains its original competitors.
  if (v_challenge.recurrence is null
       or coalesce(v_challenge.recurrence ->> 'mode', 'once') = 'once')
     and public.group_challenge_join_deadline(v_challenge) >= v_local_today then
    update public.group_challenges
       set participant_ids = case
             when audience = 'public'
               then array_remove(participant_ids, v_user_id)
             else participant_ids
           end,
           accepted_participant_ids = array_remove(
             accepted_participant_ids,
             v_user_id
           ),
           declined_participant_ids = array_remove(
             declined_participant_ids,
             v_user_id
           )
     where id = p_challenge_id;
  end if;
  return v_saved;
end;
$$;

revoke all on function public.withdraw_from_group_challenge(uuid)
  from public, anon;
grant execute on function public.withdraw_from_group_challenge(uuid)
  to authenticated;

create or replace function public.block_withdrawn_challenge_rejoin()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (
    select 1
      from public.group_challenge_user_preferences preference
     where preference.challenge_id = new.id
       and preference.withdrawn_at is not null
       and preference.user_id = any(new.accepted_participant_ids)
       and not (preference.user_id = any(old.accepted_participant_ids))
  ) then
    raise exception 'A withdrawn participant cannot rejoin this challenge.'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

revoke all on function public.block_withdrawn_challenge_rejoin()
  from public, anon, authenticated;
drop trigger if exists group_challenges_block_withdrawn_rejoin
  on public.group_challenges;
create trigger group_challenges_block_withdrawn_rejoin
before update of accepted_participant_ids
on public.group_challenges
for each row execute function public.block_withdrawn_challenge_rejoin();

-- Make the installed settlement worker use the same occurrence-scoped roster
-- as the scorer, and require a sync marker for this exact occurrence. This
-- prevents a recurring series from settling yesterday using today's publish.
do $migration$
declare
  v_definition text;
  v_old_occurrence_participants text :=
    'unnest(occurrence.accepted_participant_ids)';
  v_new_occurrence_participants text :=
    'public.group_challenge_occurrence_participant_ids(' ||
    'occurrence.id, occurrence.occurrence_date)';
  v_old_challenge_participants text :=
    'unnest(v_challenge.accepted_participant_ids)';
  v_new_challenge_participants text :=
    'public.group_challenge_occurrence_participant_ids(' ||
    'v_challenge.id, v_challenge.occurrence_date)';
  v_old_projection_table text :=
    'public.public_challenge_participant_syncs';
  v_new_projection_table text :=
    'public.public_challenge_occurrence_syncs';
  v_old_projection_join text := $old$
       and challenge_projection.user_id = accepted.user_id
$old$;
  v_new_projection_join text := $new$
       and challenge_projection.occurrence_date = v_challenge.occurrence_date
       and challenge_projection.user_id = accepted.user_id
      left join public.user_snapshots current_snapshot
        on current_snapshot.user_id = accepted.user_id
$new$;
  v_old_projection_ready text := $old$
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
$old$;
  v_new_projection_ready text := $new$
               and case
                 when v_challenge.audience = 'public' then
                   coalesce(
                     challenge_projection.synced_at,
                     '-infinity'::timestamptz
                   ) >= (
                     (v_challenge.occurrence_end_date + 1)::timestamp
                       at time zone coalesce(valid_timezone.name, 'UTC')
                   )
                   and challenge_projection.source_updated_at is not null
                   and current_snapshot.updated_at is not null
                   and challenge_projection.source_updated_at =
                     current_snapshot.updated_at
                 else coalesce(
                   member.last_data_synced_at,
                   '-infinity'::timestamptz
                 ) >= (
                   (v_challenge.occurrence_end_date + 1)::timestamp
                     at time zone coalesce(valid_timezone.name, 'UTC')
                 )
               end
$new$;
  v_old_waiting_projection text := $old$
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
$old$;
  v_new_waiting_projection text := $new$
             not (
               case
                 when v_challenge.audience = 'public' then
                   coalesce(
                     challenge_projection.synced_at,
                     '-infinity'::timestamptz
                   ) >= (
                     (v_challenge.occurrence_end_date + 1)::timestamp
                       at time zone coalesce(valid_timezone.name, 'UTC')
                   )
                   and challenge_projection.source_updated_at is not null
                   and current_snapshot.updated_at is not null
                   and challenge_projection.source_updated_at =
                     current_snapshot.updated_at
                 else coalesce(
                   member.last_data_synced_at,
                   '-infinity'::timestamptz
                 ) >= (
                   (v_challenge.occurrence_end_date + 1)::timestamp
                     at time zone coalesce(valid_timezone.name, 'UTC')
                 )
               end
             )
$new$;
begin
  select pg_catalog.pg_get_functiondef(
           'public.stage_group_challenge_notifications(integer)'::regprocedure
         )
    into v_definition;
  if pg_catalog.strpos(v_definition, v_old_occurrence_participants) = 0
     or pg_catalog.strpos(v_definition, v_old_challenge_participants) = 0
     or pg_catalog.strpos(v_definition, v_old_projection_table) = 0
     or pg_catalog.strpos(v_definition, v_old_projection_join) = 0
     or pg_catalog.strpos(v_definition, v_old_projection_ready) = 0
     or pg_catalog.strpos(v_definition, v_old_waiting_projection) = 0 then
    raise exception 'Unexpected occurrence settlement worker shape'
      using errcode = 'P0001';
  end if;
  v_definition := replace(
    v_definition,
    v_old_occurrence_participants,
    v_new_occurrence_participants
  );
  v_definition := replace(
    v_definition,
    v_old_challenge_participants,
    v_new_challenge_participants
  );
  v_definition := replace(
    v_definition,
    v_old_projection_table,
    v_new_projection_table
  );
  v_definition := replace(
    v_definition,
    v_old_projection_join,
    v_new_projection_join
  );
  v_definition := replace(
    v_definition,
    v_old_projection_ready,
    v_new_projection_ready
  );
  v_definition := replace(
    v_definition,
    v_old_waiting_projection,
    v_new_waiting_projection
  );
  execute v_definition;
end;
$migration$;

-- Public challenges may contain thousands of accepted participants. The
-- installed worker previously recomputed the full scorer for every recipient
-- and attempted every recipient in one transaction. Materialize one indexed
-- standing set per occurrence, then rotate through at most p_limit recipients
-- across all occurrences in one invocation. Notification state timestamps make
-- unvisited recipients sort first, so retries advance durably without a second
-- cursor table; canonical result snapshots are reused after first settlement.
create index if not exists group_challenge_notification_state_pending_idx
  on public.group_challenge_notification_state (challenge_id, occurrence_date)
  where result_notified_at is null;

do $migration$
declare
  v_definition text;
  v_exact_pattern text :=
    'public[.]group_challenge_exact_standings[(]' ||
    '[[:space:]]*v_challenge[.]id[[:space:]]*,' ||
    '[[:space:]]*v_challenge[.]occurrence_date[[:space:]]*,' ||
    '[[:space:]]*v_challenge[.]occurrence_end_date[[:space:]]*[)]';
  v_exact_calls integer;
  v_begin_anchor text := $old$
begin
  for v_challenge in
$old$;
  v_begin_replacement text := $new$
begin
  create temporary table if not exists pg_temp.challenge_worker_standings (
    user_id uuid primary key,
    display_name text not null,
    total numeric not null,
    rank_value numeric not null,
    standing_position bigint not null,
    winner boolean not null,
    competitor_count bigint not null
  ) on commit drop;
  create index if not exists challenge_worker_standings_position_idx
    on pg_temp.challenge_worker_standings (standing_position, display_name);
  for v_challenge in
$new$;
  v_retry_anchor text := $old$
             greatest(
               current_date - 30,
               (runtime.activated_at at time zone 'UTC')::date - 1
             ) as retry_from
$old$;
  v_retry_replacement text := $new$
             least(
               greatest(
                 current_date - 30,
                 (runtime.activated_at at time zone 'UTC')::date - 1
               ),
               coalesce(
                 (
                   select min(pending_state.occurrence_date)
                     from public.group_challenge_notification_state pending_state
                    where pending_state.challenge_id = challenge.id
                      and pending_state.result_notified_at is null
                 ),
                 greatest(
                   current_date - 30,
                   (runtime.activated_at at time zone 'UTC')::date - 1
                 )
               )
             ) as retry_from
$new$;
  v_materialize_anchor text := $old$
    v_settlement_at := clock_timestamp();
$old$;
  v_materialize_replacement text := $new$
    truncate table pg_temp.challenge_worker_standings;
    insert into pg_temp.challenge_worker_standings (
      user_id, display_name, total, rank_value,
      standing_position, winner, competitor_count
    )
    select snapshot.user_id,
           coalesce(profile.display_name, 'A participant'),
           snapshot.total,
           snapshot.total,
           snapshot.standing_position,
           snapshot.winner,
           snapshot.competitor_count
      from public.group_challenge_result_placements snapshot
      left join public.profiles profile on profile.id = snapshot.user_id
     where snapshot.challenge_id = v_challenge.id
       and snapshot.occurrence_date = v_challenge.occurrence_date
       and exists (
         select 1
           from public.group_challenge_result_settlements settlement
          where settlement.challenge_id = v_challenge.id
            and settlement.occurrence_date = v_challenge.occurrence_date
       )
    union all
    select standing.user_id,
           standing.display_name,
           standing.total,
           standing.rank_value,
           standing.standing_position,
           standing.winner,
           count(*) over ()
      from public.group_challenge_exact_standings(
        v_challenge.id,
        v_challenge.occurrence_date,
        v_challenge.occurrence_end_date
      ) standing
     where not exists (
       select 1
         from public.group_challenge_result_settlements settlement
        where settlement.challenge_id = v_challenge.id
          and settlement.occurrence_date = v_challenge.occurrence_date
     );
    v_settlement_at := clock_timestamp();
$new$;
  v_old_recipient_tail text := $old$
        left join public.profiles profile on profile.id = accepted.user_id
        left join pg_catalog.pg_timezone_names valid_timezone
          on valid_timezone.name = profile.timezone
       where v_challenge.audience = 'public' or member.user_id is not null
    loop
$old$;
  v_new_recipient_tail text := $new$
        left join public.profiles profile on profile.id = accepted.user_id
        left join pg_catalog.pg_timezone_names valid_timezone
          on valid_timezone.name = profile.timezone
        left join public.group_challenge_notification_state recipient_state
          on recipient_state.challenge_id = v_challenge.id
         and recipient_state.occurrence_date = v_challenge.occurrence_date
         and recipient_state.recipient_id = accepted.user_id
       where (v_challenge.audience = 'public' or member.user_id is not null)
         and (
           v_settlement_at at time zone coalesce(valid_timezone.name, 'UTC')
         )::date >= v_challenge.occurrence_date
       order by
         case when recipient_state.result_notified_at is null then 0 else 1 end,
         coalesce(recipient_state.updated_at, '-infinity'::timestamptz),
         accepted.user_id
       limit v_recipient_budget
    loop
      v_recipient_budget := v_recipient_budget - 1;
$new$;
  v_tail_anchor text := $old$
    end loop;
  end loop;
end;
$old$;
  v_tail_replacement text := $new$
    end loop;
    exit when v_recipient_budget <= 0;
  end loop;
end;
$new$;
  v_waiting_continue_anchor text := $old$
          continue;
        end if;
        if v_all_participants_finished and v_state.result_notified_at is null then
$old$;
  v_waiting_continue_replacement text := $new$
          update public.group_challenge_notification_state
             set last_reminder_at = clock_timestamp(),
                 updated_at = clock_timestamp()
           where challenge_id = v_challenge.id
             and occurrence_date = v_challenge.occurrence_date
             and recipient_id = v_recipient.user_id;
          continue;
        end if;
        if v_all_participants_finished and v_state.result_notified_at is null then
$new$;
begin
  select pg_catalog.pg_get_functiondef(
           'public.stage_group_challenge_notifications(integer)'::regprocedure
         )
    into v_definition;
  select count(*)
    into v_exact_calls
    from pg_catalog.regexp_matches(v_definition, v_exact_pattern, 'g');
  if v_exact_calls <> 7
     or pg_catalog.strpos(v_definition, v_begin_anchor) = 0
     or pg_catalog.strpos(v_definition, v_retry_anchor) = 0
     or pg_catalog.strpos(v_definition, v_materialize_anchor) = 0
     or pg_catalog.strpos(v_definition, v_old_recipient_tail) = 0
     or pg_catalog.strpos(v_definition, v_tail_anchor) = 0
     or pg_catalog.strpos(v_definition, v_waiting_continue_anchor) = 0
     or pg_catalog.strpos(v_definition, '  v_waiting_names text;') = 0
     or pg_catalog.strpos(
          v_definition,
          'select standing.*, count(*) over () as competitor_count'
        ) = 0 then
    raise exception 'Unexpected scalable challenge worker shape'
      using errcode = 'P0001';
  end if;

  -- Replace the seven existing scorer calls before injecting the single
  -- materialization call below, otherwise the injected source would rewrite
  -- itself to the temporary table.
  v_definition := pg_catalog.regexp_replace(
    v_definition,
    v_exact_pattern,
    'pg_temp.challenge_worker_standings',
    'g'
  );
  v_definition := pg_catalog.replace(
    v_definition,
    'select standing.*, count(*) over () as competitor_count',
    'select standing.*'
  );
  v_definition := pg_catalog.replace(
    v_definition,
    '  v_waiting_names text;',
    '  v_waiting_names text;' || chr(10) ||
      '  v_recipient_budget integer := greatest(' ||
      '1, least(coalesce(p_limit, 100), 500));'
  );
  v_definition := pg_catalog.replace(
    v_definition,
    v_begin_anchor,
    v_begin_replacement
  );
  v_definition := pg_catalog.replace(
    v_definition,
    v_retry_anchor,
    v_retry_replacement
  );
  v_definition := pg_catalog.replace(
    v_definition,
    v_materialize_anchor,
    v_materialize_replacement
  );
  v_definition := pg_catalog.replace(
    v_definition,
    v_old_recipient_tail,
    v_new_recipient_tail
  );
  v_definition := pg_catalog.replace(
    v_definition,
    v_tail_anchor,
    v_tail_replacement
  );
  v_definition := pg_catalog.replace(
    v_definition,
    v_waiting_continue_anchor,
    v_waiting_continue_replacement
  );
  execute v_definition;
end;
$migration$;

-- The dedicated Challenges screen owns challenge focus and result rendering.
-- Upgrade every already-installed challenge emitter atomically so native and
-- web push taps never fall back to the generic Leaderboard route.
do $migration$
declare
  v_function regprocedure;
  v_definition text;
begin
  foreach v_function in array array[
    'public.emit_group_challenge_notification_events()'::regprocedure,
    'public.emit_group_challenge_all_accepted_notification()'::regprocedure,
    'public.stage_group_challenge_notifications(integer)'::regprocedure
  ]
  loop
    select pg_catalog.pg_get_functiondef(v_function) into v_definition;
    if pg_catalog.strpos(v_definition, '''/group''') = 0 then
      raise exception 'Unexpected challenge notification route shape for %',
        v_function::text using errcode = 'P0001';
    end if;
    v_definition := pg_catalog.replace(
      v_definition,
      '''/group''',
      '''/challenges'''
    );
    execute v_definition;
  end loop;

  update public.push_dispatch_events
     set data = pg_catalog.jsonb_set(
       coalesce(data, '{}'::jsonb),
       '{route}',
       pg_catalog.to_jsonb('/challenges'::text),
       true
     )
   where category = 'challenge'
     and dispatched_at is null
     and data ? 'challengeId';
end;
$migration$;

notify pgrst, 'reload schema';
