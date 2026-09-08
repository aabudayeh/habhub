import { PGlite } from "npm:@electric-sql/pglite@0.3.10";

const migration = await Deno.readTextFile(
  new URL(
    "../supabase/migrations/202609080003_group_hub_social_productivity.sql",
    import.meta.url,
  ),
);

function sqlStatements(source) {
  const statements = [];
  let start = 0;
  let single = false;
  let double = false;
  let lineComment = false;
  let blockComment = false;
  let dollarTag = "";
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    const next = source[index + 1];
    if (lineComment) {
      if (char === "\n") lineComment = false;
      continue;
    }
    if (blockComment) {
      if (char === "*" && next === "/") {
        blockComment = false;
        index += 1;
      }
      continue;
    }
    if (dollarTag) {
      if (source.startsWith(dollarTag, index)) {
        index += dollarTag.length - 1;
        dollarTag = "";
      }
      continue;
    }
    if (single) {
      if (char === "'" && next === "'") index += 1;
      else if (char === "'") single = false;
      continue;
    }
    if (double) {
      if (char === '"' && next === '"') index += 1;
      else if (char === '"') double = false;
      continue;
    }
    if (char === "-" && next === "-") {
      lineComment = true;
      index += 1;
      continue;
    }
    if (char === "/" && next === "*") {
      blockComment = true;
      index += 1;
      continue;
    }
    if (char === "'") single = true;
    else if (char === '"') double = true;
    else if (char === "$") {
      const match = source.slice(index).match(/^\$[A-Za-z_][A-Za-z0-9_]*\$|^\$\$/);
      if (match) {
        dollarTag = match[0];
        index += dollarTag.length - 1;
      }
    } else if (char === ";") {
      const statement = source.slice(start, index + 1).trim();
      if (statement) statements.push(statement);
      start = index + 1;
    }
  }
  const remainder = source.slice(start).trim();
  if (remainder) statements.push(remainder);
  return statements;
}

