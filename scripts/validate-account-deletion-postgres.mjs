import assert from "node:assert/strict";
import { PGlite } from "npm:@electric-sql/pglite@0.3.10";

const root = new URL("../", import.meta.url);
const migration = await Deno.readTextFile(
  new URL(
    "supabase/migrations/202609040003_fail_closed_account_content_deletion.sql",
    root,
  ),
);
const safetyMigration = await Deno.readTextFile(
  new URL("supabase/migrations/202609040002_user_safety.sql", root),
);

assert.match(
  safetyMigration,
  /report_type <> 'message'[\s\S]{0,160}message_client_generated_id is not null[\s\S]{0,160}reported_user_id is null/,
  "retained reports must allow message evidence identifiers to be redacted after account deletion",
);

const USER = "20000000-0000-4000-8000-000000000001";
const OTHER = "20000000-0000-4000-8000-000000000002";
const THIRD = "20000000-0000-4000-8000-000000000003";
const FORMER = "20000000-0000-4000-8000-000000000004";
const UNRELATED = "20000000-0000-4000-8000-000000000005";
const ATTEMPT = "30000000-0000-4000-8000-000000000001";
const WRONG_ATTEMPT = "30000000-0000-4000-8000-000000000002";
const GROUP = "31000000-0000-4000-8000-000000000001";
const USER_ENTRY = "40000000-0000-4000-8000-000000000001";
const OTHER_ENTRY = "40000000-0000-4000-8000-000000000002";
const USER_TODO = "50000000-0000-4000-8000-000000000001";
const OTHER_TODO = "50000000-0000-4000-8000-000000000002";
const USER_CHALLENGE = "60000000-0000-4000-8000-000000000001";
const OTHER_CHALLENGE = "60000000-0000-4000-8000-000000000002";
const PUBLIC_CHALLENGE = "60000000-0000-4000-8000-000000000003";
const INVALID_CHALLENGE = "60000000-0000-4000-8000-000000000004";

const db = new PGlite();

async function first(sql) {
  return (await db.query(sql)).rows[0];
}

async function asUser(userId) {
  await db.exec(`
    reset role;
    set request.jwt.claim.role = 'authenticated';
    set request.jwt.claim.sub = '${userId}';
    set role authenticated;
  `);
}

async function asServiceRole() {
  await db.exec(`
    reset role;
    set request.jwt.claim.role = 'service_role';
    set request.jwt.claim.sub = '';
    set role service_role;
  `);
}

