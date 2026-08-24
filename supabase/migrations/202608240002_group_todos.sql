create table if not exists public.group_todos (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups(id) on delete cascade,
  creator_id uuid not null references public.profiles(id) on delete cascade,
  parent_id uuid,
  title text not null check (char_length(btrim(title)) between 1 and 240),
  description text,
  labels text[] not null default array[]::text[]
    check (cardinality(labels) <= 12),
  priority text not null default 'normal'
    check (priority in ('low', 'normal', 'high', 'urgent')),
  due_at timestamptz,
  completion_mode text not null default 'individual'
    check (completion_mode in ('shared', 'individual')),
  shared_completed_at timestamptz,
  shared_completed_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, group_id),
  constraint group_todos_parent_same_group
    foreign key (parent_id, group_id)
    references public.group_todos(id, group_id)
    on delete cascade,
  constraint group_todos_shared_completion_shape check (
    (shared_completed_at is null and shared_completed_by is null)
    -- Keep a shared completion after its actor deletes their account; the
    -- profile FK deliberately sets only the attribution column to null.
    or (completion_mode = 'shared' and shared_completed_at is not null)
  )
);

create table if not exists public.group_todo_completions (
  todo_id uuid not null,
  group_id uuid not null,
  user_id uuid not null references public.profiles(id) on delete cascade,
  completed_at timestamptz not null default now(),
  primary key (todo_id, user_id),
  constraint group_todo_completions_todo_group_fk
    foreign key (todo_id, group_id)
    references public.group_todos(id, group_id)
    on delete cascade,
  constraint group_todo_completions_member_fk
    foreign key (group_id, user_id)
    references public.group_members(group_id, user_id)
    on delete cascade
);

create index if not exists group_todos_group_parent_created_idx
  on public.group_todos(group_id, parent_id, created_at, id);
create index if not exists group_todos_group_due_idx
  on public.group_todos(group_id, due_at)
  where due_at is not null;
create index if not exists group_todo_completions_group_todo_idx
  on public.group_todo_completions(group_id, todo_id);

-- Older APKs replace the entire group settings object and do not know this
-- opt-in key. Preserve an existing value when such a client omits the key;
-- updated clients explicitly send true or false and can still change it.
create or replace function public.preserve_group_todos_setting()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE'
     and old.settings ? 'groupTodosEnabled'
     and not (new.settings ? 'groupTodosEnabled') then
    new.settings := jsonb_set(
      new.settings,
      '{groupTodosEnabled}',
      old.settings -> 'groupTodosEnabled',
      true
    );
  end if;
  if new.settings ? 'groupTodosEnabled'
     and jsonb_typeof(new.settings -> 'groupTodosEnabled') <> 'boolean' then
    raise exception 'groupTodosEnabled must be a boolean.' using errcode = '22023';
  end if;
  return new;
end;
$$;

drop trigger if exists preserve_group_todos_setting on public.groups;
create trigger preserve_group_todos_setting
before insert or update of settings on public.groups
for each row execute function public.preserve_group_todos_setting();
revoke all on function public.preserve_group_todos_setting()
  from public, anon, authenticated;

create or replace function public.validate_group_todo_message_attachment()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_attachment jsonb;
  v_todo public.group_todos;
  v_todo_id uuid;
