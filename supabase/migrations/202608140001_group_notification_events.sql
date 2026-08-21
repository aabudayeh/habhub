-- Durable, recipient-scoped Leaderboard feed items. Challenge events are
-- emitted by database triggers so the in-app feed does not depend on a phone
-- staying open long enough to complete a second client write.
create table if not exists public.group_notification_events (
  id uuid primary key default gen_random_uuid(),
  event_key text not null check (char_length(event_key) between 1 and 180),
  group_id uuid not null references public.groups(id) on delete cascade,
  recipient_id uuid not null references public.profiles(id) on delete cascade,
  actor_id uuid not null references public.profiles(id) on delete cascade,
  event_type text not null check (
    event_type in ('challenge_invitation', 'challenge_accepted')
  ),
  challenge_id uuid not null
    references public.group_challenges(id) on delete cascade,
  created_at timestamptz not null default now(),
  read_at timestamptz,
  unique (recipient_id, event_key)
);

create index if not exists group_notification_events_recipient_group_idx
  on public.group_notification_events (
    recipient_id,
    group_id,
    created_at desc
  );

alter table public.group_notification_events enable row level security;

drop policy if exists group_notification_events_recipient_read
  on public.group_notification_events;
create policy group_notification_events_recipient_read
on public.group_notification_events
for select
to authenticated
using (
  recipient_id = (select auth.uid())
  and public.is_group_member(group_id)
);

-- Clients can only read their own active-group feed. Creation is trigger-only
-- and read state changes go through the narrow RPC below, so a recipient can
-- never rewrite the actor, group, kind, or challenge identity.
revoke all on table public.group_notification_events
  from public, anon, authenticated;
grant select on table public.group_notification_events to authenticated;

-- Canonical server-owned push events double as a durable outbox. Clients may
-- ask the Edge dispatcher to send an event key, but cannot choose its copy,
-- audience, recipient, route, category, or tracker preference identity.
create table if not exists public.push_dispatch_events (
  id uuid primary key default gen_random_uuid(),
  event_key text not null unique
    check (char_length(event_key) between 1 and 240),
  group_id uuid not null references public.groups(id) on delete cascade,
  dispatcher_id uuid not null references public.profiles(id) on delete cascade,
  category text not null check (
    category in ('metric', 'lead', 'winner', 'membership', 'challenge')
  ),
  event_type text not null,
  audience text not null check (
    audience in (
      'admins',
      'user',
      'group',
      'group_including_sender',
      'challenge_participants'
    )
  ),
  recipient_id uuid references public.profiles(id) on delete cascade,
  metric_slug text,
  title text not null check (char_length(title) between 1 and 120),
  body text not null check (char_length(body) between 1 and 500),
  data jsonb not null default '{}'::jsonb
    check (jsonb_typeof(data) = 'object'),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '24 hours'),
  -- This records acceptance/suppression by the push gateway, never handset
  -- delivery. Expo receipts require a separate scheduled server worker.
  dispatched_at timestamptz,
  attempt_count integer not null default 0,
  last_error text
);

create index if not exists push_dispatch_events_pending_dispatcher_idx
  on public.push_dispatch_events (dispatcher_id, created_at)
  where dispatched_at is null;

alter table public.push_dispatch_events enable row level security;

drop policy if exists push_dispatch_events_dispatcher_read
  on public.push_dispatch_events;
create policy push_dispatch_events_dispatcher_read
on public.push_dispatch_events
for select
to authenticated
using (
  dispatcher_id = (select auth.uid())
  or (
    category = 'winner'
    and public.is_group_member(group_id)
  )
);

revoke all on table public.push_dispatch_events
  from public, anon, authenticated;
grant select on table public.push_dispatch_events to authenticated;

-- Private rollout state prevents the temporary legacy membership bridge from
-- synthesizing an event once the transactional push triggers are active.
create table if not exists public.push_dispatch_configuration (
  singleton boolean primary key default true check (singleton),
  emitters_active boolean not null default false,
  updated_at timestamptz not null default now()
);
insert into public.push_dispatch_configuration (singleton, emitters_active)
values (true, false)
on conflict (singleton) do nothing;
alter table public.push_dispatch_configuration enable row level security;
revoke all on table public.push_dispatch_configuration
  from public, anon, authenticated;