try {
  await db.exec(`
    create role anon;
    create role authenticated;
    create role service_role;
    create schema auth;
    create function auth.uid() returns uuid language sql stable as $$
      select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
    $$;
    create function auth.role() returns text language sql stable as $$
      select nullif(current_setting('request.jwt.claim.role', true), '')
    $$;

    create table public.profiles (
      id uuid primary key
    );

    create table public.google_health_account_deletion_guards (
      user_id uuid primary key,
      attempt_id uuid not null unique,
      lease_until timestamptz not null
    );
    create table public.group_members (
      group_id uuid not null,
      user_id uuid not null,
      status text not null default 'active',
      primary key (group_id, user_id)
    );
    create table public.user_snapshots (
      user_id uuid primary key,
      payload jsonb not null,
      revision bigint not null default 0,
      device_id text,
      schema_version integer not null default 27,
      updated_at timestamptz not null default now()
    );
    create table public.messages (
      id uuid primary key default gen_random_uuid(),
      sender_id uuid,
      content text not null
    );
    create table public.group_social_reactions (
      id uuid primary key default gen_random_uuid(),
      target_type text not null,
      target_id text not null,
      user_id uuid not null
    );
    create table public.group_social_comments (
      id uuid primary key default gen_random_uuid(),
      target_type text not null,
      target_id text not null,
      user_id uuid not null,
      content text not null
    );
    create table public.metric_entries (
      id uuid primary key,
      user_id uuid not null,
      note text
    );
    create table public.photo_updates (
      id uuid primary key default gen_random_uuid(),
      owner_user_id uuid not null,
      client_generated_id text,
      caption text not null default ''
    );
    create table public.group_todos (
      id uuid primary key,
      creator_id uuid not null,
      title text not null
    );
    create table public.group_challenges (
      id uuid primary key,
      group_id uuid not null,
      creator_id uuid not null,
      title text,
      audience text not null check (audience in ('group', 'public')),
      participant_ids uuid[] not null,
      accepted_participant_ids uuid[] not null,
      declined_participant_ids uuid[] not null,
      deleted_at timestamptz,
      check (accepted_participant_ids <@ participant_ids),
      check (declined_participant_ids <@ participant_ids),
      check (not (accepted_participant_ids && declined_participant_ids)),
      check (creator_id = any(accepted_participant_ids)),
      check (
        (audience = 'group' and cardinality(participant_ids) >= 2)
        or (audience = 'public' and cardinality(participant_ids) between 1 and 5000)
      )
    );
    create table public.templates (
      id uuid primary key default gen_random_uuid(),
      creator_user_id uuid,
      name text not null
    );
    create table public.push_token_dispatch_acceptances (
      event_key text not null,
      token text not null,
      user_id uuid not null references public.profiles(id) on delete cascade,
      accepted_at timestamptz not null default now(),
      primary key (event_key, user_id, token)
    );
    create table public.user_safety_reports (
      id uuid primary key default gen_random_uuid(),
      reporter_id uuid not null references public.profiles(id) on delete cascade,
      reported_user_id uuid references public.profiles(id) on delete set null,
      reported_display_name text not null,
      message_id uuid,
      message_client_generated_id text,
      report_type text not null check (report_type in ('message', 'comment', 'user')),
      message_excerpt text not null default '',
      details text not null default '',
      status text not null default 'open',
      operator_review_state text not null default 'queued'
        check (operator_review_state in ('queued', 'resolved', 'dismissed')),
      updated_at timestamptz not null default now(),
      check (
        report_type <> 'message'
        or message_client_generated_id is not null
        or reported_user_id is null
      )
    );

    grant usage on schema public, auth to authenticated, service_role;
    grant execute on function auth.uid(), auth.role() to authenticated, service_role;
    grant select, insert, update, delete on all tables in schema public
      to authenticated, service_role;
  `);

  await db.exec(migration);

  const safetyReporterRetentionSchema = await first(`
    select
      not reporter.attnotnull as reporter_nullable,
      reporter_fk.confdeltype = 'n' as reporter_fk_sets_null
    from pg_catalog.pg_attribute reporter
    join pg_catalog.pg_class reports
      on reports.oid = reporter.attrelid
    join pg_catalog.pg_namespace report_schema
      on report_schema.oid = reports.relnamespace
    join pg_catalog.pg_constraint reporter_fk
      on reporter_fk.conrelid = reports.oid
     and reporter_fk.conname = 'user_safety_reports_reporter_id_fkey'
    where report_schema.nspname = 'public'
      and reports.relname = 'user_safety_reports'
      and reporter.attname = 'reporter_id'
  `);
  assert.deepEqual(safetyReporterRetentionSchema, {
    reporter_nullable: true,
    reporter_fk_sets_null: true,
  });

  await db.exec(`
    insert into public.profiles (id) values
      ('${USER}'),
      ('${OTHER}'),
      ('${THIRD}'),
      ('${FORMER}'),
      ('${UNRELATED}');
    insert into public.group_members (group_id, user_id) values
      ('${GROUP}', '${USER}'),
      ('${GROUP}', '${OTHER}'),
      ('${GROUP}', '${THIRD}');
    insert into public.user_snapshots (
      user_id, payload, revision, device_id
    ) values
      (
        '${OTHER}',
        ${`$snapshot$`}{
          "currentUserId": "${OTHER}",
          "group": {
            "id": "${GROUP}",
            "members": [
              {"id": "${OTHER}", "name": "Other"},
              {"id": "${USER}", "name": "User Name"}
            ],
            "pendingMembers": [
              {"id": "${USER}", "name": "Pending User"}
            ]
          },
          "groups": [{
            "id": "${GROUP}",
            "members": [
              {"id": "${OTHER}", "name": "Other"},
              {"id": "${USER}", "name": "User Name"}
            ]
          }],
          "energyProfiles": {
            "${OTHER}": {"weightKg": 75},
            "${USER}": {"weightKg": 90}
          },
          "messages": [
            {"id": "owned", "senderId": "${OTHER}", "body": "keep"},
            {"id": "cached-user", "senderId": "${USER}", "body": "remove"}
          ],
          "settings": {
            "memberNicknames": {"${USER}": "Former friend"},
            "notifications": {
              "memberIds": ["${OTHER}", "${USER}"],
              "mutedConversationIds": [
                "group:${GROUP}",
                "direct:${OTHER}:${USER}"
              ]
            }
          }
        }${`$snapshot$`}::jsonb,
        7,
        'other-device'
      ),
      (
        '${THIRD}',
        ${`$snapshot$`}{
          "currentUserId": "${THIRD}",
          "group": {"id": "${GROUP}", "members": [{"id": "${THIRD}", "name": "Third"}]}
        }${`$snapshot$`}::jsonb,
        3,
        'third-device'
      ),
      (
        '${FORMER}',
        ${`$snapshot$`}{
          "currentUserId": "${FORMER}",
          "groups": [{"id": "former-group", "members": [{"id": "${USER}", "name": "Old User"}]}]
        }${`$snapshot$`}::jsonb,
        2,
        'former-device'
      ),
      (
        '${UNRELATED}',
        ${`$snapshot$`}{"currentUserId": "${UNRELATED}", "groups": []}${`$snapshot$`}::jsonb,
        5,
        'unrelated-device'
      );
    insert into public.metric_entries (id, user_id, note) values
      ('${USER_ENTRY}', '${USER}', 'user shared note'),
      ('${OTHER_ENTRY}', '${OTHER}', 'other note');
    insert into public.photo_updates (owner_user_id, client_generated_id, caption) values
      ('${USER}', 'user-photo', 'user caption'),
      ('${OTHER}', 'other-photo', 'other caption');
    insert into public.group_todos (id, creator_id, title) values
      ('${USER_TODO}', '${USER}', 'user todo'),
      ('${OTHER_TODO}', '${OTHER}', 'other todo');
    insert into public.group_challenges (
      id, group_id, creator_id, title, audience, participant_ids,
      accepted_participant_ids, declined_participant_ids
    ) values
      (
        '${USER_CHALLENGE}', '${GROUP}', '${USER}', 'user challenge', 'group',
        array['${USER}', '${OTHER}']::uuid[],
        array['${USER}', '${OTHER}']::uuid[], array[]::uuid[]
      ),
      (
        '${OTHER_CHALLENGE}', '${GROUP}', '${OTHER}', 'surviving group challenge', 'group',
        array['${OTHER}', '${THIRD}', '${USER}']::uuid[],
        array['${OTHER}', '${USER}']::uuid[], array['${THIRD}']::uuid[]
      ),
      (
        '${PUBLIC_CHALLENGE}', '${GROUP}', '${OTHER}', 'surviving public challenge', 'public',
        array['${OTHER}', '${USER}']::uuid[],
        array['${OTHER}', '${USER}']::uuid[], array[]::uuid[]
      ),
      (
        '${INVALID_CHALLENGE}', '${GROUP}', '${OTHER}', 'invalid after deletion', 'group',
        array['${OTHER}', '${USER}']::uuid[],
        array['${OTHER}']::uuid[], array['${USER}']::uuid[]
      );
    insert into public.templates (creator_user_id, name) values
      ('${USER}', 'user public template'),
      ('${OTHER}', 'other template');
    insert into public.messages (sender_id, content) values
      ('${USER}', 'user message'),
      ('${OTHER}', 'other message');
    insert into public.group_social_reactions (target_type, target_id, user_id) values
      ('recap_feed', 'leader:2026-09-04', '${USER}'),
      ('metric_entry', '${USER_ENTRY}', '${OTHER}'),
      ('recap_feed', 'leader:${USER}:2026-09-04', '${OTHER}'),
      ('group_challenge', '${INVALID_CHALLENGE}:2026-09-04', '${OTHER}'),
      ('metric_entry', '${OTHER_ENTRY}', '${OTHER}');
    insert into public.group_social_comments (target_type, target_id, user_id, content) values
      ('recap_feed', 'leader:2026-09-04', '${USER}', 'user comment'),
      ('group_todo', '${USER_TODO}', '${OTHER}', 'comment on user todo'),
      ('recap_feed', 'leader:${USER}:2026-09-04', '${OTHER}', 'comment on user recap'),
      ('group_challenge', '${USER_CHALLENGE}:2026-09-04', '${OTHER}', 'comment on user challenge'),
      ('group_todo', '${OTHER_TODO}', '${OTHER}', 'other comment');
    insert into public.push_token_dispatch_acceptances (
      event_key, token, user_id
    ) values
      ('event-user', 'ExpoPushToken[user]', '${USER}'),
      ('event-other', 'ExpoPushToken[other]', '${OTHER}'),
      ('event-reused', 'ExpoPushToken[reused]', '${USER}'),
      ('event-reused', 'ExpoPushToken[reused]', '${OTHER}');
    insert into public.user_safety_reports (
      reporter_id, reported_user_id, reported_display_name,
      message_client_generated_id, report_type, message_excerpt, details,
      operator_review_state
    ) values
      ('${USER}', '${OTHER}', 'Other', 'other-message', 'message', 'other message', 'user report', 'queued'),
      ('${USER}', '${THIRD}', 'Third', 'third-message', 'message', 'third message', 'resolved user report', 'resolved'),
      ('${OTHER}', '${USER}', 'User Name', 'user-message', 'message', 'user message', 'other report', 'queued'),
      ('${OTHER}', null, 'Already deleted', null, 'user', '', 'unrelated report', 'queued');
    insert into public.google_health_account_deletion_guards (
      user_id, attempt_id, lease_until
    ) values ('${USER}', '${ATTEMPT}', now() + interval '10 minutes');
  `);

  const privileges = await first(`
    select
      has_function_privilege(
        'authenticated',
        'public.purge_account_authored_shared_content(uuid,uuid)',
        'execute'
      ) as authenticated_purge,
      has_function_privilege(
        'service_role',
        'public.purge_account_authored_shared_content(uuid,uuid)',
        'execute'
      ) as service_purge
  `);
  assert.deepEqual(privileges, {
    authenticated_purge: false,
    service_purge: true,
  });

  await asServiceRole();
  await assert.rejects(
    () =>
      db.query(`
        select public.purge_account_authored_shared_content(
          '${USER}', '${WRONG_ATTEMPT}'
        )
      `),
    /habhub_account_deletion_attempt_lost/,
    "a non-owner attempt must fail before deleting any content",
  );
  assert.equal(
    Number((await first(`select count(*)::integer as count from public.messages`)).count),
    2,
  );
  assert.equal(
    Number(
      (
        await first(`
          select count(*)::integer as count
          from public.push_token_dispatch_acceptances
        `)
      ).count,
    ),
    4,
    "a rejected deletion attempt must preserve every owned dispatch checkpoint",
  );

  await asUser(USER);
  await assert.rejects(
    () =>
      db.exec(`
        insert into public.messages (sender_id, content)
        values ('${USER}', 'racing message')
      `),
    /habhub_account_deleting/,
  );
  await assert.rejects(
    () =>
      db.exec(`
        insert into public.templates (creator_user_id, name)
        values ('${USER}', 'racing template')
      `),
    /habhub_account_deleting/,
  );

  await asUser(OTHER);
  await db.exec(`
    insert into public.messages (sender_id, content)
    values ('${OTHER}', 'allowed other message')
  `);
  await assert.rejects(
    () =>
      db.exec(`
        insert into public.messages (sender_id, content)
        values ('${USER}', 'privileged attribution race')
      `),
    /habhub_account_deleting/,
    "the trigger must fence the attributed identity, not only auth.uid()",
  );
  await assert.rejects(
    () =>
      db.exec(`
        update public.user_snapshots
        set payload = payload || jsonb_build_object('racingMemberId', '${USER}')
        where user_id = '${OTHER}'
      `),
    /habhub_account_deleting/,
    "a concurrent co-member snapshot must not restore a guarded account identifier",
  );

  await asServiceRole();
  const result = (
    await first(`
      select public.purge_account_authored_shared_content(
        '${USER}', '${ATTEMPT}'
      ) as result
    `)
  ).result;
  assert.deepEqual(result, {
    socialReactions: 4,
    socialComments: 4,
    safetyReportsFiled: 1,
    safetyReportsFiledRetained: 1,
    safetyReportsRedacted: 1,
    messages: 1,
    metricEntries: 1,
    photoUpdates: 1,
    groupTodos: 1,
    groupChallenges: 1,
    groupChallengeMembershipsScrubbed: 2,
    groupChallengesInvalidated: 1,
    templates: 1,
    pushDispatchAcceptances: 2,
    snapshotReferencesScrubbed: 3,
  });

  const remaining = await first(`
    select
      (select count(*)::integer from public.group_social_reactions) as reactions,
      (select count(*)::integer from public.group_social_comments) as comments,
      (select count(*)::integer from public.messages) as messages,
      (select count(*)::integer from public.metric_entries) as entries,
      (select count(*)::integer from public.photo_updates) as photos,
      (select count(*)::integer from public.group_todos) as todos,
      (select count(*)::integer from public.group_challenges) as challenges,
      (select count(*)::integer from public.templates) as templates,
      (select count(*)::integer from public.push_token_dispatch_acceptances) as push_acceptances,
      (select count(*)::integer
         from public.push_token_dispatch_acceptances
        where user_id = '${USER}') as deleting_user_push_acceptances,
      (select count(*)::integer
         from public.push_token_dispatch_acceptances
        where user_id = '${OTHER}') as other_user_push_acceptances,
      (select count(*)::integer from public.user_safety_reports) as reports
  `);
  assert.deepEqual(remaining, {
    reactions: 1,
    comments: 1,
    messages: 2,
    entries: 1,
    photos: 1,
    todos: 1,
    challenges: 2,
    templates: 1,
    push_acceptances: 2,
    deleting_user_push_acceptances: 0,
    other_user_push_acceptances: 2,
    reports: 3,
  });

  const challengeResidue = await first(`
    select
      count(*)::integer as surviving,
      count(*) filter (
        where '${USER}' = any(participant_ids)
           or '${USER}' = any(accepted_participant_ids)
           or '${USER}' = any(declined_participant_ids)
      )::integer as containing_deleted_user,
      count(*) filter (
        where id = '${INVALID_CHALLENGE}'
      )::integer as invalid_survivors,
      count(*) filter (
        where id = '${OTHER_CHALLENGE}'
          and participant_ids = array['${OTHER}', '${THIRD}']::uuid[]
          and accepted_participant_ids = array['${OTHER}']::uuid[]
          and declined_participant_ids = array['${THIRD}']::uuid[]
          and deleted_at is null
      )::integer as cleaned_group_survivors,
      count(*) filter (
        where id = '${PUBLIC_CHALLENGE}'
          and participant_ids = array['${OTHER}']::uuid[]
          and accepted_participant_ids = array['${OTHER}']::uuid[]
          and declined_participant_ids = array[]::uuid[]
          and deleted_at is null
      )::integer as cleaned_public_survivors
    from public.group_challenges
  `);
  assert.deepEqual(challengeResidue, {
    surviving: 2,
    containing_deleted_user: 0,
    invalid_survivors: 0,
    cleaned_group_survivors: 1,
    cleaned_public_survivors: 1,
  });

  await asUser(OTHER);
  await assert.rejects(
    () =>
      db.exec(`
        update public.group_challenges
        set participant_ids = participant_ids || array['${USER}']::uuid[],
            accepted_participant_ids = accepted_participant_ids || array['${USER}']::uuid[]
        where id = '${PUBLIC_CHALLENGE}'
      `),
    /habhub_account_deleting/,
    "an in-flight challenge response must not restore a guarded account after roster cleanup",
  );
  await asServiceRole();

  const snapshotResidue = await first(`
    select
      count(*) filter (
        where user_id <> '${USER}'
          and strpos(payload::text, '${USER}') > 0
      )::integer as containing_deleted_user,
      count(*) filter (
        where user_id = '${OTHER}'
          and revision = 8
          and device_id is null
          and jsonb_array_length(payload -> 'group' -> 'members') = 1
          and jsonb_array_length(payload -> 'group' -> 'pendingMembers') = 0
          and jsonb_array_length(payload -> 'messages') = 1
          and payload -> 'energyProfiles' ? '${OTHER}'
          and not (payload -> 'energyProfiles' ? '${USER}')
      )::integer as deeply_cleaned,
      count(*) filter (
        where user_id = '${THIRD}' and revision = 4 and device_id is null
      )::integer as clean_comember_fenced,
      count(*) filter (
        where user_id = '${FORMER}' and revision = 3 and device_id is null
      )::integer as former_member_cleaned,
      count(*) filter (
        where user_id = '${UNRELATED}'
          and revision = 5
          and device_id = 'unrelated-device'
      )::integer as unrelated_untouched
    from public.user_snapshots
  `);
  assert.deepEqual(snapshotResidue, {
    containing_deleted_user: 0,
    deeply_cleaned: 1,
    clean_comember_fenced: 1,
    former_member_cleaned: 1,
    unrelated_untouched: 1,
  });

  const redacted = await first(`
    select reported_user_id, reported_display_name, message_id,
           message_client_generated_id, message_excerpt, details, status
    from public.user_safety_reports
    where details = 'other report'
  `);
  assert.deepEqual(redacted, {
    reported_user_id: null,
    reported_display_name: "Deleted member",
    message_id: null,
    message_client_generated_id: null,
    message_excerpt: "",
    details: "other report",
    status: "open",
  });

  const retainedFiledReport = await first(`
    select reporter_id, reported_user_id, reported_display_name,
           message_client_generated_id, message_excerpt, details, status,
           operator_review_state
    from public.user_safety_reports
    where details = 'user report'
  `);
  assert.deepEqual(retainedFiledReport, {
    reporter_id: null,
    reported_user_id: OTHER,
    reported_display_name: "Other",
    message_client_generated_id: "other-message",
    message_excerpt: "other message",
    details: "user report",
    status: "open",
    operator_review_state: "queued",
  });
  assert.equal(
    Number(
      (
        await first(`
          select count(*)::integer as count
          from public.user_safety_reports
          where details = 'resolved user report'
        `)
      ).count,
    ),
    0,
    "a deleting reporter's already-reviewed report should follow normal authored-content deletion",
  );

  await asUser(USER);
  await assert.rejects(
    () =>
      db.exec(`
        insert into public.group_social_comments (
          target_type, target_id, user_id, content
        ) values ('recap_feed', 'leader:2026-09-05', '${USER}', 'after purge')
      `),
    /habhub_account_deleting/,
    "the guard must continue fencing writes until auth deletion cascades it",
  );

  console.log(
    "Account deletion PostgreSQL validation passed: lease ownership, atomic purge, snapshot/challenge identity cleanup, queued safety evidence retention, subject redaction, privileges, and write fencing are covered.",
  );
} finally {
  await db.close();
}