begin
  -- An older client maps unknown message metadata to an empty object during
  -- its idempotent upsert. Keep a previously validated task snapshot instead
  -- of silently stripping it from a message that may still contain text.
  if tg_op = 'UPDATE'
     and old.group_id = new.group_id
     and jsonb_typeof(
       coalesce(old.metadata, '{}'::jsonb) -> 'todoAttachment'
     ) = 'object'
     and not (coalesce(new.metadata, '{}'::jsonb) ? 'todoAttachment') then
    new.metadata := jsonb_set(
      coalesce(new.metadata, '{}'::jsonb),
      '{todoAttachment}',
      old.metadata -> 'todoAttachment',
      true
    );
    return new;
  end if;
  v_attachment := coalesce(new.metadata, '{}'::jsonb) -> 'todoAttachment';
  if v_attachment is null then return new; end if;
  if tg_op = 'UPDATE'
     and old.group_id = new.group_id
     and coalesce(old.metadata, '{}'::jsonb) -> 'todoAttachment' = v_attachment then
    return new;
  end if;
  if jsonb_typeof(v_attachment) <> 'object' then
    raise exception 'Invalid group to-do attachment.' using errcode = '22023';
  end if;
  begin
    v_todo_id := (v_attachment ->> 'groupTodoId')::uuid;
  exception when invalid_text_representation then
    raise exception 'Invalid group to-do attachment.' using errcode = '22023';
  end;
  select * into v_todo from public.group_todos todo
   where todo.id = v_todo_id and todo.group_id = new.group_id;
  if not found then
    raise exception 'Group to-do attachment not found.' using errcode = '22023';
  end if;
  if not exists (
    select 1 from public.groups enabled_group
     where enabled_group.id = new.group_id
       and coalesce(enabled_group.settings ->> 'groupTodosEnabled', 'false') = 'true'
  ) then
    raise exception 'Group to-dos are disabled.' using errcode = '42501';
  end if;
  new.metadata := jsonb_set(
    coalesce(new.metadata, '{}'::jsonb),
    '{todoAttachment}',
    jsonb_build_object(
      'groupTodoId', v_todo.id,
      'groupId', v_todo.group_id,
      'title', v_todo.title,
      'completionMode', v_todo.completion_mode
    ),
    true
  );
  return new;
end;
$$;

drop trigger if exists validate_group_todo_message_attachment
  on public.messages;
create trigger validate_group_todo_message_attachment
before insert or update of metadata, group_id on public.messages
for each row execute function public.validate_group_todo_message_attachment();
revoke all on function public.validate_group_todo_message_attachment()
  from public, anon, authenticated;

alter table public.messages
  drop constraint if exists messages_content_or_image_check;
alter table public.messages
  drop constraint if exists messages_content_image_or_group_todo_check;
alter table public.messages
  add constraint messages_content_image_or_group_todo_check check (
    (char_length(content) between 1 and 4000)
    or image_path is not null
    or (
      metadata ? 'todoAttachment'
      and jsonb_typeof(metadata -> 'todoAttachment') = 'object'
      and metadata #>> '{todoAttachment,groupTodoId}' is not null
      and metadata #>> '{todoAttachment,groupId}' = group_id::text
      and metadata #>> '{todoAttachment,title}' is not null
      and metadata #>> '{todoAttachment,completionMode}' in ('shared', 'individual')
    )
  );

alter table public.group_todos enable row level security;
alter table public.group_todo_completions enable row level security;

drop policy if exists group_todos_member_read on public.group_todos;
create policy group_todos_member_read
on public.group_todos for select to authenticated
using (
  public.is_group_member(group_id)
  and exists (
    select 1 from public.groups enabled_group
     where enabled_group.id = group_id
       and coalesce(enabled_group.settings ->> 'groupTodosEnabled', 'false') = 'true'
  )
);

drop policy if exists group_todo_completions_member_read
  on public.group_todo_completions;
create policy group_todo_completions_member_read
on public.group_todo_completions for select to authenticated
using (
  public.is_group_member(group_id)
  and exists (
    select 1 from public.group_members completing_member
     where completing_member.group_id = group_todo_completions.group_id
       and completing_member.user_id = group_todo_completions.user_id
       and completing_member.status = 'active'
  )
  and exists (
    select 1 from public.groups enabled_group
     where enabled_group.id = group_id
       and coalesce(enabled_group.settings ->> 'groupTodosEnabled', 'false') = 'true'
  )
);

revoke all on public.group_todos from public, anon, authenticated;
revoke all on public.group_todo_completions from public, anon, authenticated;
grant select on public.group_todos to authenticated;
grant select on public.group_todo_completions to authenticated;

create or replace function public.save_group_todo(
  p_todo_id uuid,
  p_group_id uuid,
  p_parent_id uuid,
  p_title text,
  p_description text,
  p_labels text[],
  p_priority text,
  p_due_at timestamptz,
  p_completion_mode text
)
returns public.group_todos
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_existing public.group_todos;
  v_saved public.group_todos;
  v_labels text[] := array[]::text[];
