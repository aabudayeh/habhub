/* global Deno */
// Deno resolves this pinned npm import; Node/Expo's resolver does not.
// eslint-disable-next-line import/no-unresolved
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

// Execute the follow-on migration on real PostgreSQL semantics. Network/cron
// are narrow record-only fixtures: this never invokes a production worker.
await db.exec(`
  create role service_role;
  create table realtime.calls (payload jsonb, event_name text);
  create or replace function realtime.send(payload jsonb, event_name text, topic text, private boolean)
  returns void language plpgsql as $$ begin
    insert into realtime.calls values (payload, event_name); end $$;
  create table public.user_snapshots (user_id uuid primary key, payload jsonb not null);
  create table public.push_dispatch_configuration (singleton boolean primary key, emitters_active boolean);
  insert into public.push_dispatch_configuration values (true, true);
  alter table public.push_dispatch_events
    add column created_at timestamptz not null default now(),
    add column dispatched_at timestamptz,
    add constraint push_dispatch_events_event_key_key unique(event_key);
  create table public.user_blocks (blocker_id uuid, blocked_user_id uuid);
  create or replace function public.habhub_users_blocked_either_way(a uuid, b uuid)
  returns boolean language sql stable as $$
    select exists (select 1 from public.user_blocks
      where (blocker_id = a and blocked_user_id = b)
        or (blocker_id = b and blocked_user_id = a))
  $$;
  create schema cron;
  create table cron.job (jobid bigint, jobname text);
  create function cron.unschedule(bigint) returns boolean language sql as $$ select true $$;
  create function cron.schedule(text, text, text) returns bigint language sql as $$ select 1::bigint $$;
  create schema vault;
  create table vault.decrypted_secrets (name text, decrypted_secret text, created_at timestamptz default now());
  insert into vault.decrypted_secrets(name, decrypted_secret) values
    ('challenge_notification_worker_url', 'https://fixture.supabase.co/functions/v1/challenge-notifications'),
    ('challenge_notification_worker_secret', repeat('fixture-only-', 4));
  create schema net;
  create table net.calls (url text, body jsonb);
  create function net.http_post(url text, headers jsonb, body jsonb, timeout_milliseconds integer)
  returns bigint language plpgsql as $$ begin
    insert into net.calls values (url, body); return 1; end $$;
`);
const reminderMigration = await Deno.readTextFile(new URL(
  "../supabase/migrations/202609080006_group_schedule_reminders.sql", import.meta.url,
));
for (const [index, statement] of sqlStatements(reminderMigration).entries()) {
  try { await db.exec(statement); }
  catch (error) { throw new Error(`Reminder migration statement ${index + 1}: ${error}`); }
}
function ensure(value, message) { if (!value) throw new Error(message); }
async function sqlError(source, code) {
  try { await db.exec(source); }
  catch (error) {
    ensure(error.code === code, `Expected SQLSTATE ${code}, got ${error.code}: ${error}`);
    return;
  }
  throw new Error(`Expected SQLSTATE ${code}, but statement succeeded`);
}
async function reminderEvent(startExpression, offset = "15", allDay = false) {
  return (await db.query(`select * from public.save_group_schedule_item(
    null, '${groupId}', 'Shared walk', null, ${startExpression}, null, ${allDay}, null, ${offset}
  )`)).rows[0];
}
async function stageReminders(limit = 100) {
  // Cron/service work must not impersonate the last user's auth session.
  await db.exec("set request.jwt.claim.sub = ''");
  const staged = await db.query(`select * from public.stage_due_group_schedule_reminders(${limit})`);
  await db.exec(`set request.jwt.claim.sub = '${ownerId}'`);
  return staged.rows;
}
async function currentReminder(item, key) {
  return (await db.query(`select public.group_schedule_reminder_is_current(
    '${item.group_id}', '${item.id}', '${key}') as current`)).rows[0].current;
}
async function updateReminder(item, { start = `'${item.starts_at.toISOString()}'`, offset = item.reminder_minutes, title = "Updated walk" } = {}) {
  return (await db.query(`select * from public.save_group_schedule_item(
    '${item.id}', '${item.group_id}', '${title}', null, ${start}, null, false,
    ${item.revision}, ${offset ?? "null"})`)).rows[0];
}
await db.exec(`
  insert into public.user_snapshots values
    ('${ownerId}', '{"settings":{"notifications":{"groupPreferencesByGroup":{"${groupId}":{"scheduleReminders":true}}}}}'),
    ('${memberId}', '{"settings":{"notifications":{"groupPreferencesByGroup":{"${groupId}":{"scheduleReminders":true}}}}}'),
    ('${thirdId}', '{"settings":{"notifications":{"groupPreferencesByGroup":{"${groupId}":{"scheduleReminders":false}}}}}');
`);
const oldClient = (await db.query(`select * from public.save_group_schedule_item(
  null, '${groupId}', 'Old client event', null, now() + interval '1 hour', null, false, null
)`)).rows[0];
ensure(oldClient.reminder_minutes === null, "Old clients must default to no reminder");
await sqlError(`select public.save_group_schedule_item(null, '${groupId}', 'Invalid offset', null, now(), null, false, null, 7)`, "22023");
await sqlError(`select public.save_group_schedule_item(null, '${groupId}', 'All day', null, now(), null, true, null, 15)`, "22023");
const future = await reminderEvent("now() + interval '2 hours'");
const expired = await reminderEvent("now() - interval '20 minutes'", "0");
let due = await reminderEvent("now() + interval '10 minutes'");
ensure(due.reminder_due_at < new Date(), "Generated reminder due time is wrong");
await db.exec("update public.push_dispatch_configuration set emitters_active = false");
ensure((await stageReminders()).length === 0, "Rollout gate must prevent staging");
await db.exec("select public.invoke_group_schedule_reminder_worker()");
ensure((await db.query("select count(*)::integer as count from net.calls")).rows[0].count === 0, "Disabled rollout must not invoke worker");
await db.exec("update public.push_dispatch_configuration set emitters_active = true; select public.invoke_group_schedule_reminder_worker()");
ensure((await db.query("select body from net.calls")).rows[0]?.body?.mode === "group_schedule", "Due worker must use schedule-only mode");
await db.exec("truncate realtime.calls");
const firstStage = await stageReminders();
ensure((await db.query("select count(*)::integer as count from realtime.calls where event_name = 'group_hub_updated'")).rows[0].count === 0, "Reminder delivery bookkeeping must not broadcast a calendar invalidation");
ensure(firstStage.length === 1, "Only the due, unexpired event should be staged");
const firstKey = firstStage[0].event_key;
ensure(await currentReminder(due, firstKey), "Due instance must validate before dispatch");
ensure(!(await currentReminder(future, firstKey)) && !(await currentReminder(expired, firstKey)), "Canonical ID and time must match");
const recipients = (await db.query(`select recipient_id from public.group_notification_events where event_key = '${firstKey}' order by recipient_id`)).rows;
ensure(JSON.stringify(recipients.map((r) => r.recipient_id)) === JSON.stringify([ownerId, memberId]), "Only opted-in members including creator should receive the reminder");
const firstPush = (await db.query(`select * from public.push_dispatch_events where event_key = '${firstKey}'`)).rows[0];
ensure(firstPush.audience === "group_including_sender" && firstPush.data.route === "/group-schedule" && firstPush.data.scheduleItemId === due.id, "Reminder canonical audience/deep link is incorrect");
ensure((await stageReminders()).length === 0, "Repeated staging must be idempotent");
await sqlError(`select public.save_group_schedule_item('${due.id}', '${groupId}', 'Stale', null, now(), null, false, 0, 15)`, "40001");
await db.exec(`set request.jwt.claim.sub = '${memberId}'`);
await sqlError(`select public.save_group_schedule_item('${due.id}', '${groupId}', 'Other owner', null, now(), null, false, ${due.revision}, 15)`, "42501");
await db.exec(`set request.jwt.claim.sub = '${ownerId}'`);
due = await updateReminder(due, { title: "Title-only change" });
ensure((await db.query("select count(*)::integer as count from realtime.calls where event_name = 'group_hub_updated'")).rows[0].count === 1, "Real calendar edits must still broadcast once");
ensure(await currentReminder(due, firstKey), "Title-only edit must preserve reminder identity");
ensure((await stageReminders()).length === 0, "Title-only edits must not duplicate reminders");
due = await updateReminder(due, { start: "now() + interval '1 day'" });
ensure(!(await currentReminder(due, firstKey)), "Moved event must reject old reminder");
ensure((await db.query(`select count(*)::integer as count from public.group_notification_events where event_key = '${firstKey}'`)).rows[0].count === 0, "Moved event must clear stale inbox reminder");
ensure((await db.query(`select expires_at <= now() as expired from public.push_dispatch_events where event_key = '${firstKey}'`)).rows[0].expired, "Moved event must expire stale outbox row");
ensure((await stageReminders()).length === 0, "Moved future event must not notify early");
due = await updateReminder(due, { start: "now() + interval '7 minutes'" });
const movedKey = (await stageReminders())[0]?.event_key;
ensure(movedKey && movedKey !== firstKey && await currentReminder(due, movedKey), "New scheduled instance must stage exactly once");
due = await updateReminder(due, { offset: null });
ensure(!(await currentReminder(due, movedKey)), "Disabled reminder must invalidate pending delivery");
ensure((await stageReminders()).length === 0, "Disabled reminder must not restage");