const db = new PGlite();
await db.exec(`
  create role anon;
  create role authenticated;
  create schema auth;
  create schema realtime;
  create function auth.uid() returns uuid language sql stable as $$
    select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
  $$;
  create function realtime.send(jsonb, text, text, boolean)
  returns void language sql as $$ select $$;

  create table public.groups (
    id uuid primary key,
    created_at timestamptz not null default now()
  );
  create table public.profiles (
    id uuid primary key,
    display_name text,
    timezone text not null default 'UTC'
  );
  create table public.group_members (
    group_id uuid not null references public.groups(id) on delete cascade,
    user_id uuid not null references public.profiles(id) on delete cascade,
    role text not null default 'member',
    status text not null default 'active',
    primary key (group_id, user_id)
  );
  create function public.is_group_member(p_group_id uuid)
  returns boolean language sql stable as $$
    select exists (
      select 1 from public.group_members member
       where member.group_id = p_group_id
         and member.user_id = auth.uid()
         and member.status = 'active'
    )
  $$;
  create function public.is_group_admin(p_group_id uuid)
  returns boolean language sql stable as $$
    select exists (
      select 1 from public.group_members member
       where member.group_id = p_group_id
         and member.user_id = auth.uid()
         and member.role in ('owner', 'admin')
         and member.status = 'active'
    )
  $$;
  create function public.habhub_has_current_terms_acceptance()
  returns boolean language sql stable as $$ select auth.uid() is not null $$;
  create function public.habhub_message_content_allowed(text)
  returns boolean language sql immutable as $$ select true $$;
  create function public.habhub_message_visible_to_current_user(uuid, uuid)
  returns boolean language sql stable as $$ select true $$;
  create function public.habhub_users_blocked_either_way(uuid, uuid)
  returns boolean language sql stable as $$ select false $$;
  create function public.group_challenge_occurs_on(jsonb, date, date)
  returns boolean language sql immutable as $$ select false $$;
  create function public.resolve_group_social_metric_entry_id(uuid, text)
  returns uuid language sql stable as $$ select null::uuid $$;
  create function public.resolve_group_social_daily_leader(uuid, date)
  returns uuid language sql stable as $$ select null::uuid $$;

  create table public.group_todos (
    id uuid primary key,
    group_id uuid not null references public.groups(id) on delete cascade,
    creator_id uuid not null references public.profiles(id) on delete cascade,
    title text not null,
    completion_mode text not null default 'individual',
    shared_completed_at timestamptz,
    shared_completed_by uuid,
    created_at timestamptz not null default now()
  );
  create table public.group_todo_completions (
    todo_id uuid not null references public.group_todos(id) on delete cascade,
    group_id uuid not null references public.groups(id) on delete cascade,
    user_id uuid not null references public.profiles(id) on delete cascade,
    completed_at timestamptz not null default now(),
    primary key (todo_id, user_id)
  );
  create table public.messages (
    id uuid primary key default gen_random_uuid(),
    group_id uuid not null references public.groups(id) on delete cascade,
    sender_id uuid references public.profiles(id) on delete set null,
    recipient_id uuid references public.profiles(id) on delete cascade,
    client_generated_id text,
    created_at timestamptz not null default now()
  );
  create table public.group_social_reactions (
    group_id uuid not null references public.groups(id) on delete cascade,
    target_type text not null,
    target_id text not null check (char_length(target_id) between 1 and 240),
    user_id uuid not null references public.profiles(id) on delete cascade,
    reaction text not null,
    source_surface text not null default 'feed',
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    primary key (group_id, target_type, target_id, user_id),
    constraint group_social_reactions_target_type_check check (target_type = 'group_todo'),
    constraint group_social_reactions_source_surface_check check (source_surface = 'feed')
  );
  create table public.group_social_comments (
    id uuid primary key default gen_random_uuid(),
    group_id uuid not null references public.groups(id) on delete cascade,
    target_type text not null,
    target_id text not null check (char_length(target_id) between 1 and 240),
    user_id uuid not null references public.profiles(id) on delete cascade,
    content text not null,
    source_surface text not null default 'feed',
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    constraint group_social_comments_target_type_check check (target_type = 'group_todo'),
    constraint group_social_comments_source_surface_check check (source_surface = 'feed')
  );
  create table public.group_notification_events (
    id uuid primary key default gen_random_uuid(),
    event_key text not null,
    group_id uuid not null references public.groups(id) on delete cascade,
    recipient_id uuid not null references public.profiles(id) on delete cascade,
    actor_id uuid not null references public.profiles(id) on delete cascade,
    event_type text not null,
    challenge_id uuid,
    title text,
    detail text,
    occurrence_date date,
    target_type text,
    target_id text,
    reaction text,
    interaction_surface text,
    created_at timestamptz not null default now(),
    unique (recipient_id, event_key),
    constraint group_notification_events_event_type_check
      check (event_type = 'social_reaction'),
    constraint group_notification_events_interaction_surface_check
      check (interaction_surface is null or interaction_surface = 'feed')
  );
  create table public.push_dispatch_events (
    event_key text primary key,
    group_id uuid,
    dispatcher_id uuid,
    category text,
    event_type text,
    audience text,
    recipient_id uuid,
    metric_slug text,
    title text,
    body text,
    data jsonb,
    expires_at timestamptz
  );
  create table public.metric_entries (
    id uuid primary key,
    user_id uuid,
    metric_id uuid,
    local_date date
  );
  create table public.metric_definitions (
    id uuid primary key,
    group_id uuid,
    slug text,
    name text,
    score_weight numeric
  );
  create table public.photo_updates (
    group_id uuid,
    owner_user_id uuid,
    client_generated_id text,
    visibility text,
    local_date date,
    created_at timestamptz
  );
  create table public.daily_metric_status (
    group_id uuid,
    user_id uuid,
    metric_id uuid,
    local_date date,
    visibility text
  );
  create table public.group_challenges (
    id uuid primary key,
    group_id uuid,
    creator_id uuid,
    metric_slug text,
    title text,
    local_date date,
    end_date date,
    recurrence jsonb,
    deleted_at timestamptz,
    audience text not null default 'group',
    participant_ids uuid[] not null default '{}'::uuid[]
  );
  create table public.group_challenge_result_placements (
    challenge_id uuid,
    occurrence_date date,
    user_id uuid,
    winner boolean
  );
`);

