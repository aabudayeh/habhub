-- Fast, versioned group activity reads for leaderboards and shared logs.
-- The mobile client keeps the last successful snapshot locally and uses this
-- version row only as an invalidation signal. PostgreSQL remains authoritative.

create index if not exists group_members_user_group_idx
  on public.group_members (user_id, group_id);

create index if not exists metric_definitions_group_id_idx
  on public.metric_definitions (group_id, id);

create index if not exists metric_entries_group_activity_idx
  on public.metric_entries (metric_id, local_date, user_id, updated_at desc);

create index if not exists metric_entries_owner_activity_idx
  on public.metric_entries (user_id, metric_id, local_date, updated_at desc);

create index if not exists daily_metric_status_group_date_idx
  on public.daily_metric_status
    (group_id, local_date, metric_id, user_id, updated_at desc);

create index if not exists messages_group_cursor_v2_idx
  on public.messages (group_id, created_at desc, id desc);

-- Pending membership requests must not satisfy the read policies used by
-- activity, chat, media, and metric tables.
create or replace function public.is_group_member(target_group_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.group_members membership
    where membership.group_id = target_group_id
      and membership.user_id = (select auth.uid())
      and membership.status = 'active'
  );
$$;

create table if not exists public.metric_entry_tombstones (
  group_id uuid not null references public.groups(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  client_generated_id text not null,
  local_date date not null,
  visibility public.entry_visibility not null default 'private',
  deleted_at timestamptz not null default now(),
  primary key (user_id, client_generated_id)
);
alter table public.metric_entry_tombstones
  add column if not exists visibility public.entry_visibility
  not null default 'private';
create index if not exists metric_entry_tombstones_group_date_idx
  on public.metric_entry_tombstones (group_id, local_date, deleted_at desc);

alter table public.metric_entry_tombstones enable row level security;
drop policy if exists metric_entry_tombstones_member_read
  on public.metric_entry_tombstones;
create policy metric_entry_tombstones_member_read
  on public.metric_entry_tombstones
  for select
  to authenticated
  using (
    user_id = (select auth.uid())
    or (
      visibility = 'group'
      and public.is_group_member(group_id)
    )
  );
drop policy if exists metric_entry_tombstones_owner_insert
  on public.metric_entry_tombstones;
create policy metric_entry_tombstones_owner_insert
  on public.metric_entry_tombstones
  for insert
  to authenticated
  with check (
    user_id = (select auth.uid())
    and public.is_group_member(group_id)
  );
drop policy if exists metric_entry_tombstones_owner_update
  on public.metric_entry_tombstones;
create policy metric_entry_tombstones_owner_update
  on public.metric_entry_tombstones
  for update
  to authenticated
  using (user_id = (select auth.uid()))
  with check (
    user_id = (select auth.uid())
    and public.is_group_member(group_id)
  );
drop policy if exists metric_entry_tombstones_owner_delete
  on public.metric_entry_tombstones;
create policy metric_entry_tombstones_owner_delete
  on public.metric_entry_tombstones
  for delete
  to authenticated
  using (user_id = (select auth.uid()));

-- Explicit deletion is atomic: first retain an authorized tombstone, then
-- remove the value. A bounded/offline device cache is never interpreted as a
-- deletion request.
create or replace function public.delete_group_metric_entries(
  p_client_generated_ids text[]
)
returns table (
  deleted_client_generated_id text,
  deleted_local_date date
)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  doomed record;
begin
  for doomed in
    select
      entry.id,
      entry.metric_id,
      entry.client_generated_id,
      entry.local_date,
      entry.visibility,
      definition.group_id
    from public.metric_entries entry
    join public.metric_definitions definition
      on definition.id = entry.metric_id
    where entry.user_id = (select auth.uid())
      and entry.client_generated_id = any(p_client_generated_ids)
      and definition.group_id is not null
  loop
    insert into public.metric_entry_tombstones (
      group_id,
      user_id,
      client_generated_id,
      local_date,
      visibility,
      deleted_at
    )
    values (
      doomed.group_id,
      (select auth.uid()),
      doomed.client_generated_id,
      doomed.local_date,
      doomed.visibility,
      now()
    )
    on conflict (user_id, client_generated_id) do update
      set group_id = excluded.group_id,
          local_date = excluded.local_date,
          visibility = excluded.visibility,
          deleted_at = excluded.deleted_at;

    delete from public.metric_entries
    where id = doomed.id
      and user_id = (select auth.uid());

    -- Never leave a stale aggregate behind if the client loses connectivity
    -- before it can upload the recalculated day.
    delete from public.daily_metric_status
    where group_id = doomed.group_id
      and metric_id = doomed.metric_id
      and user_id = (select auth.uid())
      and local_date = doomed.local_date
      and not exists (
        select 1
        from public.metric_entries remaining
        where remaining.metric_id = doomed.metric_id
          and remaining.user_id = (select auth.uid())
          and remaining.local_date = doomed.local_date
      );
    return query
      select doomed.client_generated_id::text, doomed.local_date::date;
  end loop;
end;
$$;

revoke all on function public.delete_group_metric_entries(text[])
  from public;
grant execute on function public.delete_group_metric_entries(text[])
  to authenticated;

create table if not exists public.group_activity_versions (
  group_id uuid primary key references public.groups(id) on delete cascade,
  version bigint not null default 1 check (version > 0),
  since_date date not null default (current_date - 120),
  updated_at timestamptz not null default now()
);
alter table public.group_activity_versions
  add column if not exists since_date date
  not null default (current_date - 120);

alter table public.group_activity_versions enable row level security;

drop policy if exists group_activity_versions_member_read
  on public.group_activity_versions;
create policy group_activity_versions_member_read
  on public.group_activity_versions
  for select
  to authenticated
  using (public.is_group_member(group_id));

-- A status-only share may reveal completion/progress, but a private row must
-- remain owner-only. This policy is also enforced when the snapshot RPC runs
-- as the caller.
drop policy if exists daily_status_member_read
  on public.daily_metric_status;
create policy daily_status_member_read
  on public.daily_metric_status
  for select
  to authenticated
  using (
    user_id = (select auth.uid())
    or (
      public.is_group_member(group_id)
      and coalesce(visibility::text, 'status') <> 'private'
    )
  );

-- PostgREST and Postgres Changes expose whole authorized rows. Enforce the
-- exact-value privacy rule in stored data as well as in the snapshot RPC so a
-- status-only row can never carry a readable exact value.
-- `exact_value` pre-dates the visibility column and was only populated for
-- exact group sharing, so preserve those legacy values during the backfill.
drop trigger if exists daily_metric_status_fill_shared_value
  on public.daily_metric_status;

update public.daily_metric_status
set visibility = 'group'
where visibility is null
  and exact_value is not null;

update public.daily_metric_status
set exact_value = null
where coalesce(visibility::text, 'status') <> 'group'
  and exact_value is not null;

alter table public.daily_metric_status
  drop constraint if exists daily_metric_status_exact_value_visibility_check;
alter table public.daily_metric_status
  add constraint daily_metric_status_exact_value_visibility_check
  check (
    coalesce(visibility::text, 'status') = 'group'
    or exact_value is null
  );

-- Keep the existing aggregate-repair trigger aligned with the privacy
-- invariant above. Status/private sharing can report completion but never an
-- exact value, even if older group-visible raw entries remain for that day.
create or replace function public.fill_daily_metric_shared_value()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  shared_value numeric;
  shared_entry_exists boolean;
  status_entry_exists boolean;
begin
  select exists (
    select 1
    from public.metric_entries entry
    where entry.metric_id = new.metric_id
      and entry.user_id = new.user_id
      and entry.local_date = new.local_date
      and entry.visibility = 'group'
  ) into shared_entry_exists;

  select exists (
    select 1
    from public.metric_entries entry
    where entry.metric_id = new.metric_id
      and entry.user_id = new.user_id
      and entry.local_date = new.local_date
      and entry.visibility = 'status'
  ) into status_entry_exists;

  if coalesce(new.visibility::text, 'status') <> 'group' then
    new.exact_value := null;
  elsif shared_entry_exists then
    select case definition.aggregation_method
      when 'average' then avg(values.numeric_value)
      when 'latest' then
        (array_agg(values.numeric_value order by values.recorded_at desc))[1]
      when 'max' then max(values.numeric_value)
      when 'min' then min(values.numeric_value)
      else sum(values.numeric_value)
    end
    into shared_value
    from public.metric_definitions definition
    join (
      select
        entry.metric_id,
        entry.recorded_at,
        case jsonb_typeof(entry.value)
          when 'number' then (entry.value #>> '{}')::numeric
          when 'boolean' then
            case when (entry.value #>> '{}')::boolean then 1 else 0 end
          else null
        end as numeric_value
      from public.metric_entries entry
      where entry.metric_id = new.metric_id
        and entry.user_id = new.user_id
        and entry.local_date = new.local_date
        and entry.visibility = 'group'
    ) values on values.metric_id = definition.id
    where definition.id = new.metric_id
    group by definition.aggregation_method;

    new.exact_value := shared_value;
  end if;

  new.has_data :=
    coalesce(new.has_data, false)
    or new.exact_value is not null
    or shared_entry_exists
    or status_entry_exists;
  return new;
end;
$$;

create trigger daily_metric_status_fill_shared_value
before insert or update on public.daily_metric_status
for each row execute function public.fill_daily_metric_shared_value();

-- Raw entry values are shared only for exact-value visibility. Goal-status
-- sharing is represented by daily_metric_status and must not expose the entry.
drop policy if exists entries_shared_read
  on public.metric_entries;
drop policy if exists entries_exact_group_read
  on public.metric_entries;
create policy entries_shared_read
  on public.metric_entries
  for select
  to authenticated
  using (
    visibility::text = 'group'
    and exists (
      select 1
      from public.metric_definitions definition
      where definition.id = metric_id
        and definition.group_id is not null
        and public.is_group_member(definition.group_id)
    )
  );

insert into public.group_activity_versions (group_id)
select id from public.groups
on conflict (group_id) do nothing;

-- The client calls this only after its entry and derived-status batches both
-- succeed. The version is therefore a commit marker; partially uploaded data
-- is not announced to peers.
create or replace function public.commit_group_activity_version(
  p_group_id uuid,
  p_since_date date default (current_date - 120)
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  committed_version bigint;
begin
  if not exists (
    select 1
    from public.group_members membership
    where membership.group_id = p_group_id
      and membership.user_id = (select auth.uid())
      and membership.status = 'active'
  ) then
    raise exception 'Not authorized for this group';
  end if;
  insert into public.group_activity_versions (
    group_id,
    version,
    since_date,
    updated_at
  )
  values (
    p_group_id,
    1,
    greatest(p_since_date, current_date - 120),
    now()
  )
  on conflict (group_id) do update
    set version = public.group_activity_versions.version + 1,
        since_date = excluded.since_date,
        updated_at = excluded.updated_at
  returning version into committed_version;
  return committed_version;
end;
$$;

revoke all on function public.commit_group_activity_version(uuid, date)
  from public;
grant execute on function public.commit_group_activity_version(uuid, date)
  to authenticated;

drop trigger if exists metric_entries_bump_group_activity
  on public.metric_entries;
drop trigger if exists daily_status_bump_group_activity
  on public.daily_metric_status;
drop function if exists public.bump_group_activity_version();
drop trigger if exists daily_status_insert_bump_group_activity
  on public.daily_metric_status;
drop trigger if exists daily_status_update_bump_group_activity
  on public.daily_metric_status;
drop trigger if exists daily_status_delete_bump_group_activity
  on public.daily_metric_status;
drop trigger if exists metric_definitions_insert_bump_group_activity
  on public.metric_definitions;
drop trigger if exists metric_definitions_update_bump_group_activity
  on public.metric_definitions;
drop trigger if exists metric_definitions_delete_bump_group_activity
  on public.metric_definitions;
drop function if exists public.bump_changed_group_activity_versions();

-- One MVCC-consistent request replaces separate entry/status queries that
-- could previously observe different moments during an upload.
create or replace function public.get_group_activity_snapshot(
  p_group_id uuid,
  p_since_date date default (current_date - 120)
)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select jsonb_build_object(
    'version',
      coalesce(
        (
          select version
          from public.group_activity_versions
          where group_id = p_group_id
        ),
        0
      ),
    'updated_at',
      (
        select updated_at
        from public.group_activity_versions
        where group_id = p_group_id
      ),
    'since_date',
      (
        select since_date
        from public.group_activity_versions
        where group_id = p_group_id
      ),
    'metrics',
      coalesce(
        (
          select jsonb_agg(
            jsonb_build_object('id', definition.id, 'slug', definition.slug)
            order by definition.slug
          )
          from public.metric_definitions definition
          where definition.group_id = p_group_id
        ),
        '[]'::jsonb
      ),
    'entries',
      coalesce(
        (
          select jsonb_agg(to_jsonb(entry) order by entry.recorded_at, entry.id)
          from public.metric_entries entry
          join public.metric_definitions definition
            on definition.id = entry.metric_id
          where definition.group_id = p_group_id
            and entry.local_date >= greatest(
              p_since_date,
              current_date - 120
            )
        ),
        '[]'::jsonb
      ),
    'statuses',
      coalesce(
        (
          select jsonb_agg(
            to_jsonb(status) || jsonb_build_object(
              'exact_value',
              case
                when status.user_id = (select auth.uid())
                  or status.visibility::text = 'group'
                then status.exact_value
                else null
              end
            )
            order by status.local_date, status.metric_id, status.user_id
          )
          from public.daily_metric_status status
          where status.group_id = p_group_id
            and (
              status.user_id = (select auth.uid())
              or coalesce(status.visibility::text, 'status') <> 'private'
            )
            and status.local_date >= greatest(
              p_since_date,
              current_date - 120
            )
        ),
        '[]'::jsonb
      ),
    'tombstones',
      coalesce(
        (
          select jsonb_agg(
            jsonb_build_object(
              'user_id', tombstone.user_id,
              'client_generated_id', tombstone.client_generated_id,
              'local_date', tombstone.local_date,
              'deleted_at', tombstone.deleted_at
            )
            order by tombstone.deleted_at, tombstone.client_generated_id
          )
          from public.metric_entry_tombstones tombstone
          where tombstone.group_id = p_group_id
            and tombstone.local_date >= greatest(
              p_since_date,
              current_date - 120
            )
        ),
        '[]'::jsonb
      )
  )
  where public.is_group_member(p_group_id);
$$;

revoke all on function public.get_group_activity_snapshot(uuid, date)
  from public;
grant execute on function public.get_group_activity_snapshot(uuid, date)
  to authenticated;

-- Broadcast only compact invalidations. Clients fetch the authorized rows
-- after receiving them, so raw health values and private chat content never
-- travel through the realtime payload.
drop policy if exists metrally_group_broadcast_read
  on realtime.messages;
create policy metrally_group_broadcast_read
  on realtime.messages
  for select
  to authenticated
  using (
    case
      when (select realtime.topic()) ~
        '^group:[0-9a-fA-F-]{36}:(activity|chat)$'
      then exists (
        select 1
        from public.group_members membership
        where membership.user_id = (select auth.uid())
          and membership.status = 'active'
          and membership.group_id::text =
            split_part((select realtime.topic()), ':', 2)
      )
      else false
    end
  );

create or replace function public.broadcast_group_activity_version()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  begin
    perform realtime.send(
      jsonb_build_object(
        'group_id', new.group_id,
        'version', new.version,
        'since_date', new.since_date,
        'updated_at', new.updated_at
      ),
      'activity_updated',
      'group:' || new.group_id::text || ':activity',
      true
    );
  exception when others then
    raise warning 'MetricRally activity broadcast failed: %', sqlerrm;
  end;
  return new;
end;
$$;

drop trigger if exists group_activity_version_broadcast
  on public.group_activity_versions;
create trigger group_activity_version_broadcast
after insert or update on public.group_activity_versions
for each row execute function public.broadcast_group_activity_version();

-- A compact, RLS-filtered Postgres Changes stream is the fallback if private
-- Broadcast is temporarily unavailable. It still emits only once per coherent
-- commit, never once per raw entry/status row.
do $$ begin
  alter publication supabase_realtime
    add table public.group_activity_versions;
exception when duplicate_object then null; end $$;

create or replace function public.broadcast_group_chat_commit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Direct-message delivery continues to use the RLS-filtered Postgres Changes
  -- fallback so unrelated group members are not awakened by private traffic.
  if new.recipient_id is null then
    begin
      perform realtime.send(
        jsonb_build_object(
          'group_id', new.group_id,
          'message_id', new.id,
          'created_at', new.created_at
        ),
        'message_committed',
        'group:' || new.group_id::text || ':chat',
        true
      );
    exception when others then
      raise warning 'MetricRally chat broadcast failed: %', sqlerrm;
    end;
  end if;
  return new;
end;
$$;

drop trigger if exists messages_group_chat_broadcast
  on public.messages;
create trigger messages_group_chat_broadcast
after insert on public.messages
for each row execute function public.broadcast_group_chat_commit();
