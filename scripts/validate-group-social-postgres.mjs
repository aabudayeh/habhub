import { PGlite } from "npm:@electric-sql/pglite@0.3.10";

const root = new URL("../", import.meta.url);
const migrations = await Promise.all(
  [
    "supabase/migrations/202608280001_durable_group_log_social_identity.sql",
    "supabase/migrations/202608300001_social_cheers.sql",
    "supabase/migrations/202608300002_group_feed_interaction_notifications.sql",
    "supabase/migrations/202608300003_social_notification_origin.sql",
    "supabase/migrations/202608300004_prompt_social_push_dispatch.sql",
    "supabase/migrations/202609050001_fix_challenge_result_social_recipient.sql",
    "supabase/migrations/202609080005_bounded_social_engagement.sql",
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

await db.exec(`
  insert into public.group_challenge_result_placements values
    ('${challengeId}', date '2026-08-28', '${ownerId}', true);
  insert into public.group_notification_events (
    event_key, group_id, recipient_id, event_type, challenge_id,
    occurrence_date, created_at
  ) values (
    'challenge-result-fixture', '${groupId}', '${ownerId}',
    'challenge_result', '${challengeId}', date '2026-08-28', now()
  );
`);
const challengeWinnerRecipient = await scalar(`
    select recipient_id::text
      from public.resolve_group_social_notification_target(
        '${groupId}',
        'group_challenge',
        '${challengeId}:2026-08-28:result'
      )
  `);
if (challengeWinnerRecipient !== ownerId)
  throw new Error(
    `An unambiguous challenge winner did not resolve to its canonical UUID (${JSON.stringify(challengeWinnerRecipient)}).`,
  );

await db.exec(`
  insert into public.group_challenge_result_placements values
    ('${challengeId}', date '2026-08-28', '${otherOwnerId}', true);
`);
if (
  Number(
    await scalar(`
      select count(*)
        from public.resolve_group_social_notification_target(
          '${groupId}',
          'group_challenge',
          '${challengeId}:2026-08-28:result'
        )
    `),
  ) !== 0
)
  throw new Error("A tied challenge result guessed a notification recipient.");

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

// Use the deployed SELECT policies, including target privacy and blocked-user
// filtering, to exercise the aggregate APIs as an actual authenticated role.
const safetyMigration = await Deno.readTextFile(new URL(
  "supabase/migrations/202609040002_user_safety.sql", root,
));
await db.exec(`
  truncate public.group_social_reactions, public.group_social_comments;
  alter table public.group_social_reactions disable trigger user;
  alter table public.group_social_comments disable trigger user;
  insert into public.group_social_reactions (group_id, target_type, target_id, user_id, reaction, created_at)
    select '${groupId}', 'metric_entry', '${entryId}',
      case when i = 1 then '${viewerId}'::uuid else ('90000000-0000-4000-8000-' || lpad(i::text, 12, '0'))::uuid end,
      'heart', '2026-01-01'::timestamptz + i * interval '1 minute'
      from generate_series(1, 1501) i;
  insert into public.group_social_comments (id, group_id, target_type, target_id, user_id, content, created_at)
    select ('91000000-0000-4000-8000-' || lpad(i::text, 12, '0'))::uuid,
      '${groupId}', 'metric_entry', '${entryId}', '${ownerId}', 'Comment ' || i, '2026-09-08 12:00Z'
      from generate_series(1, 1203) i;
  insert into public.group_social_comments (group_id, target_type, target_id, user_id, content)
    values ('${groupId}', 'metric_entry', '${entryId}', '90000000-0000-4000-8000-000000000002', 'Blocked author');
  alter table public.group_social_reactions enable trigger user;
  alter table public.group_social_comments enable trigger user;
  alter table public.group_social_reactions enable row level security;
  alter table public.group_social_comments enable row level security;
  create function public.habhub_message_visible_to_current_user(p_user_id uuid, p_unused uuid)
    returns boolean language sql stable as $$
      select p_user_id::text <> coalesce(current_setting('test.blocked_user', true), '')
    $$;
  grant usage on schema auth to authenticated;
  grant select on public.group_social_reactions, public.group_social_comments, public.group_members to authenticated;
`);
for (const table of ["group_social_reactions", "group_social_comments"]) {
  const policy = safetyMigration.match(new RegExp(`create policy ${table}_member_read[\\s\\S]*?;`))?.[0];
  if (!policy) throw new Error(`Missing deployed read policy for ${table}`);
  await db.exec(policy);
}
await db.exec(`set role authenticated; set test.blocked_user = '90000000-0000-4000-8000-000000000002';`);
const targetJson = JSON.stringify([{ type: "metric_entry", id: entryId }]);
const summarySql = `select * from public.get_group_social_engagement('${groupId}', '${targetJson}', true)`;
const summary = (await db.query(summarySql)).rows[0];
if (summary.reaction_counts.heart !== 1500 || Number(summary.comment_count) !== 1203)
  throw new Error(`High-volume RLS counts were truncated or included blocked authors: ${JSON.stringify(summary.reaction_counts)}, ${summary.comment_count}`);
if (summary.own_reaction.user_id !== viewerId)
  throw new Error("The viewer's oldest reaction disappeared behind newer reactions.");
if (summary.comments.length !== 20 || !summary.has_more_comments)
  throw new Error("A popular target must return exactly one bounded 20-comment preview.");
const firstIds = new Set(summary.comments.map((row) => row.id));
const cursor = summary.comments[0];
const second = await scalar(`select public.list_group_social_comments_page('${groupId}', 'metric_entry', '${entryId}', '${cursor.created_at}', '${cursor.id}', 20)`);
if (second.comments.length !== 20 || second.comments.some((row) => firstIds.has(row.id)))
  throw new Error("Equal-timestamp comment cursors duplicated or skipped a page.");
if (!second.comments[19].id.endsWith("000000001183"))
  throw new Error("The second page did not continue immediately before the first page.");
const maxPage = await scalar(`select public.list_group_social_comments_page('${groupId}', 'metric_entry', '${entryId}', null, null, 999999)`);
if (maxPage.comments.length !== 50) throw new Error("A caller bypassed the 50-comment page ceiling.");
let invalidCursorRejected = false;
try { await db.query(`select public.list_group_social_comments_page('${groupId}', 'metric_entry', '${entryId}', now(), null)`); }
catch { invalidCursorRejected = true; }
if (!invalidCursorRejected) throw new Error("An incomplete cursor silently restarted pagination.");
let oversizedRejected = false;
try { await db.query(`select * from public.get_group_social_engagement('${groupId}', '${JSON.stringify(Array(21).fill({ type: 'metric_entry', id: entryId }))}', true)`); }
catch { oversizedRejected = true; }
if (!oversizedRejected) throw new Error("An oversized summary request was not bounded.");
await db.exec(`reset role; insert into public.metric_privacy_cache_fences values ('${groupId}', '${ownerId}', '${metricId}', 5); set role authenticated;`);
if ((await db.query(summarySql)).rows.length)
  throw new Error("Aggregate counts disclosed engagement for a privacy-fenced log.");
await db.exec(`reset role; delete from public.metric_privacy_cache_fences; set role authenticated; set request.jwt.claim.sub = '99000000-0000-4000-8000-000000000001';`);
if ((await db.query(summarySql)).rows.length)
  throw new Error("An outsider read group engagement counts.");
await db.exec("reset role; set role anon;");
let anonymousRejected = false;
try { await db.query(summarySql); } catch { anonymousRejected = true; }
if (!anonymousRejected) throw new Error("An anonymous caller could execute the engagement summary RPC.");
await db.exec("reset role;");

console.log(
  "Group social PostgreSQL validation passed: canonical identities, prompt dispatch, collision and privacy fences, exact 1,500-reaction/1,203-comment counts, oldest own reaction, equal-time cursor pages, request ceilings, blocked authors, outsider and anonymous access.",
);