await db.exec(`insert into public.user_blocks values ('${memberId}', '${ownerId}')`);
const blocked = await reminderEvent("now() + interval '5 minutes'");
const blockedKey = (await stageReminders())[0]?.event_key;
ensure((await db.query(`select count(*)::integer as count from public.group_notification_events where event_key = '${blockedKey}' and recipient_id = '${memberId}'`)).rows[0].count === 0, "Bidirectional block must exclude reminder recipient");
await db.exec(`update public.group_members set status = 'left' where group_id = '${groupId}' and user_id = '${ownerId}'`);
ensure(!(await currentReminder(blocked, blockedKey)), "Former event creator membership must invalidate pending reminder");
await db.exec(`update public.group_members set status = 'active' where group_id = '${groupId}' and user_id = '${ownerId}'; delete from public.user_blocks`);
await db.exec(`select public.delete_group_schedule_item('${blocked.id}', ${blocked.revision})`);
ensure(!(await currentReminder(blocked, blockedKey)), "Deleted events must invalidate canonical reminder");
ensure((await db.query(`select count(*)::integer as count from public.push_dispatch_events where event_key = '${blockedKey}'`)).rows[0].count === 0, "Deleted event must clean up its pending outbox");
const zeroOffset = await reminderEvent("now() - interval '1 minute'", "0");
await reminderEvent("now() + interval '3 minutes'");
ensure((await stageReminders(1)).length === 1 && (await stageReminders(1)).length === 1, "Bounded staging must leave remaining due work retryable");
ensure((await stageReminders()).length === 0, "Completed batches must leave no duplicate work");
await db.exec(`update public.group_schedule_items set starts_at = now() - interval '16 minutes' where id = '${zeroOffset.id}'`);
const oldZeroKey = (await db.query(`select event_key from public.push_dispatch_events where data ->> 'scheduleItemId' = '${zeroOffset.id}'`)).rows[0].event_key;
ensure(!(await currentReminder(zeroOffset, oldZeroKey)), "Expired reminder cannot be delivered");
await db.exec("update public.push_dispatch_events set dispatched_at = now() where event_type = 'group_schedule_reminder'; truncate net.calls; select public.invoke_group_schedule_reminder_worker()");
ensure((await db.query("select count(*)::integer as count from net.calls")).rows[0].count === 0, "Idle calendar must not invoke an Edge worker");
const acl = (await db.query(`select
  has_function_privilege('authenticated', 'public.stage_due_group_schedule_reminders(integer)', 'execute') as client_stage,
  has_function_privilege('anon', 'public.group_schedule_reminder_is_current(uuid,uuid,text)', 'execute') as anon_read,
  has_function_privilege('service_role', 'public.stage_due_group_schedule_reminders(integer)', 'execute') as worker_stage,
  has_function_privilege('authenticated', 'public.save_group_schedule_item(uuid,uuid,text,text,timestamptz,timestamptz,boolean,bigint,integer)', 'execute') as client_save
`)).rows[0];
ensure(!acl.client_stage && !acl.anon_read && acl.worker_stage && acl.client_save, "Reminder RPC grants must keep staging/revalidation service-only");
console.log("Group schedule reminders: real SQL migration, opt-in audience, timed offsets, CAS/access, idempotence, edit/move/disable/delete/expiry, blocks/membership, bounded retry, rollout/idle cron guards, and RPC ACL checks passed.");