for (const [index, statement] of sqlStatements(migration).entries()) {
  try {
    await db.exec(statement);
  } catch (error) {
    throw new Error(
      `Group hub migration statement ${index + 1} failed (${statement
        .slice(0, 120)
        .replaceAll("\n", " ")}): ${error}`,
    );
  }
}

const groupId = "10000000-0000-4000-8000-000000000001";
const otherGroupId = "10000000-0000-4000-8000-000000000002";
const ownerId = "20000000-0000-4000-8000-000000000001";
const memberId = "20000000-0000-4000-8000-000000000002";
const thirdId = "20000000-0000-4000-8000-000000000003";
const todoId = "30000000-0000-4000-8000-000000000001";
const sharedTodoId = "30000000-0000-4000-8000-000000000002";
const messageId = "40000000-0000-4000-8000-000000000001";
const outsiderId = "20000000-0000-4000-8000-000000000004";
const recapTarget = "v1:week:2026-09-08:group-champion";
const metricRecapTarget = "v1:week:2026-09-08:group-water";

await db.exec(`
  insert into public.groups (id, created_at)
  values
    ('${groupId}', '2026-01-01T00:00:00Z'),
    ('${otherGroupId}', '2026-01-01T00:00:00Z');
  insert into public.profiles values
    ('${ownerId}', 'Owner', 'Europe/Berlin'),
    ('${memberId}', 'Member', 'Europe/Berlin'),
    ('${thirdId}', 'Third', 'Europe/Berlin'),
    ('${outsiderId}', 'Outsider', 'Europe/Berlin');
  insert into public.group_members values
    ('${groupId}', '${ownerId}', 'owner', 'active'),
    ('${groupId}', '${memberId}', 'member', 'active'),
    ('${groupId}', '${thirdId}', 'member', 'active');
  insert into public.metric_definitions (
    id, group_id, slug, name, score_weight
  ) values (
    '50000000-0000-4000-8000-000000000001',
    '${groupId}', 'water', 'Water', 1
  ), (
    '50000000-0000-4000-8000-000000000002',
    '${otherGroupId}', 'foreign_metric', 'Foreign metric', 1
  );
  insert into public.group_todos values
    ('${todoId}', '${groupId}', '${ownerId}', 'Drink water', 'individual', null, null, now()),
    ('${sharedTodoId}', '${groupId}', '${ownerId}', 'Book the court', 'shared', null, null, now());
  insert into public.messages (
    id, group_id, sender_id, recipient_id, client_generated_id
  ) values (
    '${messageId}', '${groupId}', '${ownerId}', null, 'message-client-1'
  );
  set request.jwt.claim.sub = '${ownerId}';
`);

const created = await db.query(`
  select saved.* from public.save_group_note(
    null, '${groupId}', 'Plan', 'Walk at ten', null
  ) as saved;
`);
const noteId = created.rows[0]?.id;
if (!noteId || created.rows[0]?.revision !== 1)
  throw new Error("group note creation did not return revision 1");

const allDay = await db.query(`
  select saved.* from public.save_group_schedule_item(
    null, '${groupId}', 'All-day walk', null,
    '2026-09-08T00:00:00Z', '2026-09-07T23:00:00Z', true, null
  ) as saved;
`);
const scheduleId = allDay.rows[0]?.id;
if (
  !scheduleId ||
  allDay.rows[0]?.starts_at?.toISOString() !== "2026-09-08T12:00:00.000Z" ||
  allDay.rows[0]?.ends_at !== null ||
  allDay.rows[0]?.all_day !== true
)
  throw new Error(
    `all-day group events were not normalized to noon UTC without an end: ${JSON.stringify(allDay.rows[0])}`,
  );

