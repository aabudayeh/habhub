-- Finish the private Broadcast cutover. The August 25 migration installed
-- compact database-trigger invalidations for groups and profiles, but those
-- two legacy relations were inadvertently left in the continuously-polled
-- Postgres Changes publication. Current clients have no postgres_changes
-- listeners, so keeping them there only makes Realtime inspect and RLS-filter
-- avoidable WAL traffic.
do $$
declare
  relation_name text;
begin
  foreach relation_name in array array['groups', 'profiles']
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

-- Group to-dos previously used an unauthenticated client-sent Broadcast topic.
-- Move them to the same member-authorized private topic boundary as every
-- other group feature, and emit invalidations only from committed database
-- writes. No to-do title, note, reminder, or completion value is broadcast.
drop policy if exists metrally_group_broadcast_read on realtime.messages;
create policy metrally_group_broadcast_read
on realtime.messages
for select
to authenticated
using (
  split_part((select realtime.topic()), ':', 1) = 'group'
  and split_part((select realtime.topic()), ':', 3) in (
    'activity', 'chat', 'workspace', 'challenges', 'social', 'todos'
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

create or replace function public.broadcast_group_todo_change()
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
      jsonb_build_object('entity', tg_table_name, 'operation', tg_op),
      'todos_updated',
      'group:' || v_group_id::text || ':todos',
      true
    );
  exception when others then
    raise warning 'HabHub group to-do broadcast failed for %', tg_table_name;
  end;
  if tg_op = 'DELETE' then return old; else return new; end if;
end;
$$;

revoke all on function public.broadcast_group_todo_change()
  from public, anon, authenticated;

drop trigger if exists group_todos_compact_broadcast on public.group_todos;
create trigger group_todos_compact_broadcast
after insert or update or delete on public.group_todos
for each row execute function public.broadcast_group_todo_change();

drop trigger if exists group_todo_completions_compact_broadcast
  on public.group_todo_completions;
create trigger group_todo_completions_compact_broadcast
after insert or update or delete on public.group_todo_completions
for each row execute function public.broadcast_group_todo_change();