begin
  if v_user_id is null then
    raise exception 'Authentication required.' using errcode = '42501';
  end if;
  if not public.is_group_member(p_group_id) then
    raise exception 'Active group membership required.' using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.groups enabled_group
     where enabled_group.id = p_group_id
       and coalesce(enabled_group.settings ->> 'groupTodosEnabled', 'false') = 'true'
  ) then
    raise exception 'Group to-dos are disabled.' using errcode = '42501';
  end if;
  -- Serializing structural edits per group closes the two-writer race where
  -- A could be moved under B while B is simultaneously moved under A.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_group_id::text, 0)
  );
  if p_title is null or char_length(btrim(p_title)) not between 1 and 240 then
    raise exception 'To-do title must contain 1 to 240 characters.' using errcode = '22023';
  end if;
  if p_description is not null and char_length(p_description) > 4000 then
    raise exception 'To-do description is too long.' using errcode = '22023';
  end if;
  if coalesce(p_priority, 'normal') not in ('low', 'normal', 'high', 'urgent') then
    raise exception 'Invalid priority.' using errcode = '22023';
  end if;
  if coalesce(p_completion_mode, 'individual') not in ('shared', 'individual') then
    raise exception 'Invalid completion mode.' using errcode = '22023';
  end if;

  select coalesce(array_agg(label order by first_seen), array[]::text[])
    into v_labels
    from (
      select lower(btrim(ltrim(raw_label, '#'))) as label,
             min(ordinality) as first_seen
        from unnest(coalesce(p_labels, array[]::text[]))
          with ordinality as requested(raw_label, ordinality)
       where char_length(btrim(ltrim(raw_label, '#'))) between 1 and 32
         and lower(btrim(ltrim(raw_label, '#'))) ~ '^[[:alnum:]_-]+$'
       group by lower(btrim(ltrim(raw_label, '#')))
       order by min(ordinality)
       limit 12
    ) normalized;

  if p_parent_id is not null and not exists (
    select 1 from public.group_todos parent
     where parent.id = p_parent_id and parent.group_id = p_group_id
  ) then
    raise exception 'Parent to-do not found.' using errcode = '22023';
  end if;
  if p_todo_id is not null then
    select * into v_existing
      from public.group_todos todo
     where todo.id = p_todo_id and todo.group_id = p_group_id
     for update;
    if not found then
      raise exception 'To-do not found.' using errcode = 'P0002';
    end if;
    if v_existing.creator_id <> v_user_id and not public.is_group_admin(p_group_id) then
      raise exception 'Only the creator or a group administrator can edit this to-do.'
        using errcode = '42501';
    end if;
    if p_parent_id = p_todo_id then
      raise exception 'A to-do cannot be its own parent.' using errcode = '22023';
    end if;
    if p_parent_id is not null and exists (
      with recursive descendants(id) as (
        select child.id from public.group_todos child
         where child.parent_id = p_todo_id and child.group_id = p_group_id
        -- UNION also makes this validation terminate safely if a trusted
        -- maintenance write ever imported an already-cyclic legacy graph.
        union
        select child.id from public.group_todos child
          join descendants parent on child.parent_id = parent.id
         where child.group_id = p_group_id
      )
      select 1 from descendants where id = p_parent_id
    ) then
      raise exception 'A to-do cannot be moved beneath one of its subtasks.'
        using errcode = '22023';
    end if;

    update public.group_todos
       set parent_id = p_parent_id,
           title = btrim(p_title),
           description = nullif(btrim(p_description), ''),
           labels = v_labels,
           priority = coalesce(p_priority, 'normal'),
           due_at = p_due_at,
           completion_mode = coalesce(p_completion_mode, 'individual'),
           shared_completed_at = case
             when coalesce(p_completion_mode, 'individual') = 'shared'
               then shared_completed_at
             else null
           end,
           shared_completed_by = case
             when coalesce(p_completion_mode, 'individual') = 'shared'
               then shared_completed_by
             else null
           end,
           updated_at = now()
     where id = p_todo_id
     returning * into v_saved;
  else
    insert into public.group_todos (
      group_id, creator_id, parent_id, title, description, labels,
      priority, due_at, completion_mode
    ) values (
      p_group_id, v_user_id, p_parent_id, btrim(p_title),
      nullif(btrim(p_description), ''), v_labels,
      coalesce(p_priority, 'normal'), p_due_at,
      coalesce(p_completion_mode, 'individual')
    ) returning * into v_saved;
  end if;

  if v_saved.completion_mode = 'shared' then
    delete from public.group_todo_completions where todo_id = v_saved.id;
  end if;
  return v_saved;