await db.exec(`
  select public.save_group_note(
    '${noteId}', '${groupId}', 'Plan', 'Walk at eleven', 1
  );
`);
const workspaceEvents = await db.query(`
  select event_type, count(*)::integer as count
    from public.group_notification_events
   where event_type in (
     'group_note_created', 'group_note_updated',
     'group_schedule_created', 'group_schedule_updated'
   )
   group by event_type order by event_type;
`);
const workspaceByKind = new Map(
  workspaceEvents.rows.map((row) => [row.event_type, row.count]),
);
if (
  workspaceByKind.get("group_note_created") !== 2 ||
  workspaceByKind.get("group_note_updated") !== 2 ||
  workspaceByKind.get("group_schedule_created") !== 2
)
  throw new Error(
    `workspace notification audiences are incorrect: ${JSON.stringify(workspaceEvents.rows)}`,
  );
const workspacePushes = await db.query(`
  select count(*)::integer as count
    from public.push_dispatch_events
   where event_type in (
     'group_note_created', 'group_note_updated',
     'group_schedule_created', 'group_schedule_updated'
   );
`);
if (workspacePushes.rows[0]?.count !== 3)
  throw new Error("workspace revisions must each create one durable group push");
const workspaceActorEcho = await db.query(`
  select count(*)::integer as count
    from public.group_notification_events
   where (event_type like 'group_note_%' or event_type like 'group_schedule_%')
     and recipient_id = actor_id;
`);
if (workspaceActorEcho.rows[0]?.count !== 0)
  throw new Error("workspace notifications must exclude the acting member");
let staleRejected = false;
try {
  await db.exec(`
    select public.save_group_note(
      '${noteId}', '${groupId}', 'Plan', 'Stale overwrite', 1
    );
  `);
} catch {
  staleRejected = true;
}
if (!staleRejected) throw new Error("stale group note revision was accepted");

await db.exec(`
  set request.jwt.claim.sub = '${memberId}';
  select public.set_group_social_reaction(
    '${groupId}', 'group_note', '${noteId}', 'heart', 'group_notes'
  );
  select public.set_group_social_reaction(
    '${groupId}', 'chat_message', '${ownerId}:message-client-1',
    'thumbs_up', 'chat'
  );
  select public.set_group_social_reaction(
    '${groupId}', 'group_recap', '${recapTarget}', 'cheer', 'feed'
  );
  select public.add_group_social_comment_v2(
    '${groupId}', 'group_recap', '${recapTarget}',
    'We made this week count', 'feed'
  );
`);

const recapValidation = await db.query(`
  select
    public.valid_group_social_target(
      '${groupId}', 'group_recap', '${recapTarget}'
    ) as valid,
    public.valid_group_social_target(
      '${groupId}', 'group_recap', '${metricRecapTarget}'
    ) as valid_group_metric,
    public.valid_group_social_target(
      '${groupId}', 'group_recap',
      'v1:week:2026-02-30:group-champion'
    ) as invalid_date,
    public.valid_group_social_target(
      '${groupId}', 'group_recap',
      'v1:week:2026-09-08:GROUP-CHAMPION'
    ) as invalid_story,
    public.valid_group_social_target(
      '${groupId}', 'group_recap',
      'v1:week:2026-09-08:group-forged'
    ) as unknown_metric_story,
    public.valid_group_social_target(
      '${groupId}', 'group_recap',
      'v1:week:2026-09-08:group-foreign_metric'
    ) as other_group_metric_story,
    public.valid_group_social_target(
      '${groupId}', 'group_recap',
      'v1:week:2025-12-30:group-champion'
    ) as before_group_lifetime,
    public.valid_group_social_target(
      '${groupId}', 'group_recap',
      'v1:week:' ||
      (((now() at time zone 'UTC')::date + 2)::text) ||
      ':group-champion'
    ) as beyond_global_date_horizon,
    public.valid_group_social_target(
      '${groupId}', 'group_recap',
      'v1:week:2025-12-31:group-champion'
    ) as earliest_global_creation_date,
    public.valid_group_social_target(
      '${groupId}', 'group_recap',
      'v1:week:' ||
      (((now() at time zone 'UTC')::date + 1)::text) ||
      ':group-champion'
    ) as latest_global_current_date;
`);
if (
  recapValidation.rows[0]?.valid !== true ||
  recapValidation.rows[0]?.valid_group_metric !== true ||
  recapValidation.rows[0]?.invalid_date !== false ||
  recapValidation.rows[0]?.invalid_story !== false ||
  recapValidation.rows[0]?.unknown_metric_story !== false ||
  recapValidation.rows[0]?.other_group_metric_story !== false ||
  recapValidation.rows[0]?.before_group_lifetime !== false ||
  recapValidation.rows[0]?.beyond_global_date_horizon !== false ||
  recapValidation.rows[0]?.earliest_global_creation_date !== true ||
  recapValidation.rows[0]?.latest_global_current_date !== true
)
  throw new Error(
    `aggregate recap target validation is not strict: ${JSON.stringify(recapValidation.rows[0])}`,
  );

