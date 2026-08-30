import { PGlite } from "npm:@electric-sql/pglite@0.3.10";

const root = new URL("../", import.meta.url);
const migrations = await Promise.all(
  [
    "supabase/migrations/202608280001_durable_group_log_social_identity.sql",
    "supabase/migrations/202608300001_social_cheers.sql",
    "supabase/migrations/202608300002_group_feed_interaction_notifications.sql",
    "supabase/migrations/202608300003_social_notification_origin.sql",
    "supabase/migrations/202608300004_prompt_social_push_dispatch.sql",
  ].map((path) => Deno.readTextFile(new URL(path, root))),
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
    if (char === "'") {
      single = true;
      continue;
    }
    if (char === '"') {
      double = true;
      continue;
    }
    if (char === "$") {
      const match = source.slice(index).match(/^\$[A-Za-z_][A-Za-z0-9_]*\$|^\$\$/);
      if (match) {
        dollarTag = match[0];
        index += dollarTag.length - 1;
        continue;
      }
    }
    if (char === ";") {
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
  create function auth.uid() returns uuid language sql stable as $$
    select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
  $$;

  create table public.groups (id uuid primary key);
  create table public.profiles (id uuid primary key, display_name text);
  create table public.group_members (
    group_id uuid not null,
    user_id uuid not null,
    status text not null,
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
  create function public.group_challenge_occurs_on(jsonb, date, date)
  returns boolean language sql immutable as $$ select false $$;

  create table public.metric_definitions (
    id uuid primary key,
    group_id uuid not null,
    slug text not null,
    name text not null,
    score_weight numeric not null default 1,
    archived_at timestamptz
  );
  create table public.metric_entries (
    id uuid primary key,
    client_generated_id text not null,
    metric_id uuid not null,
    user_id uuid not null,
    local_date date not null,
    visibility text not null,
    account_revision bigint,
    updated_at timestamptz not null default now()
  );
  create table public.metric_privacy_cache_fences (
    group_id uuid not null,
    user_id uuid not null,
    metric_id uuid not null,
    revision bigint not null
  );
  create table public.photo_updates (
    group_id uuid not null,
    owner_user_id uuid not null,
    client_generated_id text not null,
    visibility text not null,
    local_date date not null,
    created_at timestamptz not null default now()
  );
  create table public.group_todos (
    id uuid primary key,
    group_id uuid not null,
    creator_id uuid not null,
    created_at timestamptz not null default now()
  );
  create table public.daily_metric_status (
    group_id uuid not null,
    metric_id uuid not null,
    user_id uuid not null,
    local_date date not null,
    visibility text,
    score_contribution numeric not null default 0
  );
  create table public.group_challenges (
    id uuid primary key,
    group_id uuid not null,
    creator_id uuid not null,
    metric_slug text not null,
    title text,
    local_date date not null,
    end_date date not null,
    recurrence jsonb,
    deleted_at timestamptz
  );
  create table public.group_challenge_result_placements (
    challenge_id uuid not null,
    occurrence_date date not null,
    user_id uuid not null,
    winner boolean not null
  );
  create table public.group_social_reactions (
    group_id uuid not null,
    target_type text not null,
    target_id text not null check (char_length(target_id) between 1 and 240),
    user_id uuid not null,
    reaction text not null,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    primary key (group_id, target_type, target_id, user_id)
  );
  create table public.group_social_comments (
    id uuid primary key default gen_random_uuid(),
    group_id uuid not null,
    target_type text not null,
    target_id text not null check (char_length(target_id) between 1 and 240),
    user_id uuid not null,
    content text not null,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
  );
  create function public.touch_group_social_updated_at()
  returns trigger language plpgsql as $$
  begin
    new.updated_at = clock_timestamp();
    return new;
  end;
  $$;
  create trigger group_social_reactions_touch_updated_at
  before update on public.group_social_reactions
  for each row execute function public.touch_group_social_updated_at();
  create table public.group_notification_events (
    event_key text not null,
    group_id uuid not null,
    recipient_id uuid not null,
    actor_id uuid,
    event_type text not null,
    challenge_id uuid,
    title text,
    detail text,
    occurrence_date date,
    target_type text,
    target_id text,
    reaction text,
    created_at timestamptz,
    unique (recipient_id, event_key)
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
`);

for (const [index, statement] of sqlStatements(migrations.join("\n")).entries()) {
  try {
    await db.exec(statement);
  } catch (error) {
    throw new Error(
      `Social migration statement ${index + 1} failed (${statement.slice(0, 100).replaceAll("\n", " ")} ... ${statement.slice(-180).replaceAll("\n", " ")}): ${error}`,
    );
  }
}

const groupId = "10000000-0000-4000-8000-000000000001";
const viewerId = "20000000-0000-4000-8000-000000000001";
const ownerId = "20000000-0000-4000-8000-000000000002";
const otherOwnerId = "20000000-0000-4000-8000-000000000003";
const metricId = "30000000-0000-4000-8000-000000000001";
const entryId = "40000000-0000-4000-8000-000000000001";
// Deliberately UUID-shaped: this was the production failure mode.
const legacyEntryId = "50000000-0000-4000-8000-000000000001";
const photoId = "photo-client-id";
const todoId = "60000000-0000-4000-8000-000000000001";
const challengeId = "70000000-0000-4000-8000-000000000001";
const forgedBadgeTarget = `${otherOwnerId}:not-an-earned-badge:2026-08-28`;

await db.exec(`
  set request.jwt.claim.sub = '${viewerId}';
  insert into public.groups values ('${groupId}');
  insert into public.profiles values
    ('${viewerId}', 'Viewer'), ('${ownerId}', 'Owner'),
    ('${otherOwnerId}', 'Other owner');
  insert into public.group_members values
    ('${groupId}', '${viewerId}', 'active'),
    ('${groupId}', '${ownerId}', 'active'),
    ('${groupId}', '${otherOwnerId}', 'active');
  insert into public.metric_definitions values
    ('${metricId}', '${groupId}', 'food', 'Food', 1, null);
  insert into public.metric_entries values
    ('${entryId}', '${legacyEntryId}', '${metricId}', '${ownerId}',
     date '2026-08-28', 'group', 5, now());
  insert into public.photo_updates values
    ('${groupId}', '${ownerId}', '${photoId}', 'group', date '2026-08-28', now());
  insert into public.group_todos values
    ('${todoId}', '${groupId}', '${ownerId}', now());
  insert into public.daily_metric_status values
    ('${groupId}', '${metricId}', '${ownerId}', date '2026-08-28', 'group', 100);
  insert into public.group_challenges values
    ('${challengeId}', '${groupId}', '${ownerId}', 'food', 'Food challenge',
     date '2026-08-28', date '2026-08-28', null, null);
`);

async function scalar(sql) {
  const result = await db.query(sql);
  return Object.values(result.rows[0] ?? {})[0];
}

if (
  (await scalar(
    `select public.resolve_group_social_metric_entry_id('${groupId}', '${entryId}')::text`,
  )) !== entryId
)
  throw new Error("Canonical shared-log UUID did not resolve.");
if (
  (await scalar(
    `select public.resolve_group_social_metric_entry_id('${groupId}', '${legacyEntryId}')::text`,
  )) !== entryId
)
  throw new Error("UUID-shaped legacy shared-log id did not resolve.");

const metricReaction = await db.query(`
  select (public.set_group_social_reaction(
    '${groupId}', 'metric_entry', '${legacyEntryId}', 'cheer'
  )).target_id
`);
if (metricReaction.rows[0]?.target_id !== entryId)
  throw new Error("Metric reaction was not persisted on the canonical UUID.");

const metricReactionEventCount = Number(
  await scalar(`
    select count(*)
      from public.group_notification_events
     where event_type = 'social_reaction'
       and target_type = 'metric_entry'
       and target_id = '${entryId}'
  `),
);
const metricReactionPushCount = Number(
  await scalar(`
    select count(*)
      from public.push_dispatch_events
     where event_type = 'social_reaction'
       and data ->> 'targetType' = 'metric_entry'
       and data ->> 'targetId' = '${entryId}'
  `),
);
await db.query(`
  select public.set_group_social_reaction(
    '${groupId}', 'metric_entry', '${entryId}', 'cheer'
  )
`);
if (
  Number(
    await scalar(`
      select count(*)
        from public.group_notification_events
       where event_type = 'social_reaction'
         and target_type = 'metric_entry'
         and target_id = '${entryId}'
    `),
  ) !== metricReactionEventCount ||
  Number(
    await scalar(`
      select count(*)
        from public.push_dispatch_events
       where event_type = 'social_reaction'
         and data ->> 'targetType' = 'metric_entry'
         and data ->> 'targetId' = '${entryId}'
    `),
  ) !== metricReactionPushCount
)
  throw new Error(
    "Replaying an unchanged reaction created a duplicate recipient event or push.",
  );

await db.query(`
  select public.set_group_social_reaction(
    '${groupId}', 'metric_entry', '${entryId}', 'heart', 'leaderboard_log'
  )
`);
if (
  (await scalar(`
    select interaction_surface
      from public.group_notification_events
     where event_type = 'social_reaction'
       and target_id = '${entryId}'
     order by created_at desc limit 1
  `)) !== "leaderboard_log" ||
  (await scalar(`
    select data ->> 'route'
      from public.push_dispatch_events
     where event_type = 'social_reaction'
       and data ->> 'entryId' = '${entryId}'
     order by expires_at desc limit 1
  `)) !== "/leaderboard-detail"
)
  throw new Error("A Leaderboard-log reaction lost its origin-aware deep link.");

const promptReaction = await db.query(`
  select public.set_group_social_reaction_v2(
    '${groupId}', 'metric_entry', '${entryId}', 'thumbs_up', 'leaderboard_log'
  ) as result
`);
const promptReactionPayload = promptReaction.rows[0]?.result;
if (
  promptReactionPayload?.reaction?.reaction !== "thumbs_up" ||
  typeof promptReactionPayload?.push_event_key !== "string"
)
  throw new Error(
    "The prompt reaction boundary did not return its committed canonical push key.",
  );
if (
  Number(
    await scalar(`
      select count(*)
        from public.push_dispatch_events
       where event_key = '${promptReactionPayload.push_event_key}'
         and dispatcher_id = '${viewerId}'
         and event_type = 'social_reaction'
         and data ->> 'route' = '/leaderboard-detail'
    `),
  ) !== 1
)
  throw new Error(
    "The prompt reaction key did not identify exactly one actor-owned outbox row.",
  );

await db.exec(`
  insert into public.group_social_comments (
    group_id, target_type, target_id, user_id, content
  ) values (
    '${groupId}', 'metric_entry', '${legacyEntryId}', '${viewerId}', 'Nice meal'
  );
`);
if (
  (await scalar(
    `select target_id from public.group_social_comments where content = 'Nice meal'`,
  )) !== entryId
)
  throw new Error("Metric comment did not canonicalize before storage.");
if (
  (await scalar(
    `select event_type from public.group_notification_events where target_id = '${entryId}' and event_type = 'social_comment' limit 1`,
  )) !== "social_comment"
)
  throw new Error("A feed comment did not create a durable recipient notification.");
if (
  (await scalar(
    `select data ->> 'route' from public.push_dispatch_events where event_type = 'social_comment' limit 1`,
  )) !== "/recapfeed"
)
  throw new Error("A feed comment push did not route back to the exact feed screen.");

await db.exec(`
  insert into public.group_social_comments (
    group_id, target_type, target_id, user_id, content, source_surface
  ) values (
    '${groupId}', 'metric_entry', '${entryId}', '${viewerId}',
    'Leaderboard detail comment', 'leaderboard_log'
  );
`);
if (
  (await scalar(`
    select data ->> 'route'
      from public.push_dispatch_events
     where event_type = 'social_comment'
       and data ->> 'entryId' = '${entryId}'
     order by expires_at desc limit 1
  `)) !== "/leaderboard-detail"
)
  throw new Error("A Leaderboard-log comment lost its origin-aware deep link.");

const promptComment = await db.query(`
  select public.add_group_social_comment_v2(
    '${groupId}', 'metric_entry', '${entryId}',
    'Prompt Leaderboard comment', 'leaderboard_log'
  ) as result
`);
const promptCommentPayload = promptComment.rows[0]?.result;
if (
  promptCommentPayload?.comment?.content !== "Prompt Leaderboard comment" ||
  promptCommentPayload?.comment?.user_id !== viewerId ||
  typeof promptCommentPayload?.push_event_key !== "string"
)
  throw new Error(
    "The prompt comment boundary did not derive the actor or return its committed push key.",
  );
if (
  Number(
    await scalar(`
      select count(*)
        from public.push_dispatch_events
       where event_key = '${promptCommentPayload.push_event_key}'
         and dispatcher_id = '${viewerId}'
         and event_type = 'social_comment'
         and data ->> 'route' = '/leaderboard-detail'
    `),
  ) !== 1
)
  throw new Error(
    "The prompt comment key did not identify exactly one actor-owned outbox row.",
  );

for (const [type, id] of [
  ["photo_update", photoId],
  ["group_todo", todoId],
  ["recap_feed", `leader:${ownerId}:2026-08-28`],
  ["group_challenge", `${challengeId}:2026-08-28:started`],
]) {
  const accepted = await scalar(`
    select (public.set_group_social_reaction(
      '${groupId}', '${type}', '${id}', 'thumbs_up'
    )).target_id
  `);
  if (accepted !== id)
    throw new Error(`${type} feed target was rejected or rewritten unexpectedly.`);
}

// A badge target currently has no server-owned earned-badge row. Whether the
// mutation is rejected or merely kept as non-notifying social state, its
// client-supplied member UUID must never become a notification recipient.
try {
  await db.query(`
    select public.set_group_social_reaction(
      '${groupId}', 'badge', '${forgedBadgeTarget}', 'thumbs_up'
    )
  `);
} catch {
  // Rejection is an equally safe outcome until badges gain canonical rows.
}
if (
  Number(
    await scalar(`
      select count(*)
        from public.group_notification_events
       where target_type = 'badge'
         and target_id = '${forgedBadgeTarget}'
    `),
  ) !== 0 ||
  Number(
    await scalar(`
      select count(*)
        from public.push_dispatch_events
       where data ->> 'targetType' = 'badge'
         and data ->> 'targetId' = '${forgedBadgeTarget}'
    `),
  ) !== 0
)
  throw new Error("A forged badge target selected a notification recipient.");

await db.exec(`
  insert into public.daily_metric_status values
    ('${groupId}', '${metricId}', '${ownerId}', date '2026-08-29', 'group', 100),
    ('${groupId}', '${metricId}', '${otherOwnerId}', date '2026-08-29', 'group', 100);
`);
await db.query(`
  select public.set_group_social_reaction(
    '${groupId}', 'recap_feed', 'leader:${ownerId}:2026-08-29', 'thumbs_up'
  )
`);
if (
  Number(
    await scalar(`
      select count(*)
        from public.group_notification_events
       where target_type = 'recap_feed'
         and target_id = 'leader:${ownerId}:2026-08-29'
    `),
  ) !== 0 ||
  Number(
    await scalar(`
      select count(*)
        from public.push_dispatch_events
       where data ->> 'targetType' = 'recap_feed'
         and data ->> 'targetId' = 'leader:${ownerId}:2026-08-29'
    `),
  ) !== 0
)
  throw new Error("A tied daily-leader target guessed a notification recipient.");
if (
  Number(
    await scalar(`
      select count(distinct target_type)
        from public.group_notification_events
       where event_type = 'social_reaction'
         and recipient_id = '${ownerId}'
    `),
  ) !== 5
)
  throw new Error(
    "A privacy-authorized feed target did not resolve its canonical owner notification.",
  );
if (
  Number(
    await scalar(`
      select count(*)
        from public.push_dispatch_events
       where event_type = 'social_reaction'
         and data ->> 'route' = '/recapfeed'
         and data ? 'targetType'
         and data ? 'targetId'
    `),
  ) !== 5
)
  throw new Error("A feed reaction push lost its exact target deep link.");

await db.exec(`
  insert into public.metric_privacy_cache_fences values
    ('${groupId}', '${ownerId}', '${metricId}', 5);
`);
if (
  (await scalar(
    `select public.valid_group_social_target('${groupId}', 'metric_entry', '${entryId}')`,
  )) !== false
)
  throw new Error("A privacy-fenced log remained a valid social target.");
let privateMutationRejected = false;
try {
  await db.query(`
    select public.set_group_social_reaction(
      '${groupId}', 'metric_entry', '${entryId}', 'thumbs_down'
    )
  `);
} catch {
  privateMutationRejected = true;
}
if (!privateMutationRejected)
  throw new Error("The reaction RPC accepted a privacy-fenced log.");

await db.exec(`
  delete from public.metric_privacy_cache_fences;
  insert into public.metric_entries values
    ('40000000-0000-4000-8000-000000000002', '${legacyEntryId}', '${metricId}',
     '${otherOwnerId}', date '2026-08-28', 'group', 6, now());
`);
if (
  (await scalar(
    `select public.resolve_group_social_metric_entry_id('${groupId}', '${legacyEntryId}')`,
  )) !== null
)
  throw new Error("An ambiguous legacy client id was guessed instead of rejected.");

console.log(
  "Group social PostgreSQL validation passed: canonical identities, prompt exact-event dispatch keys, origin-aware comment and reaction delivery, unchanged-reaction idempotency, forged-badge and tied-leader suppression, collision rejection, and privacy fences.",
);
