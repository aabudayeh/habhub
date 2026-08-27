-- Generic, group-scoped reactions and comments for recap cards and shared logs.
-- Content is intentionally separate from account snapshots so engagement can
-- never widen access to the health/log data that produced a target card.

create table if not exists public.group_social_reactions (
  group_id uuid not null references public.groups(id) on delete cascade,
  target_type text not null check (
    target_type in (
      'recap_feed', 'metric_entry', 'photo_update',
      'badge', 'group_challenge', 'group_todo'
    )
  ),
  target_id text not null check (char_length(target_id) between 1 and 240),
  user_id uuid not null references public.profiles(id) on delete cascade,
  reaction text not null check (reaction in ('heart', 'thumbs_up', 'thumbs_down')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (group_id, target_type, target_id, user_id)
);

create table if not exists public.group_social_comments (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups(id) on delete cascade,
  target_type text not null check (
    target_type in (
      'recap_feed', 'metric_entry', 'photo_update',
      'badge', 'group_challenge', 'group_todo'
    )
  ),
  target_id text not null check (char_length(target_id) between 1 and 240),
  user_id uuid not null references public.profiles(id) on delete cascade,
  content text not null check (
    char_length(btrim(content)) between 1 and 1000
    and content = btrim(content)
  ),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists group_social_reactions_target_idx
  on public.group_social_reactions (group_id, target_type, target_id, updated_at desc);
create index if not exists group_social_comments_target_idx
  on public.group_social_comments (group_id, target_type, target_id, created_at asc);

-- Existing owner-prefixed unique indexes cannot accelerate a reaction lookup
-- that starts from a client id. Keep trigger validation on indexed shared rows.
create index if not exists metric_entries_shared_client_target_idx
  on public.metric_entries (client_generated_id, metric_id)
  include (user_id, local_date, updated_at)
  where visibility = 'group';
create index if not exists photo_updates_shared_client_target_idx
  on public.photo_updates (client_generated_id, group_id)
  include (owner_user_id, local_date, created_at)
  where visibility = 'group' and client_generated_id is not null;

-- Social refreshes use the same compact private Broadcast boundary as the
-- existing workspace streams. Exact topic reconstruction avoids SQL regular
-- expressions and authorizes only active members of the named UUID group.
drop policy if exists metrally_group_broadcast_read on realtime.messages;
create policy metrally_group_broadcast_read
on realtime.messages
for select
to authenticated
using (
  split_part((select realtime.topic()), ':', 1) = 'group'
  and split_part((select realtime.topic()), ':', 3) in (
    'activity', 'chat', 'workspace', 'challenges', 'social'
  )
  and (select realtime.topic()) =
    'group:' || split_part((select realtime.topic()), ':', 2) || ':' ||
      split_part((select realtime.topic()), ':', 3)
  and exists (
    select 1
      from public.group_members membership
     where membership.user_id = (select auth.uid())
       and membership.status = 'active'
       and membership.group_id::text =
         split_part((select realtime.topic()), ':', 2)
  )
);

create or replace function public.valid_group_social_target(
  p_group_id uuid,
  p_target_type text,
  p_target_id text
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.is_group_member(p_group_id) and case
    -- Shared-log reactions must point at a real group-visible relational row.
    -- Apps use MetricEntry.id as metric_entries.client_generated_id.
    when p_target_type = 'metric_entry' then exists (
      select 1
      from public.metric_entries entry
      join public.metric_definitions definition on definition.id = entry.metric_id
      where definition.group_id = p_group_id
        and entry.client_generated_id = p_target_id
        and entry.visibility = 'group'
    )
    when p_target_type = 'photo_update' then exists (
      select 1
      from public.photo_updates photo
      where photo.group_id = p_group_id
        and photo.client_generated_id = p_target_id
        and photo.visibility = 'group'
    )
    -- Other target types are non-sensitive group UI identities. Their content
    -- is still loaded through its own privacy-enforced source before rendering.
    else true
  end;
$$;

revoke all on function public.valid_group_social_target(uuid, text, text) from public;
grant execute on function public.valid_group_social_target(uuid, text, text) to authenticated;

create or replace function public.touch_group_social_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists group_social_reactions_touch_updated_at
  on public.group_social_reactions;
create trigger group_social_reactions_touch_updated_at
before update on public.group_social_reactions
for each row execute function public.touch_group_social_updated_at();

drop trigger if exists group_social_comments_touch_updated_at
  on public.group_social_comments;
create trigger group_social_comments_touch_updated_at
before update on public.group_social_comments
for each row execute function public.touch_group_social_updated_at();

create or replace function public.broadcast_group_social_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_group_id uuid := case when tg_op = 'DELETE'
    then old.group_id else new.group_id end;
  v_target_type text := case when tg_op = 'DELETE'
    then old.target_type else new.target_type end;
begin
  begin
    perform realtime.send(
      jsonb_build_object('operation', tg_op, 'target_type', v_target_type),
      'social_updated',
      'group:' || v_group_id::text || ':social',
      true
    );
  exception when others then
    raise warning 'HabHub social broadcast failed';
  end;
  if tg_op = 'DELETE' then return old; else return new; end if;
end;
$$;

revoke all on function public.broadcast_group_social_change()
  from public, anon, authenticated;

drop trigger if exists group_social_reactions_compact_broadcast
  on public.group_social_reactions;
create trigger group_social_reactions_compact_broadcast
after insert or update or delete on public.group_social_reactions
for each row execute function public.broadcast_group_social_change();

drop trigger if exists group_social_comments_compact_broadcast
  on public.group_social_comments;
create trigger group_social_comments_compact_broadcast
after insert or update or delete on public.group_social_comments
for each row execute function public.broadcast_group_social_change();

alter table public.group_social_reactions enable row level security;
alter table public.group_social_comments enable row level security;

drop policy if exists group_social_reactions_member_read on public.group_social_reactions;
create policy group_social_reactions_member_read
on public.group_social_reactions for select to authenticated
using (
  public.is_group_member(group_id)
  and public.valid_group_social_target(group_id, target_type, target_id)
);

drop policy if exists group_social_reactions_owner_insert on public.group_social_reactions;
create policy group_social_reactions_owner_insert
on public.group_social_reactions for insert to authenticated
with check (
  user_id = (select auth.uid())
  and public.is_group_member(group_id)
  and public.valid_group_social_target(group_id, target_type, target_id)
);

drop policy if exists group_social_reactions_owner_update on public.group_social_reactions;
create policy group_social_reactions_owner_update
on public.group_social_reactions for update to authenticated
using (user_id = (select auth.uid()) and public.is_group_member(group_id))
with check (
  user_id = (select auth.uid())
  and public.is_group_member(group_id)
  and public.valid_group_social_target(group_id, target_type, target_id)
);

drop policy if exists group_social_reactions_owner_delete on public.group_social_reactions;
create policy group_social_reactions_owner_delete
on public.group_social_reactions for delete to authenticated
using (user_id = (select auth.uid()) and public.is_group_member(group_id));

drop policy if exists group_social_comments_member_read on public.group_social_comments;
create policy group_social_comments_member_read
on public.group_social_comments for select to authenticated
using (
  public.is_group_member(group_id)
  and public.valid_group_social_target(group_id, target_type, target_id)
);

drop policy if exists group_social_comments_owner_insert on public.group_social_comments;
create policy group_social_comments_owner_insert
on public.group_social_comments for insert to authenticated
with check (
  user_id = (select auth.uid())
  and public.is_group_member(group_id)
  and public.valid_group_social_target(group_id, target_type, target_id)
);

drop policy if exists group_social_comments_owner_update on public.group_social_comments;
create policy group_social_comments_owner_update
on public.group_social_comments for update to authenticated
using (user_id = (select auth.uid()) and public.is_group_member(group_id))
with check (
  user_id = (select auth.uid())
  and public.is_group_member(group_id)
  and public.valid_group_social_target(group_id, target_type, target_id)
);

drop policy if exists group_social_comments_owner_delete on public.group_social_comments;
create policy group_social_comments_owner_delete
on public.group_social_comments for delete to authenticated
using (user_id = (select auth.uid()) and public.is_group_member(group_id));

grant select, insert, update, delete on public.group_social_reactions to authenticated;
grant select, insert, update, delete on public.group_social_comments to authenticated;

-- Extend the existing recipient-only bell feed without creating a parallel
-- notification store. Challenge identity becomes optional for social events;
-- old challenge rows retain their foreign key and exact behavior.
alter table public.group_notification_events
  alter column challenge_id drop not null,
  add column if not exists target_type text,
  add column if not exists target_id text,
  add column if not exists reaction text;
alter table public.group_notification_events
  drop constraint if exists group_notification_events_event_type_check,
  drop constraint if exists group_notification_events_social_target_check,
  drop constraint if exists group_notification_events_reaction_check;
alter table public.group_notification_events
  add constraint group_notification_events_event_type_check check (
    event_type in (
      'challenge_invitation', 'challenge_accepted',
      'challenge_all_accepted', 'challenge_standing',
      'challenge_reminder', 'challenge_result', 'social_reaction'
    )
  ),
  add constraint group_notification_events_social_target_check check (
    (event_type <> 'social_reaction')
    or (
      target_type is not null
      and target_id is not null
      and char_length(target_type) between 1 and 48
      and char_length(target_id) between 1 and 240
    )
  ),
  add constraint group_notification_events_reaction_check check (
    reaction is null or reaction in ('heart', 'thumbs_up', 'thumbs_down')
  );

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
  -- The table policy already requires active membership. Recheck inside the
  -- definer trigger so future server writers cannot bypass that boundary.
  if not public.is_group_member(new.group_id) then return new; end if;

  if new.target_type = 'metric_entry' then
    select entry.user_id, definition.slug, definition.name, entry.local_date
      into v_recipient_id, v_metric_slug, v_metric_name, v_local_date
      from public.metric_entries entry
      join public.metric_definitions definition
        on definition.id = entry.metric_id
     where definition.group_id = new.group_id
       and entry.client_generated_id = new.target_id
       and entry.visibility = 'group'
     order by entry.updated_at desc
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
    -- Derived leader/badge cards have no canonical owner row. They remain
    -- reactable, but cannot safely create a recipient push from a claimed id.
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
    into v_actor_name
    from public.profiles profile where profile.id = new.user_id;
  v_actor_name := coalesce(v_actor_name, 'A friend');
  v_reaction_label := case new.reaction
    when 'heart' then 'loved'
    when 'thumbs_up' then 'liked'
    else 'reacted to'
  end;
  v_title := left(v_actor_name || ' ' || v_reaction_label || ' your shared log', 120);
  v_detail := left(
    case when v_metric_name = 'photo'
      then 'Open the group recap to see the reaction on your photo.'
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
drop trigger if exists group_social_reactions_emit_notification
  on public.group_social_reactions;
create trigger group_social_reactions_emit_notification
after insert or update of reaction
on public.group_social_reactions
for each row execute function public.emit_group_social_reaction_notification();

comment on table public.group_social_reactions is
  'Group-member reactions to privacy-authorized UI targets; never a source of target content.';
comment on table public.group_social_comments is
  'Group-member comments attached to privacy-authorized recap cards and shared log identities.';