-- Per-token gateway acceptance prevents a later failed Expo batch from
-- resending tokens accepted by an earlier batch. This is server-only metadata;
-- an Expo ticket still is not proof of handset delivery.
create table if not exists public.push_token_dispatch_acceptances (
  -- Deliberately not an FK to push_events: transient retries release that
  -- global claim, while per-token acceptance must survive the release.
  event_key text not null,
  token text not null,
  accepted_at timestamptz not null default now(),
  primary key (event_key, token)
);
create index if not exists push_token_dispatch_acceptances_retention_idx
  on public.push_token_dispatch_acceptances (accepted_at);
alter table public.push_token_dispatch_acceptances enable row level security;
revoke all on table public.push_token_dispatch_acceptances
  from public, anon, authenticated;

-- A service-private transition ledger gives the staged Edge bridge committed
-- proof for pre-mutation legacy leave/remove calls. It contains no values or
-- client-controlled copy and is never readable through the public API roles.
create table if not exists public.group_membership_transitions (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups(id) on delete cascade,
  member_id uuid not null references public.profiles(id) on delete cascade,
  actor_id uuid not null references public.profiles(id) on delete cascade,
  event_type text not null check (
    event_type in (
      'membership_request',
      'membership_joined',
      'membership_approved',
      'membership_left',
      'membership_removed',
      'membership_request_withdrawn',
      'membership_request_declined'
    )
  ),
  created_at timestamptz not null default now()
);
create index if not exists group_membership_transitions_bridge_idx
  on public.group_membership_transitions (
    actor_id, group_id, member_id, created_at desc
  );
alter table public.group_membership_transitions enable row level security;
revoke all on table public.group_membership_transitions
  from public, anon, authenticated;

create or replace function public.capture_group_membership_transition()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid := auth.uid();
  v_group_id uuid;
  v_member_id uuid;
  v_event_type text;
begin
  if tg_op = 'DELETE' then
    v_group_id := old.group_id;
    v_member_id := old.user_id;
  else
    v_group_id := new.group_id;
    v_member_id := new.user_id;
  end if;
  if v_actor_id is null or not exists (
    select 1 from public.groups target where target.id = v_group_id
  ) then
    if tg_op = 'DELETE' then return old; else return new; end if;
  end if;
  if tg_op = 'INSERT' then
    v_event_type := case when new.status = 'pending'
      then 'membership_request' else 'membership_joined' end;
  elsif tg_op = 'UPDATE' then
    if old.status = new.status then return new; end if;
    v_event_type := case
      when old.status = 'pending' and new.status = 'active'
           and v_actor_id <> new.user_id then 'membership_approved'
      else 'membership_joined'
    end;
  elsif old.status = 'pending' and v_actor_id = old.user_id then
    v_event_type := 'membership_request_withdrawn';
  elsif old.status = 'pending' then
    v_event_type := 'membership_request_declined';
  elsif v_actor_id = old.user_id then
    v_event_type := 'membership_left';
  else
    v_event_type := 'membership_removed';
  end if;
  insert into public.group_membership_transitions (
    group_id, member_id, actor_id, event_type
  ) values (v_group_id, v_member_id, v_actor_id, v_event_type);
  if tg_op = 'DELETE' then return old; else return new; end if;
end;
$$;
revoke all on function public.capture_group_membership_transition()
  from public, anon, authenticated;
drop trigger if exists group_members_capture_notification_transition
  on public.group_members;
create trigger group_members_capture_notification_transition
after insert or update of status or delete
on public.group_members
for each row execute function public.capture_group_membership_transition();

