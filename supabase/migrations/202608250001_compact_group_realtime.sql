-- Replace every remaining client Postgres Changes stream with compact private
-- Broadcast invalidations. Postgres Changes makes the Realtime server poll and
-- RLS-filter WAL continuously for every connected app. These payloads contain
-- identifiers/version hints only; clients fetch the canonical RLS-authorized
-- rows after an invalidation.

create or replace function public.habhub_account_broadcast_topic_allowed()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    (select auth.uid()) is not null
    and exists (
      select 1 from auth.users account where account.id = (select auth.uid())
    )
    and not exists (
      select 1
        from public.google_health_account_deletion_guards guard
       where guard.user_id = (select auth.uid())
    )
    and (
      (select realtime.topic()) in (
        'account:' || (select auth.uid())::text || ':memberships',
        'account:' || (select auth.uid())::text || ':chat',
        'account:' || (select auth.uid())::text || ':group-notifications'
      )
      or (select realtime.topic()) =
        'account:' || (select auth.uid())::text || ':snapshot:v27'
      or (
        (select realtime.topic()) =
          'account:' || (select auth.uid())::text || ':snapshot'
        and not exists (
          select 1
            from public.google_health_privacy_accounts privacy
           where privacy.user_id = (select auth.uid())
        )
      )
    );
$$;

revoke all on function public.habhub_account_broadcast_topic_allowed()
  from public;
grant execute on function public.habhub_account_broadcast_topic_allowed()
  to authenticated;