await db.exec(`set request.jwt.claim.sub = '${ownerId}';`);
const recapSocial = await db.query(`
  select
    (select count(*)::integer from public.group_social_reactions
      where group_id = '${groupId}' and target_type = 'group_recap'
        and target_id = '${recapTarget}') as reactions,
    (select count(*)::integer from public.group_social_comments
      where group_id = '${groupId}' and target_type = 'group_recap'
        and target_id = '${recapTarget}') as comments,
    (select count(*)::integer from public.group_notification_events
      where group_id = '${groupId}' and target_type = 'group_recap') as notifications,
    (select count(*)::integer from public.push_dispatch_events
      where group_id = '${groupId}' and data ->> 'targetType' = 'group_recap') as pushes;
`);
if (
  recapSocial.rows[0]?.reactions !== 1 ||
  recapSocial.rows[0]?.comments !== 1 ||
  recapSocial.rows[0]?.notifications !== 0 ||
  recapSocial.rows[0]?.pushes !== 0
)
  throw new Error(
    `aggregate recap engagement did not persist ownerlessly: ${JSON.stringify(recapSocial.rows[0])}`,
  );

await db.exec(`set request.jwt.claim.sub = '${outsiderId}';`);
const outsiderTarget = await db.query(`
  select public.valid_group_social_target(
    '${groupId}', 'group_recap', '${recapTarget}'
  ) as valid;
`);
if (outsiderTarget.rows[0]?.valid !== false)
  throw new Error("a non-member could authorize an aggregate recap target");
await db.exec(`set request.jwt.claim.sub = '${memberId}';`);

let unsupportedChatReactionRejected = false;
try {
  await db.exec(`
    select public.set_group_social_reaction(
      '${groupId}', 'chat_message', '${ownerId}:message-client-1',
      'heart', 'chat'
    );
  `);
} catch {
  unsupportedChatReactionRejected = true;
}
if (!unsupportedChatReactionRejected)
  throw new Error("chat messages accepted a reaction outside like/dislike");

const socialNotifications = await db.query(`
  select target_type, interaction_surface from public.group_notification_events
   where recipient_id = '${ownerId}' and event_type = 'social_reaction'
   order by target_type;
`);
if (socialNotifications.rows.length !== 2)
  throw new Error("note/chat reactions did not create canonical notifications");
if (
  socialNotifications.rows[0].target_type !== "chat_message" ||
  socialNotifications.rows[0].interaction_surface !== "chat" ||
  socialNotifications.rows[1].target_type !== "group_note" ||
  socialNotifications.rows[1].interaction_surface !== "group_notes"
)
  throw new Error("social notifications lost their destination surface");