create or replace function public.emit_group_challenge_notification_events()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid;
begin
  if tg_op = 'INSERT' then
    foreach v_user_id in array new.participant_ids
    loop
      if v_user_id <> new.creator_id then
        insert into public.group_notification_events (
          event_key,
          group_id,
          recipient_id,
          actor_id,
          event_type,
          challenge_id,
          created_at
        ) values (
          'challenge-started:' || new.id::text,
          new.group_id,
          v_user_id,
          new.creator_id,
          'challenge_invitation',
          new.id,
          new.created_at
        )
        on conflict (recipient_id, event_key) do nothing;
      end if;
    end loop;

    insert into public.push_dispatch_events (
      event_key,
      group_id,
      dispatcher_id,
      category,
      event_type,
      audience,
      title,
      body,
      data
    ) values (
      'challenge-started:' || new.id::text,
      new.group_id,
      new.creator_id,
      'challenge',
      'challenge_started',
      'challenge_participants',
      'Challenge started',
      'Open HabHub to accept or decline.',
      jsonb_build_object(
        'route', '/group',
        'groupId', new.group_id,
        'challengeId', new.id,
        'challengeEvent', 'started'
      )
    ) on conflict (event_key) do nothing;
  elsif new.deleted_at is null then
    for v_user_id in
      select accepted_id
        from unnest(coalesce(new.accepted_participant_ids, array[]::uuid[]))
          accepted(accepted_id)
      except
      select accepted_id
        from unnest(coalesce(old.accepted_participant_ids, array[]::uuid[]))
          accepted(accepted_id)
    loop
      if v_user_id <> new.creator_id then
        insert into public.group_notification_events (
          event_key,
          group_id,
          recipient_id,
          actor_id,
          event_type,
          challenge_id
        ) values (
          'challenge-accepted:' || new.id::text || ':' || v_user_id::text,
          new.group_id,
          new.creator_id,
          v_user_id,
          'challenge_accepted',
          new.id
        )
        on conflict (recipient_id, event_key) do nothing;

        insert into public.push_dispatch_events (
          event_key,
          group_id,
          dispatcher_id,
          category,
          event_type,
          audience,
          recipient_id,
          title,
          body,
          data
        ) values (
          'challenge-accepted:' || new.id::text || ':' || v_user_id::text,
          new.group_id,
          v_user_id,
          'challenge',
          'challenge_accepted',
          'user',
          new.creator_id,
          'Challenge accepted',
          'A friend accepted your challenge.',
          jsonb_build_object(
            'route', '/group',
            'groupId', new.group_id,
            'challengeId', new.id,
            'challengeEvent', 'accepted'
          )
        ) on conflict (event_key) do nothing;
      end if;
    end loop;
  end if;
  return new;
end;
$$;

revoke all on function public.emit_group_challenge_notification_events()
  from public, anon, authenticated;

-- Keep the bell feed continuous during the expand -> Edge -> activation
-- rollout gap without creating any push outbox rows yet.
create or replace function public.emit_group_challenge_feed_events()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid;
begin
  if tg_op = 'INSERT' then
    foreach v_user_id in array new.participant_ids
    loop
      if v_user_id <> new.creator_id then
        insert into public.group_notification_events (
          event_key, group_id, recipient_id, actor_id, event_type,
          challenge_id, created_at
        ) values (
          'challenge-started:' || new.id::text,
          new.group_id,
          v_user_id,
          new.creator_id,
          'challenge_invitation',
          new.id,
          new.created_at
        ) on conflict (recipient_id, event_key) do nothing;
      end if;
    end loop;
  elsif new.deleted_at is null then
    for v_user_id in
      select accepted_id
        from unnest(coalesce(new.accepted_participant_ids, array[]::uuid[]))
          accepted(accepted_id)
      except
      select accepted_id
        from unnest(coalesce(old.accepted_participant_ids, array[]::uuid[]))
          accepted(accepted_id)
    loop
      if v_user_id <> new.creator_id then
        insert into public.group_notification_events (
          event_key, group_id, recipient_id, actor_id, event_type, challenge_id
        ) values (
          'challenge-accepted:' || new.id::text || ':' || v_user_id::text,
          new.group_id,
          new.creator_id,
          v_user_id,
          'challenge_accepted',
          new.id
        ) on conflict (recipient_id, event_key) do nothing;
      end if;
    end loop;
  end if;
  return new;
end;
$$;

revoke all on function public.emit_group_challenge_feed_events()
  from public, anon, authenticated;

drop trigger if exists group_challenges_emit_feed_events
  on public.group_challenges;
create trigger group_challenges_emit_feed_events
after insert or update of accepted_participant_ids
on public.group_challenges
for each row
execute function public.emit_group_challenge_feed_events();