end;
$$;

create or replace function public.set_group_todo_completion(
  p_todo_id uuid,
  p_completed boolean
)
returns public.group_todos
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_todo public.group_todos;
begin
  if v_user_id is null then
    raise exception 'Authentication required.' using errcode = '42501';
  end if;
  if p_completed is null then
    raise exception 'Completion state is required.' using errcode = '22023';
  end if;
  select * into v_todo from public.group_todos todo
   where todo.id = p_todo_id for update;
  if not found then
    raise exception 'To-do not found.' using errcode = 'P0002';
  end if;
  if not public.is_group_member(v_todo.group_id) then
    -- Match the absent-row response so an authenticated caller cannot use a
    -- guessed UUID as a cross-group task-existence oracle.
    raise exception 'To-do not found.' using errcode = 'P0002';
  end if;
  if not exists (
    select 1 from public.groups enabled_group
     where enabled_group.id = v_todo.group_id
       and coalesce(enabled_group.settings ->> 'groupTodosEnabled', 'false') = 'true'
  ) then
    raise exception 'Group to-dos are disabled.' using errcode = '42501';
  end if;

  if v_todo.completion_mode = 'shared' then
    update public.group_todos
       set shared_completed_at = case when p_completed then now() else null end,
           shared_completed_by = case when p_completed then v_user_id else null end,
           updated_at = now()
     where id = p_todo_id
     returning * into v_todo;
  elsif p_completed then
    insert into public.group_todo_completions (
      todo_id, group_id, user_id, completed_at
    ) values (v_todo.id, v_todo.group_id, v_user_id, now())
    on conflict (todo_id, user_id) do update set completed_at = excluded.completed_at;
  else
    delete from public.group_todo_completions
     where todo_id = v_todo.id and user_id = v_user_id;
  end if;
  return v_todo;
end;
$$;

create or replace function public.delete_group_todo(p_todo_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_todo public.group_todos;
begin
  if v_user_id is null then
    raise exception 'Authentication required.' using errcode = '42501';
  end if;
  select * into v_todo from public.group_todos todo
   where todo.id = p_todo_id for update;
  if not found then return; end if;
  if not public.is_group_member(v_todo.group_id) then
    -- Deletion is idempotent; an inaccessible UUID is indistinguishable from
    -- an absent one and therefore does not disclose cross-group existence.
    return;
  end if;
  if v_todo.creator_id <> v_user_id and not public.is_group_admin(v_todo.group_id) then
    raise exception 'Only the creator or a group administrator can delete this to-do.'
      using errcode = '42501';
  end if;
  delete from public.group_todos where id = p_todo_id;
end;
$$;

revoke all on function public.save_group_todo(
  uuid, uuid, uuid, text, text, text[], text, timestamptz, text
) from public, anon, authenticated;
revoke all on function public.set_group_todo_completion(uuid, boolean)
  from public, anon, authenticated;
revoke all on function public.delete_group_todo(uuid)
  from public, anon, authenticated;
grant execute on function public.save_group_todo(
  uuid, uuid, uuid, text, text, text[], text, timestamptz, text
) to authenticated;
grant execute on function public.set_group_todo_completion(uuid, boolean) to authenticated;
grant execute on function public.delete_group_todo(uuid) to authenticated;

-- Deliberately do not add either table to supabase_realtime. Group to-do
-- screens use payload-free Broadcast invalidation, avoiding a permanent
-- database changefeed and its compute cost.