await db.exec(`
  select public.add_group_social_comment_v2(
    '${groupId}', 'group_note', '${noteId}', 'Count me in', 'group_notes'
  );
  set request.jwt.claim.sub = '${ownerId}';
  select public.delete_group_note('${noteId}', 2);
`);
const deletedNoteState = await db.query(`
  select
    (select count(*)::integer from public.group_notes
      where id = '${noteId}') as notes,
    (select count(*)::integer from public.group_social_reactions
      where group_id = '${groupId}' and target_type = 'group_note'
        and target_id = '${noteId}') as reactions,
    (select count(*)::integer from public.group_social_comments
      where group_id = '${groupId}' and target_type = 'group_note'
        and target_id = '${noteId}') as comments,
    (select count(*)::integer from public.group_notification_events
      where group_id = '${groupId}' and target_type = 'group_note'
        and target_id = '${noteId}') as notifications,
    (select count(*)::integer from public.push_dispatch_events
      where group_id = '${groupId}' and data ->> 'noteId' = '${noteId}') as pushes;
`);
if (Object.values(deletedNoteState.rows[0] ?? {}).some((count) => count !== 0))
  throw new Error(
    `deleting a group note left target-linked data behind: ${JSON.stringify(deletedNoteState.rows[0])}`,
  );

await db.exec(`
  select public.save_group_schedule_item(
    '${scheduleId}', '${groupId}', 'Updated all-day walk', null,
    '2026-09-09T00:00:00Z', null, true, 1
  );
  select public.delete_group_schedule_item('${scheduleId}', 2);
`);
const deletedScheduleState = await db.query(`
  select
    (select count(*)::integer from public.group_schedule_items
      where id = '${scheduleId}') as items,
    (select count(*)::integer from public.group_notification_events
      where group_id = '${groupId}' and target_type = 'group_schedule'
        and target_id = '${scheduleId}') as notifications,
    (select count(*)::integer from public.push_dispatch_events
      where group_id = '${groupId}'
        and data ->> 'scheduleItemId' = '${scheduleId}') as pushes;
`);
if (Object.values(deletedScheduleState.rows[0] ?? {}).some((count) => count !== 0))
  throw new Error(
    `deleting a group event left target-linked data behind: ${JSON.stringify(deletedScheduleState.rows[0])}`,
  );

await db.exec(`
  insert into public.group_todo_completions values
    ('${todoId}', '${groupId}', '${ownerId}', '2026-09-08T08:00:00Z'),
    ('${todoId}', '${groupId}', '${memberId}', '2026-09-08T08:10:00Z'),
    ('${todoId}', '${groupId}', '${thirdId}', '2026-09-08T08:20:00Z');
  update public.group_todos
     set shared_completed_at = '2026-09-08T09:00:00Z',
         shared_completed_by = '${memberId}'
   where id = '${sharedTodoId}';
`);

const todoEvents = await db.query(`
  select event_type, count(*)::integer as count
    from public.group_notification_events
   where event_type in ('group_todo_completed', 'group_todo_all_completed')
   group by event_type order by event_type;
`);
const byKind = new Map(todoEvents.rows.map((row) => [row.event_type, row.count]));
if (byKind.get("group_todo_completed") !== 4)
  throw new Error(
    `individual group todo completion audience is incorrect: ${JSON.stringify(todoEvents.rows)}`,
  );
if (byKind.get("group_todo_all_completed") !== 4)
  throw new Error(
    `all-complete/shared group todo audience is incorrect: ${JSON.stringify(todoEvents.rows)}`,
  );

const actorEcho = await db.query(`
  select count(*)::integer as count
    from public.group_notification_events
   where event_type like 'group_todo_%' and recipient_id = actor_id;
`);
if (actorEcho.rows[0]?.count !== 0)
  throw new Error("group todo notifications must exclude the actor");

const todoPushCount = await db.query(`
  select count(*)::integer as count from public.push_dispatch_events
   where event_type like 'group_todo_%';
`);
if (todoPushCount.rows[0]?.count !== 8)
  throw new Error("every group todo recipient needs a durable push row");

console.log("Group hub SQL, RLS/RPC, social-target, workspace/todo notification, and orphan-cleanup validation passed.");