-- Backfill only currently actionable invitations into the private bell feed.
-- This never creates push events or historical acceptance notifications.
insert into public.group_notification_events (
  event_key, group_id, recipient_id, actor_id, event_type, challenge_id,
  created_at
)
select
  'challenge-started:' || challenge.id::text,
  challenge.group_id,
  participant.user_id,
  challenge.creator_id,
  'challenge_invitation',
  challenge.id,
  challenge.created_at
from public.group_challenges challenge
cross join lateral unnest(challenge.participant_ids)
  participant(user_id)
join public.group_members membership
  on membership.group_id = challenge.group_id
 and membership.user_id = participant.user_id
 and membership.status = 'active'
where challenge.deleted_at is null
  and challenge.local_date >= current_date - 1
  and participant.user_id <> challenge.creator_id
  and not (
    participant.user_id = any(
      coalesce(challenge.accepted_participant_ids, array[]::uuid[])
    )
  )
  and not (
    participant.user_id = any(
      coalesce(challenge.declined_participant_ids, array[]::uuid[])
    )
  )
on conflict (recipient_id, event_key) do nothing;

create or replace function public.emit_group_membership_push_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid := auth.uid();
  v_group_id uuid;
  v_member_id uuid;
  v_group_name text;
  v_member_name text;
  v_event_type text;
  v_audience text;
  v_recipient_id uuid;
  v_title text;
  v_body text;
  v_route text;
begin
  if tg_op = 'DELETE' then
    v_group_id := old.group_id;
    v_member_id := old.user_id;
  else
    v_group_id := new.group_id;
    v_member_id := new.user_id;
  end if;
  if v_actor_id is null then
    if tg_op = 'DELETE' then return old; else return new; end if;
  end if;
  select target.name into v_group_name
    from public.groups target where target.id = v_group_id;
  -- A sole owner deleting the group cascades through memberships after the
  -- parent row is already gone. Do not create an FK child that can abort that
  -- transaction; there is no remaining audience for such an event anyway.
  if v_group_name is null then
    if tg_op = 'DELETE' then return old; else return new; end if;
  end if;
  select profile.display_name into v_member_name
    from public.profiles profile where profile.id = v_member_id;
  v_group_name := coalesce(v_group_name, 'your group');
  v_member_name := coalesce(v_member_name, 'A member');

  if tg_op = 'INSERT' then
    if new.status = 'pending' then
      v_event_type := 'membership_request';
      v_audience := 'admins';
      v_title := v_member_name || ' wants to join';
      v_body := 'Review the request for ' || v_group_name || '.';
      v_route := '/group-settings';
    else
      v_event_type := 'membership_joined';
      v_audience := 'admins';
      v_title := v_member_name || ' joined';
      v_body := v_member_name || ' is now in ' || v_group_name || '.';
      v_route := '/group-settings';
    end if;
  elsif tg_op = 'UPDATE' then
    if old.status = new.status then
      return new;
    end if;
    if old.status = 'pending' and new.status = 'active'
       and v_actor_id <> new.user_id then
      v_event_type := 'membership_approved';
      v_audience := 'user';
      v_recipient_id := new.user_id;
      v_title := 'Welcome to ' || v_group_name;
      v_body := 'Your request was approved. Tap to open the group.';
      v_route := '/group';
    else
      v_event_type := 'membership_joined';
      v_audience := 'admins';
      v_title := v_member_name || ' joined';
      v_body := v_member_name || ' is now in ' || v_group_name || '.';
      v_route := '/group-settings';
    end if;
  elsif old.status = 'pending' and v_actor_id = old.user_id then
    v_event_type := 'membership_request_withdrawn';
    v_audience := 'admins';
    v_title := v_member_name || ' withdrew a join request';
    v_body := 'The join request for ' || v_group_name || ' was withdrawn.';
    v_route := '/group-settings';
  elsif old.status = 'pending' then
    v_event_type := 'membership_request_declined';
    v_audience := 'user';
    v_recipient_id := old.user_id;
    v_title := 'Join request updated';
    v_body := 'Your request to join ' || v_group_name || ' was declined.';
    v_route := '/groups';
  elsif v_actor_id = old.user_id then
    v_event_type := 'membership_left';
    v_audience := 'admins';
    v_title := v_member_name || ' left';
    v_body := v_member_name || ' left ' || v_group_name || '.';
    v_route := '/group-settings';
  else
    v_event_type := 'membership_removed';
    v_audience := 'user';
    v_recipient_id := old.user_id;
    v_title := 'Group membership updated';
    v_body := 'You were removed from ' || v_group_name || '.';
    v_route := '/groups';
  end if;

  insert into public.push_dispatch_events (
    event_key,
    group_id,
    dispatcher_id,
    category,
    event_type,
    audience,
    recipient_id,
    title,
    body,
    data
  ) values (
    replace(v_event_type, '_', '-') || ':' || v_group_id::text || ':' ||
      v_member_id::text || ':' || gen_random_uuid()::text,
    v_group_id,
    v_actor_id,
    'membership',
    v_event_type,
    v_audience,
    v_recipient_id,
    left(v_title, 120),
    left(v_body, 500),
    jsonb_build_object(
      'route', v_route,
      'groupId', v_group_id,
      'memberId', v_member_id,
      'membershipEvent', v_event_type
    )
  );
  if tg_op = 'DELETE' then return old; else return new; end if;