drop policy if exists metrally_group_broadcast_read on realtime.messages;
create policy metrally_group_broadcast_read
on realtime.messages
for select
to authenticated
using (
  case
    when (select realtime.topic()) ~
      '^group:[0-9a-fA-F-]{36}:(activity|chat|workspace|challenges)$'
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

create or replace function public.broadcast_group_workspace_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_group_id uuid := case when tg_op = 'DELETE'
    then old.group_id else new.group_id end;
begin
  if v_group_id is not null then
    begin
      perform realtime.send(
        jsonb_build_object('entity', tg_table_name, 'operation', tg_op),
        'workspace_updated',
        'group:' || v_group_id::text || ':workspace',
        true
      );
    exception when others then
      raise warning 'HabHub workspace broadcast failed for %', tg_table_name;
    end;
  end if;
  if tg_op = 'DELETE' then return old; else return new; end if;
end;
$$;

revoke all on function public.broadcast_group_workspace_change()
  from public, anon, authenticated;

drop trigger if exists metric_definitions_workspace_broadcast
  on public.metric_definitions;
create trigger metric_definitions_workspace_broadcast
after insert or update or delete on public.metric_definitions
for each row execute function public.broadcast_group_workspace_change();

drop trigger if exists photo_updates_workspace_broadcast
  on public.photo_updates;
create trigger photo_updates_workspace_broadcast
after insert or update or delete on public.photo_updates
for each row execute function public.broadcast_group_workspace_change();

create or replace function public.broadcast_group_row_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_group_id uuid := case when tg_op = 'DELETE' then old.id else new.id end;
begin
  begin
    perform realtime.send(
      jsonb_build_object('entity', 'groups', 'operation', tg_op),
      'workspace_updated',
      'group:' || v_group_id::text || ':workspace',
      true
    );
  exception when others then
    raise warning 'HabHub group workspace broadcast failed';
  end;
  if tg_op = 'DELETE' then return old; else return new; end if;
end;
$$;

revoke all on function public.broadcast_group_row_change()
  from public, anon, authenticated;

drop trigger if exists groups_workspace_broadcast on public.groups;
create trigger groups_workspace_broadcast
after insert or update or delete on public.groups
for each row execute function public.broadcast_group_row_change();

create or replace function public.broadcast_group_membership_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_group_id uuid := case when tg_op = 'DELETE'
    then old.group_id else new.group_id end;
  v_user_id uuid := case when tg_op = 'DELETE'
    then old.user_id else new.user_id end;
  v_status text := case when tg_op = 'DELETE'
    then old.status else new.status end;
begin
  begin
    perform realtime.send(
      jsonb_build_object(
        'group_id', v_group_id,
        'user_id', v_user_id,
        'status', v_status,
        'operation', tg_op
      ),
      'membership_updated',
      'account:' || v_user_id::text || ':memberships',
      true
    );
  exception when others then
    raise warning 'HabHub account membership broadcast failed';
  end;
  begin
    perform realtime.send(
      jsonb_build_object('entity', 'group_members', 'operation', tg_op),
      'workspace_updated',
      'group:' || v_group_id::text || ':workspace',
      true
    );
  exception when others then
    raise warning 'HabHub group membership workspace broadcast failed';
  end;
  if tg_op = 'DELETE' then return old; else return new; end if;
end;
$$;

revoke all on function public.broadcast_group_membership_change()
  from public, anon, authenticated;

drop trigger if exists group_members_compact_broadcast on public.group_members;
create trigger group_members_compact_broadcast
after insert or update or delete on public.group_members
for each row execute function public.broadcast_group_membership_change();

create or replace function public.broadcast_profile_workspace_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := case when tg_op = 'DELETE' then old.id else new.id end;
  v_group_id uuid;
begin
  for v_group_id in
    select membership.group_id
      from public.group_members membership
     where membership.user_id = v_user_id
       and membership.status = 'active'
  loop
    begin
      perform realtime.send(
        jsonb_build_object(
          'entity', 'profiles',
          'operation', tg_op,
          'user_id', v_user_id
        ),
        'workspace_updated',
        'group:' || v_group_id::text || ':workspace',
        true
      );
    exception when others then
      raise warning 'HabHub profile workspace broadcast failed';
    end;
  end loop;
  if tg_op = 'DELETE' then return old; else return new; end if;
end;
$$;

revoke all on function public.broadcast_profile_workspace_change()
  from public, anon, authenticated;

drop trigger if exists profiles_workspace_broadcast on public.profiles;
create trigger profiles_workspace_broadcast
after update on public.profiles
for each row execute function public.broadcast_profile_workspace_change();

create or replace function public.broadcast_group_chat_commit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid;
begin
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
      raise warning 'HabHub group chat broadcast failed';
    end;
  else
    for v_user_id in
      select distinct recipient.account_id
        from unnest(array[new.sender_id, new.recipient_id])
          as recipient(account_id)
       where recipient.account_id is not null
    loop
      begin
        perform realtime.send(
          jsonb_build_object(
            'group_id', new.group_id,
            'message_id', new.id,
            'created_at', new.created_at
          ),
          'message_committed',
          'account:' || v_user_id::text || ':chat',
          true
        );
      exception when others then
        raise warning 'HabHub direct chat broadcast failed';
      end;
    end loop;
  end if;
  return new;
end;
$$;

revoke all on function public.broadcast_group_chat_commit()
  from public, anon, authenticated;

create or replace function public.broadcast_group_challenge_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_group_id uuid := case when tg_op = 'DELETE'
    then old.group_id else new.group_id end;
begin
  begin
    perform realtime.send(
      jsonb_build_object('operation', tg_op),
      'challenges_updated',
      'group:' || v_group_id::text || ':challenges',
      true
    );
  exception when others then
    raise warning 'HabHub challenge broadcast failed';
  end;
  if tg_op = 'DELETE' then return old; else return new; end if;
end;
$$;

revoke all on function public.broadcast_group_challenge_change()
  from public, anon, authenticated;

drop trigger if exists group_challenges_compact_broadcast
  on public.group_challenges;
create trigger group_challenges_compact_broadcast
after insert or update or delete on public.group_challenges
for each row execute function public.broadcast_group_challenge_change();

create or replace function public.broadcast_group_notification_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_recipient_id uuid := case when tg_op = 'DELETE'
    then old.recipient_id else new.recipient_id end;
begin
  begin
    perform realtime.send(
      jsonb_build_object('operation', tg_op),
      'notifications_updated',
      'account:' || v_recipient_id::text || ':group-notifications',
      true
    );
  exception when others then
    raise warning 'HabHub group notification broadcast failed';
  end;
  if tg_op = 'DELETE' then return old; else return new; end if;
end;
$$;

revoke all on function public.broadcast_group_notification_change()
  from public, anon, authenticated;

drop trigger if exists group_notification_events_compact_broadcast
  on public.group_notification_events;
create trigger group_notification_events_compact_broadcast
after insert or update or delete on public.group_notification_events
for each row execute function public.broadcast_group_notification_change();

-- No current client needs Postgres Changes after the compact Broadcast
-- cutover. Repeat-safe catalog checks keep this deploy forward-only and allow
-- old clients to fall back to their existing foreground/resume refreshes.
do $$
declare
  relation_name text;
begin
  foreach relation_name in array array[
    'messages',
    'group_members',
    'metric_definitions',
    'photo_updates',
    'group_activity_versions',
    'group_challenges',
    'group_notification_events'
  ]
  loop
    if exists (
      select 1
        from pg_catalog.pg_publication_tables publication_table
       where publication_table.pubname = 'supabase_realtime'
         and publication_table.schemaname = 'public'
         and publication_table.tablename = relation_name
    ) then
      execute format(
        'alter publication supabase_realtime drop table public.%I',
        relation_name
      );
    end if;
  end loop;
end;
$$;

comment on function public.broadcast_group_workspace_change() is
  'Emits compact private group workspace invalidations without row values.';
comment on function public.broadcast_group_membership_change() is
  'Emits account membership and group workspace invalidations without Postgres Changes.';
