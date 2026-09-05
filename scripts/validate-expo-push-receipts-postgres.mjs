import assert from "node:assert/strict";
import { PGlite } from "npm:@electric-sql/pglite@0.3.10";

const root = new URL("../", import.meta.url);
const migration = await Deno.readTextFile(
  new URL(
    "supabase/migrations/202609040001_expo_push_receipts.sql",
    root,
  ),
);

const db = new PGlite();

async function scalar(sql) {
  return (await db.query(sql)).rows[0];
}

try {
  await db.exec(`
    create role anon;
    create role authenticated;
    create role service_role;
    create schema vault;
    create schema net;
    create schema cron;

    create table public.profiles (
      id uuid primary key
    );
    create table public.groups (
      id uuid primary key
    );
    create table public.messages (
      group_id uuid not null references public.groups(id) on delete cascade,
      sender_id uuid not null references public.profiles(id) on delete cascade,
      client_generated_id text not null,
      push_dispatched_at timestamptz,
      primary key (sender_id, client_generated_id)
    );
    create table public.push_events (
      event_key text primary key,
      sender_id uuid not null references public.profiles(id) on delete cascade,
      created_at timestamptz not null default clock_timestamp()
    );
    create table public.push_dispatch_events (
      id uuid primary key,
      event_key text not null unique,
      group_id uuid not null references public.groups(id) on delete cascade,
      dispatcher_id uuid not null references public.profiles(id) on delete cascade,
      category text not null check (
        category in ('metric', 'lead', 'winner', 'membership', 'challenge')
      ),
      event_type text not null,
      audience text not null,
      recipient_id uuid references public.profiles(id) on delete cascade,
      metric_slug text,
      title text not null,
      body text not null,
      data jsonb not null default '{}'::jsonb,
      created_at timestamptz not null default clock_timestamp(),
      expires_at timestamptz not null,
      dispatched_at timestamptz,
      attempt_count integer not null default 0,
      last_error text
    );
    create table public.device_push_tokens (
      token text primary key,
      user_id uuid not null references public.profiles(id) on delete cascade,
      updated_at timestamptz not null default clock_timestamp()
    );
    create table public.web_push_subscriptions (
      endpoint text primary key,
      user_id uuid not null references public.profiles(id) on delete cascade,
      p256dh text not null,
      auth text not null,
      updated_at timestamptz not null default clock_timestamp()
    );
    create table public.push_token_dispatch_acceptances (
      event_key text not null,
      token text not null,
      accepted_at timestamptz not null default clock_timestamp(),
      primary key (event_key, token)
    );
    create table vault.decrypted_secrets (
      name text not null,
      decrypted_secret text,
      created_at timestamptz not null default clock_timestamp()
    );
    create table net.http_calls (
      url text not null,
      headers jsonb not null,
      body jsonb not null
    );
    create function net.http_post(
      url text,
      headers jsonb,
      body jsonb,
      timeout_milliseconds integer
    ) returns bigint language plpgsql as $$
    begin
      insert into net.http_calls values (url, headers, body);
      return 1;
    end;
    $$;
    create table cron.job (
      jobid bigint generated always as identity primary key,
      jobname text not null unique,
      schedule text not null,
      command text not null
    );
    create function cron.unschedule(p_jobid bigint)
    returns boolean language plpgsql as $$
    begin
      delete from cron.job where jobid = p_jobid;
      return found;
    end;
    $$;
    create function cron.schedule(p_name text, p_schedule text, p_command text)
    returns bigint language plpgsql as $$
    declare v_id bigint;
    begin
      insert into cron.job (jobname, schedule, command)
      values (p_name, p_schedule, p_command)
      returning jobid into v_id;
      return v_id;
    end;
    $$;
    insert into public.profiles (id) values
      ('10000000-0000-4000-8000-000000000001'),
      ('10000000-0000-4000-8000-000000000002');
    insert into public.groups (id) values
      ('20000000-0000-4000-8000-000000000001');
    insert into public.device_push_tokens (token, user_id, updated_at) values
      (
        'ExpoPushToken[legacy-owner]',
        '10000000-0000-4000-8000-000000000001',
        '2026-09-04T08:00:00Z'
      ),
      (
        'ExpoPushToken[legacy-reassigned]',
        '10000000-0000-4000-8000-000000000002',
        '2026-09-04T08:02:00Z'
      ),
      (
        'https://push.example/legacy-ambiguous',
        '10000000-0000-4000-8000-000000000001',
        '2026-09-04T08:00:00Z'
      );
    insert into public.web_push_subscriptions (
      endpoint, user_id, p256dh, auth, updated_at
    ) values
      (
        'https://push.example/legacy-owner',
        '10000000-0000-4000-8000-000000000002',
        'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
        'legacyA1',
        '2026-09-04T08:00:00Z'
      ),
      (
        'https://push.example/legacy-ambiguous',
        '10000000-0000-4000-8000-000000000002',
        'BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB',
        'legacyB2',
        '2026-09-04T08:00:00Z'
      );
    insert into public.push_token_dispatch_acceptances (
      event_key, token, accepted_at
    ) values
      ('legacy-device', 'ExpoPushToken[legacy-owner]', '2026-09-04T08:01:00Z'),
      ('legacy-web', 'https://push.example/legacy-owner', '2026-09-04T08:01:00Z'),
      ('legacy-reassigned', 'ExpoPushToken[legacy-reassigned]', '2026-09-04T08:01:00Z'),
      ('legacy-ambiguous', 'https://push.example/legacy-ambiguous', '2026-09-04T08:01:00Z'),
      ('legacy-orphan', 'ExpoPushToken[orphan]', '2026-09-04T08:01:00Z');
  `);

  await db.exec(migration);

  const acceptanceColumn = await scalar(`
    select is_nullable
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'push_token_dispatch_acceptances'
      and column_name = 'user_id'
  `);
  assert.equal(
    acceptanceColumn.is_nullable,
    "NO",
    "dispatch acceptance ownership must be mandatory after backfill",
  );
  const acceptancePrimaryKey = await scalar(`
    select pg_get_constraintdef(oid) as definition
    from pg_constraint
    where conrelid = 'public.push_token_dispatch_acceptances'::regclass
      and contype = 'p'
  `);
  assert.match(
    acceptancePrimaryKey.definition,
    /PRIMARY KEY \(event_key, user_id, token\)/i,
  );
  const acceptanceOwnerForeignKey = await scalar(`
    select pg_get_constraintdef(oid) as definition
    from pg_constraint
    where conrelid = 'public.push_token_dispatch_acceptances'::regclass
      and contype = 'f'
      and conname = 'push_token_dispatch_acceptances_user_id_fkey'
  `);
  assert.match(
    acceptanceOwnerForeignKey.definition,
    /FOREIGN KEY \(user_id\) REFERENCES profiles\(id\) ON DELETE CASCADE/i,
  );
  const acceptanceOwnerIndex = await scalar(`
    select indexdef
    from pg_indexes
    where schemaname = 'public'
      and indexname = 'push_token_dispatch_acceptances_user_retention_idx'
  `);
  assert.match(
    acceptanceOwnerIndex.indexdef,
    /\(user_id, accepted_at\)/i,
  );
  const receiptRegistrationVersionColumn = await scalar(`
    select is_nullable, data_type
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'expo_push_receipts'
      and column_name = 'registration_updated_at'
  `);
  assert.deepEqual(receiptRegistrationVersionColumn, {
    is_nullable: "NO",
    data_type: "timestamp with time zone",
  });
  const receiptActionColumns = (
    await db.query(`
      select column_name, is_nullable, column_default
      from information_schema.columns
      where table_schema = 'public'
        and table_name = 'expo_push_receipts'
        and column_name in ('delivery_action', 'action_attempt_count')
      order by column_name
    `)
  ).rows;
  assert.deepEqual(
    receiptActionColumns.map((row) => ({
      column_name: row.column_name,
      is_nullable: row.is_nullable,
    })),
    [
      { column_name: "action_attempt_count", is_nullable: "NO" },
      { column_name: "delivery_action", is_nullable: "NO" },
    ],
  );
  await db.exec(`
    insert into public.push_dispatch_events (
      id, event_key, group_id, dispatcher_id, category, event_type, audience,
      title, body, expires_at
    ) values (
      '30000000-0000-4000-8000-000000000099',
      'message:category-upgrade',
      '20000000-0000-4000-8000-000000000001',
      '10000000-0000-4000-8000-000000000001',
      'chat', 'group_message', 'group', 'Chat', 'Message',
      clock_timestamp() + interval '1 day'
    );
    delete from public.push_dispatch_events
    where event_key = 'message:category-upgrade';
  `);
  assert.deepEqual(
    (
      await db.query(`
        select event_key, token, user_id::text as user_id
        from public.push_token_dispatch_acceptances
        order by event_key
      `)
    ).rows,
    [
      {
        event_key: "legacy-device",
        token: "ExpoPushToken[legacy-owner]",
        user_id: "10000000-0000-4000-8000-000000000001",
      },
      {
        event_key: "legacy-web",
        token: "https://push.example/legacy-owner",
        user_id: "10000000-0000-4000-8000-000000000002",
      },
    ],
    "legacy checkpoints must inherit only a sole non-newer owner; ambiguous, orphaned, and post-checkpoint registrations are removed",
  );
  await assert.rejects(
    () =>
      db.exec(`
        insert into public.push_token_dispatch_acceptances (event_key, token)
        values ('missing-owner', 'ExpoPushToken[missing-owner]')
      `),
    /null value in column "user_id"/i,
  );
  await db.exec(`
    delete from public.push_token_dispatch_acceptances
    where event_key like 'legacy-%';
    delete from public.device_push_tokens
    where token in (
      'ExpoPushToken[legacy-owner]',
      'ExpoPushToken[legacy-reassigned]',
      'https://push.example/legacy-ambiguous'
    );
    delete from public.web_push_subscriptions
    where endpoint in (
      'https://push.example/legacy-owner',
      'https://push.example/legacy-ambiguous'
    );
  `);

  const rls = await scalar(`
    select relrowsecurity as enabled
      from pg_catalog.pg_class
     where oid = 'public.expo_push_receipts'::regclass
  `);
  assert.equal(rls.enabled, true, "receipt queue RLS must be enabled");
  const acl = await scalar(`
    select
      has_table_privilege('anon', 'public.expo_push_receipts', 'select') as anon_read,
      has_table_privilege('authenticated', 'public.expo_push_receipts', 'select') as user_read,
      has_table_privilege('service_role', 'public.expo_push_receipts', 'select') as service_read,
      has_function_privilege(
        'authenticated',
        'public.claim_due_expo_push_receipts(integer,uuid)',
        'execute'
      ) as user_claim,
      has_function_privilege(
        'service_role',
        'public.claim_due_expo_push_receipts(integer,uuid)',
        'execute'
      ) as service_claim,
      has_function_privilege(
        'authenticated',
        'public.record_expo_push_ticket_acceptances(text,jsonb)',
        'execute'
      ) as user_record,
      has_function_privilege(
        'service_role',
        'public.record_expo_push_ticket_acceptances(text,jsonb)',
        'execute'
      ) as service_record,
      has_function_privilege(
        'authenticated',
        'public.settle_expo_push_receipts(uuid,jsonb)',
        'execute'
      ) as user_settle,
      has_function_privilege(
        'service_role',
        'public.settle_expo_push_receipts(uuid,jsonb)',
        'execute'
      ) as service_settle,
      has_function_privilege(
        'authenticated',
        'public.delete_exact_stale_push_registrations(text,jsonb)',
        'execute'
      ) as user_delete_stale,
      has_function_privilege(
        'service_role',
        'public.delete_exact_stale_push_registrations(text,jsonb)',
        'execute'
      ) as service_delete_stale
  `);
  assert.deepEqual(acl, {
    anon_read: false,
    user_read: false,
    service_read: true,
    user_claim: false,
    service_claim: true,
    user_record: false,
    service_record: true,
    user_settle: false,
    service_settle: true,
    user_delete_stale: false,
    service_delete_stale: true,
  });

  await db.exec(`
    insert into public.device_push_tokens (token, user_id, updated_at) values
      (
        'ExpoPushToken[exact-stale]',
        '10000000-0000-4000-8000-000000000001',
        '2026-09-04T09:00:00.123456Z'
      ),
      (
        'ExpoPushToken[refreshed]',
        '10000000-0000-4000-8000-000000000001',
        '2026-09-04T09:01:00.123456Z'
      ),
      (
        'ExpoPushToken[reassigned]',
        '10000000-0000-4000-8000-000000000002',
        '2026-09-04T09:01:00.123456Z'
      ),
      (
        'ExpoPushToken[atomic-rollback]',
        '10000000-0000-4000-8000-000000000001',
        '2026-09-04T09:00:00.123456Z'
      );
    insert into public.web_push_subscriptions (
      endpoint, user_id, p256dh, auth, updated_at
    ) values
      (
        'https://push.example/exact-stale',
        '10000000-0000-4000-8000-000000000001',
        'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
        'exactA12',
        '2026-09-04T09:00:00.123456Z'
      ),
      (
        'https://push.example/key-refreshed',
        '10000000-0000-4000-8000-000000000001',
        'BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB',
        'newKey12',
        '2026-09-04T09:00:00.123456Z'
      ),
      (
        'https://push.example/reassigned',
        '10000000-0000-4000-8000-000000000002',
        'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
        'exactA12',
        '2026-09-04T09:01:00.123456Z'
      );
  `);
  const exactCleanup = await scalar(`
    select public.delete_exact_stale_push_registrations(
      'event-exact-stale',
      '[
        {
          "kind":"expo",
          "userId":"10000000-0000-4000-8000-000000000001",
          "token":"ExpoPushToken[exact-stale]",
          "updatedAt":"2026-09-04T09:00:00.123456Z"
        },
        {
          "kind":"web",
          "userId":"10000000-0000-4000-8000-000000000001",
          "endpoint":"https://push.example/exact-stale",
          "p256dh":"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
          "auth":"exactA12",
          "updatedAt":"2026-09-04T09:00:00.123456Z"
        }
      ]'::jsonb
    ) as result
  `);
  assert.deepEqual(exactCleanup.result, {
    deviceTokens: 1,
    webSubscriptions: 1,
    changedRegistrations: 0,
  });
  assert.equal(
    Number(
      (
        await scalar(`
          select count(*)::integer as count
          from public.push_token_dispatch_acceptances
          where event_key = 'event-exact-stale'
        `)
      ).count,
    ),
    2,
    "an exact stale delete and its per-owner checkpoints must commit together",
  );

  const racedCleanup = await scalar(`
    select public.delete_exact_stale_push_registrations(
      'event-raced-stale',
      '[
        {
          "kind":"expo",
          "userId":"10000000-0000-4000-8000-000000000001",
          "token":"ExpoPushToken[refreshed]",
          "updatedAt":"2026-09-04T09:00:00.123456Z"
        },
        {
          "kind":"expo",
          "userId":"10000000-0000-4000-8000-000000000001",
          "token":"ExpoPushToken[reassigned]",
          "updatedAt":"2026-09-04T09:00:00.123456Z"
        },
        {
          "kind":"web",
          "userId":"10000000-0000-4000-8000-000000000001",
          "endpoint":"https://push.example/key-refreshed",
          "p256dh":"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
          "auth":"exactA12",
          "updatedAt":"2026-09-04T09:00:00.123456Z"
        },
        {
          "kind":"web",
          "userId":"10000000-0000-4000-8000-000000000001",
          "endpoint":"https://push.example/reassigned",
          "p256dh":"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
          "auth":"exactA12",
          "updatedAt":"2026-09-04T09:00:00.123456Z"
        }
      ]'::jsonb
    ) as result
  `);
  assert.deepEqual(racedCleanup.result, {
    deviceTokens: 0,
    webSubscriptions: 0,
    changedRegistrations: 4,
  });
  assert.equal(
    Number(
      (
        await scalar(`
          select count(*)::integer as count
          from public.push_token_dispatch_acceptances
          where event_key = 'event-raced-stale'
        `)
      ).count,
    ),
    0,
    "refreshed, reassigned, or re-keyed registrations must survive without a suppressing checkpoint",
  );
  const missingCleanup = await scalar(`
    select public.delete_exact_stale_push_registrations(
      'event-missing-stale',
      '[
        {
          "kind":"expo",
          "userId":"10000000-0000-4000-8000-000000000001",
          "token":"ExpoPushToken[already-gone]",
          "updatedAt":"2026-09-04T09:00:00.123456Z"
        },
        {
          "kind":"web",
          "userId":"10000000-0000-4000-8000-000000000001",
          "endpoint":"https://push.example/already-gone",
          "p256dh":"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
          "auth":"exactA12",
          "updatedAt":"2026-09-04T09:00:00.123456Z"
        }
      ]'::jsonb
    ) as result
  `);
  assert.deepEqual(
    missingCleanup.result,
    {
      deviceTokens: 0,
      webSubscriptions: 0,
      changedRegistrations: 0,
    },
    "an already-removed registration is complete, not a refresh race",
  );
  assert.equal(
    Number(
      (
        await scalar(`
          select count(*)::integer as count
          from public.push_token_dispatch_acceptances
          where event_key = 'event-missing-stale'
        `)
      ).count,
    ),
    0,
    "an already-removed registration needs no stale-delivery checkpoint",
  );
  await assert.rejects(
    () =>
      db.exec(`
        select public.delete_exact_stale_push_registrations(
          'event-atomic-rollback',
          '[
            {
              "kind":"expo",
              "userId":"10000000-0000-4000-8000-000000000001",
              "token":"ExpoPushToken[atomic-rollback]",
              "updatedAt":"2026-09-04T09:00:00.123456Z"
            },
            {"kind":"invalid","userId":"10000000-0000-4000-8000-000000000001","updatedAt":"2026-09-04T09:00:00.123456Z"}
          ]'::jsonb
        )
      `),
    /kind is invalid/i,
  );
  assert.deepEqual(
    await scalar(`
      select
        (select count(*)::integer from public.device_push_tokens
          where token = 'ExpoPushToken[atomic-rollback]') as registrations,
        (select count(*)::integer from public.push_token_dispatch_acceptances
          where event_key = 'event-atomic-rollback') as acceptances
    `),
    { registrations: 1, acceptances: 0 },
    "a cleanup failure must roll back both the exact delete and its checkpoint",
  );
  await db.exec(`
    delete from public.push_token_dispatch_acceptances
    where event_key in (
      'event-exact-stale',
      'event-raced-stale',
      'event-missing-stale'
    );
    delete from public.device_push_tokens
    where token in (
      'ExpoPushToken[refreshed]',
      'ExpoPushToken[reassigned]',
      'ExpoPushToken[atomic-rollback]'
    );
    delete from public.web_push_subscriptions
    where endpoint in (
      'https://push.example/key-refreshed',
      'https://push.example/reassigned'
    );
  `);

  const recorded = await scalar(`
    select public.record_expo_push_ticket_acceptances(
      'event-a',
      '[
        {"ticketId":"ticket-a","userId":"10000000-0000-4000-8000-000000000001","token":"ExpoPushToken[token-a]","updatedAt":"2026-09-04T10:00:00Z"},
        {"ticketId":"ticket-b","userId":"10000000-0000-4000-8000-000000000001","token":"ExpoPushToken[token-b]","updatedAt":"2026-09-04T10:00:00Z"}
      ]'::jsonb
    ) as count
  `);
  assert.equal(Number(recorded.count), 2);
  const atomicCounts = await scalar(`
    select
      (select count(*)::integer from public.expo_push_receipts) as receipts,
      (select count(*)::integer from public.push_token_dispatch_acceptances) as acceptances,
      (select min(extract(epoch from (next_attempt_at - accepted_at)))::integer
         from public.expo_push_receipts) as first_delay,
      (select min(extract(epoch from (expires_at - accepted_at)))::integer
         from public.expo_push_receipts) as expiry
  `);
  assert.deepEqual(atomicCounts, {
    receipts: 2,
    acceptances: 2,
    first_delay: 15 * 60,
    expiry: 24 * 60 * 60,
  });
  const ticketAIdentityBefore = await scalar(`
    select receipt.accepted_at as receipt_accepted_at,
      acceptance.accepted_at as checkpoint_accepted_at
    from public.expo_push_receipts receipt
    join public.push_token_dispatch_acceptances acceptance
      on acceptance.event_key = receipt.event_key
     and acceptance.user_id = receipt.user_id
     and acceptance.token = receipt.token
    where receipt.ticket_id = 'ticket-a'
  `);
  await db.exec(`
    select public.record_expo_push_ticket_acceptances(
      'event-a',
      '[{"ticketId":"ticket-a","userId":"10000000-0000-4000-8000-000000000001","token":"ExpoPushToken[token-a]","updatedAt":"2026-09-04T10:00:00Z"}]'::jsonb
    );
  `);
  const ticketAIdentityAfter = await scalar(`
    select receipt.accepted_at as receipt_accepted_at,
      acceptance.accepted_at as checkpoint_accepted_at
    from public.expo_push_receipts receipt
    join public.push_token_dispatch_acceptances acceptance
      on acceptance.event_key = receipt.event_key
     and acceptance.user_id = receipt.user_id
     and acceptance.token = receipt.token
    where receipt.ticket_id = 'ticket-a'
  `);
  assert.deepEqual(
    ticketAIdentityAfter,
    ticketAIdentityBefore,
    "an ambiguous retry of the same ticket must not supersede its own acceptance timestamp",
  );

  await assert.rejects(
    () =>
      db.exec(`
        select public.record_expo_push_ticket_acceptances(
          'event-rollback',
          '[
            {"ticketId":"ticket-rollback","userId":"10000000-0000-4000-8000-000000000001","token":"ExpoPushToken[token-r1]","updatedAt":"2026-09-04T10:00:00Z"},
            {"ticketId":"ticket-rollback","userId":"10000000-0000-4000-8000-000000000001","token":"ExpoPushToken[token-r2]","updatedAt":"2026-09-04T10:00:00Z"}
          ]'::jsonb
        )
      `),
    /invalid or duplicated/i,
  );
  const rollbackCounts = await scalar(`
    select
      count(*) filter (where event_key = 'event-rollback')::integer as receipts,
      (select count(*)::integer
         from public.push_token_dispatch_acceptances
        where event_key = 'event-rollback') as acceptances
      from public.expo_push_receipts
  `);
  assert.deepEqual(
    rollbackCounts,
    { receipts: 0, acceptances: 0 },
    "ticket and acceptance writes must roll back together",
  );

  const beforeDue = await db.query(`
    select * from public.claim_due_expo_push_receipts(
      1000,
      '00000000-0000-4000-8000-000000000001'
    )
  `);
  assert.equal(beforeDue.rows.length, 0, "receipts must wait fifteen minutes");

  await db.exec(`
    insert into public.device_push_tokens (token, user_id, updated_at) values
      ('ExpoPushToken[token-a]', '10000000-0000-4000-8000-000000000001', '2026-09-04T10:00:00Z'),
      ('ExpoPushToken[token-b]', '10000000-0000-4000-8000-000000000001', '2026-09-04T10:00:00Z');
    update public.expo_push_receipts
       set next_attempt_at = accepted_at;
  `);
  const claimed = await db.query(`
    select * from public.claim_due_expo_push_receipts(
      1000,
      '00000000-0000-4000-8000-000000000002'
    )
    order by ticket_id
  `);
  assert.equal(claimed.rows.length, 2);
  assert.deepEqual(
    Object.keys(claimed.rows[0]).sort(),
    [
      "action_attempt_count",
      "attempt_count",
      "delivery_action",
      "event_key",
      "ticket_id",
    ],
    "the service-only claim may expose canonical event identity/action but never recipient tokens or registration data",
  );
  assert.deepEqual(
    claimed.rows.map((row) => Number(row.attempt_count)),
    [1, 1],
  );
  const settled = await scalar(`
    select public.settle_expo_push_receipts(
      '00000000-0000-4000-8000-000000000002',
      '[
        {"ticketId":"ticket-a","status":"provider_accepted"},
        {
          "ticketId":"ticket-b",
          "status":"terminal_error",
          "errorCode":"DeviceNotRegistered",
          "errorMessage":"Device is no longer registered"
        }
      ]'::jsonb
    ) as result
  `);
  assert.deepEqual(settled.result, {
    settled: 2,
    retried: 0,
    invalidatedTokens: 1,
    resendQueued: 0,
    resendCompleted: 0,
  });
  const terminalState = await db.query(`
    select ticket_id, receipt_status, lease_owner, terminal_at is not null as terminal
      from public.expo_push_receipts
     order by ticket_id
  `);
  assert.deepEqual(terminalState.rows, [
    {
      ticket_id: "ticket-a",
      receipt_status: "provider_accepted",
      lease_owner: null,
      terminal: true,
    },
    {
      ticket_id: "ticket-b",
      receipt_status: "terminal_error",
      lease_owner: null,
      terminal: true,
    },
  ]);
  assert.deepEqual(
    (await db.query("select token from public.device_push_tokens order by token")).rows,
    [{ token: "ExpoPushToken[token-a]" }],
    "DeviceNotRegistered must remove only the failed token",
  );

  await db.exec(`
    select public.record_expo_push_ticket_acceptances(
      'event-c',
      '[
        {"ticketId":"ticket-c","userId":"10000000-0000-4000-8000-000000000001","token":"ExpoPushToken[token-c]","updatedAt":"2026-09-04T10:00:00Z"},
        {"ticketId":"ticket-d","userId":"10000000-0000-4000-8000-000000000001","token":"ExpoPushToken[token-d]","updatedAt":"2026-09-04T10:00:00Z"}
      ]'::jsonb
    );
    update public.expo_push_receipts
       set next_attempt_at = accepted_at
     where ticket_id in ('ticket-c', 'ticket-d');
    select * from public.claim_due_expo_push_receipts(
      1000,
      '00000000-0000-4000-8000-000000000003'
    );
  `);
  await assert.rejects(
    () =>
      db.exec(`
        select public.settle_expo_push_receipts(
          '00000000-0000-4000-8000-000000000003',
          '[{"ticketId":"ticket-c","status":"provider_accepted"}]'::jsonb
        )
      `),
    /complete lease/i,
  );
  const rollbackSettlement = await db.query(`
    select ticket_id, receipt_status, lease_owner
      from public.expo_push_receipts
     where ticket_id in ('ticket-c', 'ticket-d')
     order by ticket_id
  `);
  assert.deepEqual(
    rollbackSettlement.rows.map((row) => row.receipt_status),
    ["pending", "pending"],
    "an incomplete settlement must roll back every outcome",
  );
  await db.exec(`
    select public.settle_expo_push_receipts(
      '00000000-0000-4000-8000-000000000003',
      '[
        {
          "ticketId":"ticket-c",
          "status":"retry",
          "errorCode":"ReceiptNotReady",
          "errorMessage":"Not ready"
        },
        {"ticketId":"ticket-d","status":"provider_accepted"}
      ]'::jsonb
    )
  `);
  const retryState = await scalar(`
    select receipt_status, lease_owner,
      next_attempt_at > clock_timestamp() as delayed,
      last_error_code
      from public.expo_push_receipts
     where ticket_id = 'ticket-c'
  `);
  assert.deepEqual(retryState, {
    receipt_status: "pending",
    lease_owner: null,
    delayed: true,
    last_error_code: "ReceiptNotReady",
  });

  // A provider rate-limit receipt is immutable. It must atomically reopen the
  // canonical event and remove only the checkpoint created by that ticket.
  await db.exec(`
    insert into public.device_push_tokens (token, user_id, updated_at) values (
      'ExpoPushToken[rate-nonchat]',
      '10000000-0000-4000-8000-000000000001',
      '2026-09-04T11:00:00Z'
    );
    insert into public.push_dispatch_events (
      id, event_key, group_id, dispatcher_id, category, event_type, audience,
      title, body, data, expires_at, dispatched_at, last_error
    ) values (
      '30000000-0000-4000-8000-000000000001',
      'event-rate-nonchat',
      '20000000-0000-4000-8000-000000000001',
      '10000000-0000-4000-8000-000000000001',
      'metric', 'metric_logged', 'group', 'Progress', 'New progress',
      '{"route":"/group"}'::jsonb,
      clock_timestamp() + interval '1 day',
      clock_timestamp(), 'gateway_accepted'
    );
    insert into public.push_events (event_key, sender_id) values (
      'event-rate-nonchat',
      '10000000-0000-4000-8000-000000000001'
    );
    select public.record_expo_push_ticket_acceptances(
      'event-rate-nonchat',
      '[{"ticketId":"ticket-rate-nonchat","userId":"10000000-0000-4000-8000-000000000001","token":"ExpoPushToken[rate-nonchat]","updatedAt":"2026-09-04T11:00:00Z"}]'::jsonb
    );
    update public.expo_push_receipts
       set next_attempt_at = accepted_at
     where ticket_id = 'ticket-rate-nonchat';
    select * from public.claim_due_expo_push_receipts(
      1,
      '00000000-0000-4000-8000-000000000010'
    );
  `);
  const rateTransition = await scalar(`
    select public.settle_expo_push_receipts(
      '00000000-0000-4000-8000-000000000010',
      '[{
        "ticketId":"ticket-rate-nonchat",
        "status":"resend",
        "errorCode":"MessageRateExceeded",
        "errorMessage":"Provider rate limit"
      }]'::jsonb
    ) as result
  `);
  assert.deepEqual(rateTransition.result, {
    settled: 0,
    retried: 0,
    invalidatedTokens: 0,
    resendQueued: 1,
    resendCompleted: 0,
  });
  assert.deepEqual(
    await scalar(`
      select receipt.delivery_action,
        receipt.receipt_status,
        receipt.action_attempt_count,
        receipt.lease_owner,
        receipt.next_attempt_at > clock_timestamp() as delayed,
        receipt.last_error_code,
        event.dispatched_at,
        event.last_error,
        exists (
          select 1 from public.push_events claim
          where claim.event_key = receipt.event_key
        ) as still_claimed,
        exists (
          select 1 from public.push_token_dispatch_acceptances acceptance
          where acceptance.event_key = receipt.event_key
            and acceptance.user_id = receipt.user_id
            and acceptance.token = receipt.token
        ) as still_accepted
      from public.expo_push_receipts receipt
      join public.push_dispatch_events event
        on event.event_key = receipt.event_key
      where receipt.ticket_id = 'ticket-rate-nonchat'
    `),
    {
      delivery_action: "resend",
      receipt_status: "pending",
      action_attempt_count: 0,
      lease_owner: null,
      delayed: true,
      last_error_code: "MessageRateExceeded",
      dispatched_at: null,
      last_error: "receipt_rate_limited",
      still_claimed: false,
      still_accepted: false,
    },
    "MessageRateExceeded must queue a new canonical send rather than re-poll its immutable receipt",
  );

  await db.exec(`
    update public.expo_push_receipts
       set next_attempt_at = clock_timestamp()
     where ticket_id = 'ticket-rate-nonchat';
  `);
  const resendClaim = await db.query(`
    select * from public.claim_due_expo_push_receipts(
      1,
      '00000000-0000-4000-8000-000000000011'
    )
  `);
  assert.equal(resendClaim.rows[0].delivery_action, "resend");
  assert.equal(resendClaim.rows[0].event_key, "event-rate-nonchat");
  await db.exec(`
    select public.settle_expo_push_receipts(
      '00000000-0000-4000-8000-000000000011',
      '[{
        "ticketId":"ticket-rate-nonchat",
        "status":"retry",
        "errorCode":"CanonicalResendFailed",
        "errorMessage":"Dispatcher is temporarily unavailable"
      }]'::jsonb
    );
  `);
  assert.deepEqual(
    await scalar(`
      select delivery_action,
        action_attempt_count,
        next_attempt_at > clock_timestamp() as delayed,
        last_error_code,
        last_error_message
      from public.expo_push_receipts
      where ticket_id = 'ticket-rate-nonchat'
    `),
    {
      delivery_action: "resend",
      action_attempt_count: 1,
      delayed: true,
      last_error_code: "MessageRateExceeded",
      last_error_message: "Dispatcher is temporarily unavailable",
    },
    "a failed resend must retain its durable action and original provider code with bounded retry",
  );
  await db.exec(`
    update public.expo_push_receipts
       set next_attempt_at = clock_timestamp()
     where ticket_id = 'ticket-rate-nonchat';
    select * from public.claim_due_expo_push_receipts(
      1,
      '00000000-0000-4000-8000-000000000012'
    );
    update public.push_dispatch_events
       set dispatched_at = clock_timestamp(), last_error = 'gateway_accepted'
     where event_key = 'event-rate-nonchat';
    select public.settle_expo_push_receipts(
      '00000000-0000-4000-8000-000000000012',
      '[{"ticketId":"ticket-rate-nonchat","status":"resend_complete"}]'::jsonb
    );
  `);
  assert.deepEqual(
    await scalar(`
      select receipt_status, terminal_at is not null as terminal, last_error_code
      from public.expo_push_receipts
      where ticket_id = 'ticket-rate-nonchat'
    `),
    {
      receipt_status: "resend_complete",
      terminal: true,
      last_error_code: "MessageRateExceeded",
    },
  );

  // A newer acceptance for the same owner/token supersedes an older receipt.
  // The old rate-limit outcome must not reopen or delete the newer checkpoint.
  await db.exec(`
    insert into public.device_push_tokens (token, user_id, updated_at) values (
      'ExpoPushToken[rate-superseded]',
      '10000000-0000-4000-8000-000000000001',
      '2026-09-04T11:01:00Z'
    );
    insert into public.push_dispatch_events (
      id, event_key, group_id, dispatcher_id, category, event_type, audience,
      title, body, expires_at, dispatched_at
    ) values (
      '30000000-0000-4000-8000-000000000002',
      'event-rate-superseded',
      '20000000-0000-4000-8000-000000000001',
      '10000000-0000-4000-8000-000000000001',
      'lead', 'lead_change', 'group', 'Lead', 'Lead changed',
      clock_timestamp() + interval '1 day', clock_timestamp()
    );
    select public.record_expo_push_ticket_acceptances(
      'event-rate-superseded',
      '[{"ticketId":"ticket-rate-superseded","userId":"10000000-0000-4000-8000-000000000001","token":"ExpoPushToken[rate-superseded]","updatedAt":"2026-09-04T11:01:00Z"}]'::jsonb
    );
    update public.push_token_dispatch_acceptances
       set accepted_at = accepted_at + interval '1 second'
     where event_key = 'event-rate-superseded'
       and user_id = '10000000-0000-4000-8000-000000000001'
       and token = 'ExpoPushToken[rate-superseded]';
    update public.expo_push_receipts
       set next_attempt_at = accepted_at
     where ticket_id = 'ticket-rate-superseded';
    select * from public.claim_due_expo_push_receipts(
      1,
      '00000000-0000-4000-8000-000000000013'
    );
    select public.settle_expo_push_receipts(
      '00000000-0000-4000-8000-000000000013',
      '[{
        "ticketId":"ticket-rate-superseded",
        "status":"resend",
        "errorCode":"MessageRateExceeded"
      }]'::jsonb
    );
  `);
  assert.deepEqual(
    await scalar(`
      select receipt.receipt_status,
        receipt.delivery_action,
        event.dispatched_at is not null as dispatched,
        acceptance.accepted_at > receipt.accepted_at as newer_checkpoint
      from public.expo_push_receipts receipt
      join public.push_dispatch_events event
        on event.event_key = receipt.event_key
      join public.push_token_dispatch_acceptances acceptance
        on acceptance.event_key = receipt.event_key
       and acceptance.user_id = receipt.user_id
       and acceptance.token = receipt.token
      where receipt.ticket_id = 'ticket-rate-superseded'
    `),
    {
      receipt_status: "resend_complete",
      delivery_action: "poll",
      dispatched: true,
      newer_checkpoint: true,
    },
    "a superseded receipt must complete without reopening the outbox or removing the newer checkpoint",
  );

  await db.exec(`
    insert into public.device_push_tokens (token, user_id, updated_at) values (
      'ExpoPushToken[rate-refreshed]',
      '10000000-0000-4000-8000-000000000001',
      '2026-09-04T11:01:30Z'
    );
    insert into public.push_dispatch_events (
      id, event_key, group_id, dispatcher_id, category, event_type, audience,
      title, body, expires_at, dispatched_at
    ) values (
      '30000000-0000-4000-8000-000000000004',
      'event-rate-refreshed',
      '20000000-0000-4000-8000-000000000001',
      '10000000-0000-4000-8000-000000000001',
      'metric', 'metric_logged', 'group', 'Progress', 'New progress',
      clock_timestamp() + interval '1 day', clock_timestamp()
    );
    select public.record_expo_push_ticket_acceptances(
      'event-rate-refreshed',
      '[{"ticketId":"ticket-rate-refreshed","userId":"10000000-0000-4000-8000-000000000001","token":"ExpoPushToken[rate-refreshed]","updatedAt":"2026-09-04T11:01:30Z"}]'::jsonb
    );
    update public.device_push_tokens
       set updated_at = '2026-09-04T11:01:31Z'
     where token = 'ExpoPushToken[rate-refreshed]';
    update public.expo_push_receipts
       set next_attempt_at = accepted_at
     where ticket_id = 'ticket-rate-refreshed';
    select * from public.claim_due_expo_push_receipts(
      1,
      '00000000-0000-4000-8000-000000000016'
    );
    select public.settle_expo_push_receipts(
      '00000000-0000-4000-8000-000000000016',
      '[{
        "ticketId":"ticket-rate-refreshed",
        "status":"resend",
        "errorCode":"MessageRateExceeded"
      }]'::jsonb
    );
  `);
  assert.deepEqual(
    await scalar(`
      select receipt.receipt_status,
        event.dispatched_at is not null as dispatched,
        exists (
          select 1 from public.push_token_dispatch_acceptances acceptance
          where acceptance.event_key = receipt.event_key
            and acceptance.user_id = receipt.user_id
            and acceptance.token = receipt.token
        ) as acceptance_preserved
      from public.expo_push_receipts receipt
      join public.push_dispatch_events event
        on event.event_key = receipt.event_key
      where receipt.ticket_id = 'ticket-rate-refreshed'
    `),
    {
      receipt_status: "resend_complete",
      dispatched: true,
      acceptance_preserved: true,
    },
    "a registration refreshed after send must not receive an old receipt's replay",
  );

  // Chat uses the same canonical outbox and additionally reopens its relational
  // message marker so client retries and receipt retries agree on one state.
  await db.exec(`
    insert into public.device_push_tokens (token, user_id, updated_at) values (
      'ExpoPushToken[rate-chat]',
      '10000000-0000-4000-8000-000000000001',
      '2026-09-04T11:02:00Z'
    );
    insert into public.messages (
      group_id, sender_id, client_generated_id, push_dispatched_at
    ) values (
      '20000000-0000-4000-8000-000000000001',
      '10000000-0000-4000-8000-000000000001',
      'chat-rate-message', clock_timestamp()
    );
    insert into public.push_dispatch_events (
      id, event_key, group_id, dispatcher_id, category, event_type, audience,
      title, body, data, expires_at, dispatched_at
    ) values (
      '30000000-0000-4000-8000-000000000003',
      'message:chat-rate-message',
      '20000000-0000-4000-8000-000000000001',
      '10000000-0000-4000-8000-000000000001',
      'chat', 'group_message', 'group', 'Chat', 'A message',
      '{"messageId":"chat-rate-message","senderId":"10000000-0000-4000-8000-000000000001"}'::jsonb,
      clock_timestamp() + interval '1 day', clock_timestamp()
    );
    insert into public.push_events (event_key, sender_id) values (
      'message:chat-rate-message',
      '10000000-0000-4000-8000-000000000001'
    );
    select public.record_expo_push_ticket_acceptances(
      'message:chat-rate-message',
      '[{"ticketId":"ticket-rate-chat","userId":"10000000-0000-4000-8000-000000000001","token":"ExpoPushToken[rate-chat]","updatedAt":"2026-09-04T11:02:00Z"}]'::jsonb
    );
    update public.expo_push_receipts
       set next_attempt_at = accepted_at
     where ticket_id = 'ticket-rate-chat';
    select * from public.claim_due_expo_push_receipts(
      1,
      '00000000-0000-4000-8000-000000000014'
    );
    select public.settle_expo_push_receipts(
      '00000000-0000-4000-8000-000000000014',
      '[{
        "ticketId":"ticket-rate-chat",
        "status":"resend",
        "errorCode":"MessageRateExceeded"
      }]'::jsonb
    );
  `);
  assert.deepEqual(
    await scalar(`
      select event.dispatched_at as outbox_dispatched_at,
        message.push_dispatched_at as message_dispatched_at,
        receipt.delivery_action
      from public.push_dispatch_events event
      join public.messages message
        on message.group_id = event.group_id
       and message.sender_id = event.dispatcher_id
       and message.client_generated_id = event.data ->> 'messageId'
      join public.expo_push_receipts receipt
        on receipt.event_key = event.event_key
      where receipt.ticket_id = 'ticket-rate-chat'
    `),
    {
      outbox_dispatched_at: null,
      message_dispatched_at: null,
      delivery_action: "resend",
    },
    "chat rate-limit recovery must reopen both the canonical outbox and message marker",
  );
  await db.exec(`
    update public.expo_push_receipts
       set next_attempt_at = clock_timestamp()
     where ticket_id = 'ticket-rate-chat';
    select * from public.claim_due_expo_push_receipts(
      1,
      '00000000-0000-4000-8000-000000000015'
    );
    update public.push_dispatch_events
       set dispatched_at = clock_timestamp(), last_error = 'gateway_accepted'
     where event_key = 'message:chat-rate-message';
    update public.messages
       set push_dispatched_at = clock_timestamp()
     where sender_id = '10000000-0000-4000-8000-000000000001'
       and client_generated_id = 'chat-rate-message';
    select public.settle_expo_push_receipts(
      '00000000-0000-4000-8000-000000000015',
      '[{"ticketId":"ticket-rate-chat","status":"resend_complete"}]'::jsonb
    );
  `);

  // Two workers may concurrently lease different failed targets for one event.
  // Their lease owners must remain distinct so the Edge resend can select only
  // the exact target set owned by its caller rather than replaying both sets.
  await db.exec(`
    insert into public.device_push_tokens (token, user_id, updated_at) values
      (
        'ExpoPushToken[rate-concurrent-a]',
        '10000000-0000-4000-8000-000000000001',
        '2026-09-04T11:04:00Z'
      ),
      (
        'ExpoPushToken[rate-concurrent-b]',
        '10000000-0000-4000-8000-000000000001',
        '2026-09-04T11:04:01Z'
      );
    insert into public.push_dispatch_events (
      id, event_key, group_id, dispatcher_id, category, event_type, audience,
      title, body, data, expires_at, dispatched_at
    ) values (
      '30000000-0000-4000-8000-000000000006',
      'event-rate-concurrent',
      '20000000-0000-4000-8000-000000000001',
      '10000000-0000-4000-8000-000000000001',
      'metric', 'metric_logged', 'group', 'Progress', 'New progress',
      '{"route":"/group"}'::jsonb,
      clock_timestamp() + interval '1 day', clock_timestamp()
    );
    insert into public.push_events (event_key, sender_id) values (
      'event-rate-concurrent',
      '10000000-0000-4000-8000-000000000001'
    );
    select public.record_expo_push_ticket_acceptances(
      'event-rate-concurrent',
      '[
        {"ticketId":"ticket-rate-concurrent-a","userId":"10000000-0000-4000-8000-000000000001","token":"ExpoPushToken[rate-concurrent-a]","updatedAt":"2026-09-04T11:04:00Z"},
        {"ticketId":"ticket-rate-concurrent-b","userId":"10000000-0000-4000-8000-000000000001","token":"ExpoPushToken[rate-concurrent-b]","updatedAt":"2026-09-04T11:04:01Z"}
      ]'::jsonb
    );
    update public.expo_push_receipts
       set next_attempt_at = accepted_at
     where event_key = 'event-rate-concurrent';
    select * from public.claim_due_expo_push_receipts(
      2,
      '00000000-0000-4000-8000-000000000019'
    );
    select public.settle_expo_push_receipts(
      '00000000-0000-4000-8000-000000000019',
      '[
        {"ticketId":"ticket-rate-concurrent-a","status":"resend","errorCode":"MessageRateExceeded"},
        {"ticketId":"ticket-rate-concurrent-b","status":"resend","errorCode":"MessageRateExceeded"}
      ]'::jsonb
    );
    update public.expo_push_receipts
       set next_attempt_at = accepted_at
     where event_key = 'event-rate-concurrent';
  `);
  const concurrentLeaseA = await db.query(`
    select * from public.claim_due_expo_push_receipts(
      1,
      '00000000-0000-4000-8000-000000000020'
    )
  `);
  const concurrentLeaseB = await db.query(`
    select * from public.claim_due_expo_push_receipts(
      1,
      '00000000-0000-4000-8000-000000000021'
    )
  `);
  assert.equal(concurrentLeaseA.rows.length, 1);
  assert.equal(concurrentLeaseB.rows.length, 1);
  assert.equal(concurrentLeaseA.rows[0].event_key, "event-rate-concurrent");
  assert.equal(concurrentLeaseB.rows[0].event_key, "event-rate-concurrent");
  assert.equal(concurrentLeaseA.rows[0].delivery_action, "resend");
  assert.equal(concurrentLeaseB.rows[0].delivery_action, "resend");
  assert.notEqual(
    concurrentLeaseA.rows[0].ticket_id,
    concurrentLeaseB.rows[0].ticket_id,
    "concurrent workers for one event must own disjoint receipt targets",
  );
  assert.deepEqual(
    (await db.query(`
      select lease_owner::text as lease_owner, count(*)::integer as target_count
        from public.expo_push_receipts
       where event_key = 'event-rate-concurrent'
       group by lease_owner
       order by lease_owner
    `)).rows,
    [
      {
        lease_owner: "00000000-0000-4000-8000-000000000020",
        target_count: 1,
      },
      {
        lease_owner: "00000000-0000-4000-8000-000000000021",
        target_count: 1,
      },
    ],
    "same-event resend leases must remain independently addressable",
  );
  await db.exec(`
    select public.settle_expo_push_receipts(
      '00000000-0000-4000-8000-000000000020',
      jsonb_build_array(jsonb_build_object(
        'ticketId', (
          select ticket_id from public.expo_push_receipts
           where lease_owner = '00000000-0000-4000-8000-000000000020'
        ),
        'status', 'retry',
        'errorCode', 'CanonicalResendFailed'
      ))
    );
    select public.settle_expo_push_receipts(
      '00000000-0000-4000-8000-000000000021',
      jsonb_build_array(jsonb_build_object(
        'ticketId', (
          select ticket_id from public.expo_push_receipts
           where lease_owner = '00000000-0000-4000-8000-000000000021'
        ),
        'status', 'retry',
        'errorCode', 'CanonicalResendFailed'
      ))
    );
  `);

  await db.exec(`
    insert into public.device_push_tokens (token, user_id, updated_at) values (
      'ExpoPushToken[rate-expiry]',
      '10000000-0000-4000-8000-000000000001',
      '2026-09-04T11:03:00Z'
    );
    insert into public.push_dispatch_events (
      id, event_key, group_id, dispatcher_id, category, event_type, audience,
      title, body, expires_at, dispatched_at
    ) values (
      '30000000-0000-4000-8000-000000000005',
      'event-rate-expiry',
      '20000000-0000-4000-8000-000000000001',
      '10000000-0000-4000-8000-000000000001',
      'metric', 'metric_logged', 'group', 'Progress', 'New progress',
      clock_timestamp() + interval '1 day', clock_timestamp()
    );
    select public.record_expo_push_ticket_acceptances(
      'event-rate-expiry',
      '[{"ticketId":"ticket-rate-expiry","userId":"10000000-0000-4000-8000-000000000001","token":"ExpoPushToken[rate-expiry]","updatedAt":"2026-09-04T11:03:00Z"}]'::jsonb
    );
    update public.expo_push_receipts
       set next_attempt_at = accepted_at
     where ticket_id = 'ticket-rate-expiry';
    select * from public.claim_due_expo_push_receipts(
      1,
      '00000000-0000-4000-8000-000000000017'
    );
    select public.settle_expo_push_receipts(
      '00000000-0000-4000-8000-000000000017',
      '[{
        "ticketId":"ticket-rate-expiry",
        "status":"resend",
        "errorCode":"MessageRateExceeded"
      }]'::jsonb
    );
    update public.expo_push_receipts
       set accepted_at = clock_timestamp() - interval '2 hours',
           expires_at = clock_timestamp() - interval '1 second',
           next_attempt_at = clock_timestamp() - interval '1 second'
     where ticket_id = 'ticket-rate-expiry';
    select * from public.claim_due_expo_push_receipts(
      1,
      '00000000-0000-4000-8000-000000000018'
    );
  `);
  assert.deepEqual(
    await scalar(`
      select receipt.receipt_status,
        receipt.last_error_code,
        exists (
          select 1 from public.push_token_dispatch_acceptances acceptance
          where acceptance.event_key = receipt.event_key
            and acceptance.user_id = receipt.user_id
            and acceptance.token = receipt.token
        ) as suppression_checkpoint
      from public.expo_push_receipts receipt
      where receipt.ticket_id = 'ticket-rate-expiry'
    `),
    {
      receipt_status: "expired",
      last_error_code: "ReceiptExpired",
      suppression_checkpoint: true,
    },
    "an exhausted resend must restore a per-target suppression checkpoint before the ordinary outbox drain can see it",
  );

  await db.exec(`
    insert into public.device_push_tokens (token, user_id, updated_at)
    values (
      'ExpoPushToken[token-refresh]',
      '10000000-0000-4000-8000-000000000001',
      clock_timestamp() - interval '1 minute'
    );
    select public.record_expo_push_ticket_acceptances(
      'event-refresh',
      jsonb_build_array(jsonb_build_object(
        'ticketId', 'ticket-refresh',
        'userId', '10000000-0000-4000-8000-000000000001',
        'token', 'ExpoPushToken[token-refresh]',
        'updatedAt', clock_timestamp() - interval '2 minutes'
      ))
    );
    update public.expo_push_receipts
       set next_attempt_at = accepted_at
     where ticket_id = 'ticket-refresh';
    select * from public.claim_due_expo_push_receipts(
      1,
      '00000000-0000-4000-8000-000000000004'
    );
    select public.settle_expo_push_receipts(
      '00000000-0000-4000-8000-000000000004',
      '[{
        "ticketId":"ticket-refresh",
        "status":"terminal_error",
        "errorCode":"DeviceNotRegistered"
      }]'::jsonb
    );
  `);
  assert.equal(
    (await db.query(`
      select token from public.device_push_tokens
       where token = 'ExpoPushToken[token-refresh]'
    `)).rows.length,
    1,
    "a receipt must not delete a token registration refreshed after send",
  );

  await db.exec(`
    insert into public.device_push_tokens (token, user_id, updated_at)
    values (
      'ExpoPushToken[token-reassigned-receipt]',
      '10000000-0000-4000-8000-000000000002',
      clock_timestamp() - interval '1 minute'
    );
    select public.record_expo_push_ticket_acceptances(
      'event-reassigned-receipt',
      jsonb_build_array(jsonb_build_object(
        'ticketId', 'ticket-reassigned-receipt',
        'userId', '10000000-0000-4000-8000-000000000001',
        'token', 'ExpoPushToken[token-reassigned-receipt]',
        'updatedAt', (
          select updated_at
          from public.device_push_tokens
          where token = 'ExpoPushToken[token-reassigned-receipt]'
        )
      ))
    );
    update public.expo_push_receipts
       set next_attempt_at = accepted_at
     where ticket_id = 'ticket-reassigned-receipt';
    select * from public.claim_due_expo_push_receipts(
      1,
      '00000000-0000-4000-8000-000000000006'
    );
    select public.settle_expo_push_receipts(
      '00000000-0000-4000-8000-000000000006',
      '[{
        "ticketId":"ticket-reassigned-receipt",
        "status":"terminal_error",
        "errorCode":"DeviceNotRegistered"
      }]'::jsonb
    );
  `);
  assert.deepEqual(
    await scalar(`
      select user_id::text as user_id
      from public.device_push_tokens
      where token = 'ExpoPushToken[token-reassigned-receipt]'
    `),
    { user_id: "10000000-0000-4000-8000-000000000002" },
    "a delayed receipt for the old owner must not delete a reassigned token even when the timestamp is unchanged",
  );

  await db.exec(`
    select public.record_expo_push_ticket_acceptances(
      'event-expired',
      '[{"ticketId":"ticket-expired","userId":"10000000-0000-4000-8000-000000000001","token":"ExpoPushToken[token-expired]","updatedAt":"2026-09-04T10:00:00Z"}]'::jsonb
    );
    update public.expo_push_receipts
       set accepted_at = clock_timestamp() - interval '25 hours',
           next_attempt_at = clock_timestamp() - interval '24 hours',
           expires_at = clock_timestamp() - interval '1 hour'
     where ticket_id = 'ticket-expired';
    select * from public.claim_due_expo_push_receipts(
      1000,
      '00000000-0000-4000-8000-000000000005'
    );
  `);
  assert.deepEqual(
    await scalar(`
      select receipt_status, last_error_code, terminal_at is not null as terminal
        from public.expo_push_receipts
       where ticket_id = 'ticket-expired'
    `),
    {
      receipt_status: "expired",
      last_error_code: "ReceiptExpired",
      terminal: true,
    },
  );

  await db.exec(`
    update public.expo_push_receipts
       set terminal_at = clock_timestamp() - interval '8 days'
     where ticket_id = 'ticket-a';
    update public.push_token_dispatch_acceptances
       set accepted_at = clock_timestamp() - interval '8 days'
     where event_key = 'event-a'
       and token = 'ExpoPushToken[token-a]';
    select public.invoke_expo_push_receipt_worker();
  `);
  assert.equal(
    (await db.query(`
      select ticket_id from public.expo_push_receipts where ticket_id = 'ticket-a'
    `)).rows.length,
    0,
    "terminal diagnostics must be removed after seven days",
  );
  assert.equal(
    (await db.query(`
      select token from public.push_token_dispatch_acceptances
       where event_key = 'event-a'
         and token = 'ExpoPushToken[token-a]'
    `)).rows.length,
    0,
    "the cron must bound the existing gateway-acceptance ledger too",
  );

  await db.exec(`
    insert into vault.decrypted_secrets (name, decrypted_secret) values
      (
        'web_personal_notification_worker_url',
        'https://project-ref.supabase.co/functions/v1/web-personal-notifications'
      ),
      (
        'web_personal_notification_worker_secret',
        '0123456789abcdef0123456789abcdef'
      );
    update public.expo_push_receipts
       set next_attempt_at = accepted_at,
           lease_owner = null,
           lease_until = null
     where ticket_id = 'ticket-c';
    select public.invoke_expo_push_receipt_worker();
  `);
  assert.deepEqual(
    await scalar(`
      select url, body ->> 'limit' as limit
        from net.http_calls
       order by ctid desc
       limit 1
    `),
    {
      url: "https://project-ref.supabase.co/functions/v1/push-receipts",
      limit: "100",
    },
    "cron must derive only the sibling receipt-worker URL",
  );
  assert.deepEqual(
    await scalar(`
      select jobname, schedule, command
        from cron.job
       where jobname = 'expo-push-receipts-every-five-minutes'
    `),
    {
      jobname: "expo-push-receipts-every-five-minutes",
      schedule: "*/5 * * * *",
      command: "select public.invoke_expo_push_receipt_worker()",
    },
  );

  await db.exec(`
    select public.record_expo_push_ticket_acceptances(
      'event-account-delete',
      '[{"ticketId":"ticket-account-delete","userId":"10000000-0000-4000-8000-000000000002","token":"ExpoPushToken[token-account-delete]","updatedAt":"2026-09-04T10:00:00Z"}]'::jsonb
    );
    delete from public.profiles
     where id = '10000000-0000-4000-8000-000000000002';
  `);
  assert.equal(
    (await db.query(`
      select ticket_id from public.expo_push_receipts
       where ticket_id = 'ticket-account-delete'
    `)).rows.length,
    0,
    "account deletion must cascade through server-only receipt diagnostics",
  );
  assert.equal(
    (await db.query(`
      select token from public.push_token_dispatch_acceptances
       where user_id = '10000000-0000-4000-8000-000000000002'
    `)).rows.length,
    0,
    "account deletion must cascade through every owned dispatch checkpoint",
  );
} finally {
  await db.close();
}

console.log(
  "Expo receipt PostgreSQL validation passed (legacy ownership backfill, exact-version stale cleanup, atomic acceptance, private RLS, delayed polling, durable MessageRateExceeded chat/non-chat resend, supersession/version fences, concurrent lease isolation, resend retry/completion, token invalidation, account deletion, expiry, retention, and cron URL derivation).",
);