end;
$$;

revoke all on function public.emit_group_membership_push_event()
  from public, anon, authenticated;

create or replace function public.emit_group_metric_push_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_group_id uuid;
  v_metric_slug text;
  v_metric_name text;
  v_member_name text;
begin
  select definition.group_id, definition.slug, definition.name
    into v_group_id, v_metric_slug, v_metric_name
    from public.metric_definitions definition
   where definition.id = new.metric_id
     and definition.group_id is not null;
  if v_group_id is null
     or new.visibility = 'private'
     or new.recorded_at < now() - interval '15 minutes'
     or not exists (
       select 1 from public.group_members membership
        where membership.group_id = v_group_id
          and membership.user_id = new.user_id
          and membership.status = 'active'
     ) then
    return new;
  end if;
  select profile.display_name into v_member_name
    from public.profiles profile where profile.id = new.user_id;

  insert into public.push_dispatch_events (
    event_key,
    group_id,
    dispatcher_id,
    category,
    event_type,
    audience,
    metric_slug,
    title,
    body,
    data,
    expires_at
  ) values (
    case
      when char_length(
        'entry:' || v_group_id::text || ':' || new.user_id::text || ':' ||
          new.client_generated_id
      ) <= 240 then
        'entry:' || v_group_id::text || ':' || new.user_id::text || ':' ||
          new.client_generated_id
      else
        'entry:' || v_group_id::text || ':' || new.user_id::text || ':' ||
          pg_catalog.md5(new.client_generated_id)
    end,
    v_group_id,
    new.user_id,
    'metric',
    'metric_entry',
    'group',
    v_metric_slug,
    left(coalesce(v_member_name, 'A member') || ' logged ' || v_metric_name, 120),
    'A shared ' || v_metric_name || ' update was added.',
    jsonb_build_object(
      'route', '/day/' || new.local_date::text,
      'groupId', v_group_id,
      'metricId', v_metric_slug,
      'entryId', new.client_generated_id
    ),
    now() + interval '30 minutes'
  ) on conflict (event_key) do nothing;
  return new;
end;
$$;

revoke all on function public.emit_group_metric_push_event()
  from public, anon, authenticated;

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
  v_member_name text;
  v_ids text[];
  v_entry_id uuid;
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
  select entry.id, entry.updated_at
    into v_entry_id, v_latest
    from public.metric_entries entry
   where entry.metric_id = v_metric_id
     and entry.user_id = v_user_id
     and entry.visibility = 'group'
     and entry.client_generated_id = any(v_ids)
     and entry.updated_at >= now() - interval '30 minutes';
  if v_entry_id is null then
    raise exception 'Every source entry must be a fresh committed shared row.'
      using errcode = '42501';
  end if;
  select profile.display_name into v_member_name
    from public.profiles profile where profile.id = v_user_id;
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
    'Leaderboard updated',
    left(
      coalesce(v_member_name, 'A member') || ' shared new ' ||
        v_metric_name || ' activity. Open the Leaderboard for the latest standings.',
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

revoke all on function public.enqueue_group_lead_push_event(
  uuid, text, text[]
) from public, anon;
grant execute on function public.enqueue_group_lead_push_event(
  uuid, text, text[]
) to authenticated;

create or replace function public.enqueue_group_winner_push_event(
  p_group_id uuid,
  p_period_type text,
  p_anchor date
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_event_key text;
  v_title text;
  v_anchor_key text;
  v_timezone text;
  v_today date;
  v_week_starts_on integer;
  v_current_week_anchor date;
begin
  if v_user_id is null or not public.is_group_member(p_group_id) then
    raise exception 'Active group membership required.' using errcode = '42501';
  end if;
  select profile.timezone into v_timezone
    from public.profiles profile where profile.id = v_user_id;
  v_today := (now() at time zone coalesce(v_timezone, 'UTC'))::date;
  select case
    when snapshot.payload #>> '{settings,weekStartsOn}' ~ '^[0-6]$'
      then (snapshot.payload #>> '{settings,weekStartsOn}')::integer
    else 1
  end into v_week_starts_on
    from public.user_snapshots snapshot where snapshot.user_id = v_user_id;
  v_week_starts_on := greatest(0, least(6, coalesce(v_week_starts_on, 1)));
  v_current_week_anchor := v_today - (
    (extract(dow from v_today)::integer - v_week_starts_on + 7) % 7
  );

  if p_period_type = 'day' and p_anchor = v_today - 1 then
    v_title := 'Yesterday''s group results';
    v_anchor_key := p_anchor::text;
  elsif p_period_type = 'week'
        and v_today = v_current_week_anchor
        and p_anchor = v_current_week_anchor - 7 then
    v_title := 'Last week''s group results';
    v_anchor_key := p_anchor::text;
  elsif p_period_type = 'month'
        and p_anchor = (date_trunc('month', v_today) - interval '1 month')::date
        and v_today = date_trunc('month', v_today)::date then
    v_title := 'Last month''s group results';
    v_anchor_key := to_char(p_anchor, 'YYYY-MM');
  else
    raise exception 'Only a freshly completed group period can be announced.'
      using errcode = '22023';
  end if;
  v_event_key := 'winner:' || p_group_id::text || ':' || p_period_type || ':' ||
    v_anchor_key;
  insert into public.push_dispatch_events (
    event_key, group_id, dispatcher_id, category, event_type, audience,
    title, body, data
  ) values (
    v_event_key,
    p_group_id,
    v_user_id,
    'winner',
    'period_results',
    'group_including_sender',
    v_title,
    'Open HabHub to see the final Leaderboard results.',
    jsonb_build_object(
      'route', '/badges',
      'groupId', p_group_id,
      'periodType', p_period_type,
      'periodAnchor', v_anchor_key
    )
  ) on conflict (event_key) do nothing;
  return v_event_key;
end;
$$;

revoke all on function public.enqueue_group_winner_push_event(
  uuid, text, date
) from public, anon;
grant execute on function public.enqueue_group_winner_push_event(
  uuid, text, date
) to authenticated;

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
  if not public.is_group_member(p_group_id) then
    raise exception 'Active group membership required.' using errcode = '42501';
  end if;
  if cardinality(coalesce(p_event_ids, array[]::uuid[])) = 0 then
    return 0;
  end if;

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

revoke all on function public.mark_group_notification_events_read(
  uuid,
  uuid[]
) from public, anon;
grant execute on function public.mark_group_notification_events_read(
  uuid,
  uuid[]
) to authenticated;

-- The notification master is account-wide. Keep the expected account check
-- and all-token delete in one RLS-independent statement so an A-to-B auth
-- switch cannot silently acknowledge a zero-row delete for account A.
create or replace function public.delete_all_own_push_tokens(
  p_expected_user_id uuid
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_deleted integer := 0;
begin
  if v_user_id is null or v_user_id <> p_expected_user_id then
    raise exception 'Authenticated account changed during push disable.'
      using errcode = '42501';
  end if;
  delete from public.device_push_tokens token
   where token.user_id = v_user_id;
  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$$;

revoke all on function public.delete_all_own_push_tokens(uuid)
  from public, anon;
grant execute on function public.delete_all_own_push_tokens(uuid)
  to authenticated;

-- Postgres Changes evaluates the recipient RLS policy per subscription.
do $$
begin
  alter publication supabase_realtime
    add table public.group_notification_events;
exception when duplicate_object then null;
end;
$$;

notify pgrst, 'reload schema';
