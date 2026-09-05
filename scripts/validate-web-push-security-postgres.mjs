import assert from "node:assert/strict";
import { PGlite } from "npm:@electric-sql/pglite@0.3.10";

const root = new URL("../", import.meta.url);
const migration = await Deno.readTextFile(
  new URL(
    "supabase/migrations/202609040004_trusted_web_push_endpoints.sql",
    root,
  ),
);
const db = new PGlite();

async function one(sql, params = []) {
  return (await db.query(sql, params)).rows[0];
}

async function rejectsInsert(endpoint) {
  await assert.rejects(
    db.query(
      `insert into public.web_push_subscriptions
       (endpoint, user_id, p256dh, auth, updated_at)
       values ($1, '10000000-0000-4000-8000-000000000001', repeat('A', 65), repeat('B', 22), clock_timestamp())`,
      [endpoint],
    ),
  );
}

try {
  await db.exec(`
    create role anon;
    create role authenticated;
    create role service_role;
    create schema auth;
    create function auth.role() returns text language sql stable
      as $$ select 'service_role'::text $$;

    create table public.profiles (id uuid primary key);
    create table public.web_push_subscriptions (
      endpoint text primary key,
      user_id uuid not null references public.profiles(id) on delete cascade,
      p256dh text not null,
      auth text not null,
      updated_at timestamptz not null default clock_timestamp()
    );
    create table public.web_personal_notification_schedule (
      user_id uuid not null references public.profiles(id) on delete cascade,
      schedule_key text not null,
      primary key (user_id, schedule_key)
    );
    create table public.web_personal_notification_acceptances (
      user_id uuid not null,
      schedule_key text not null,
      endpoint text not null references public.web_push_subscriptions(endpoint)
        on delete cascade,
      accepted_at timestamptz not null default clock_timestamp(),
      primary key (user_id, schedule_key, endpoint),
      foreign key (user_id, schedule_key)
        references public.web_personal_notification_schedule(user_id, schedule_key)
        on delete cascade
    );

    insert into public.profiles (id) values
      ('10000000-0000-4000-8000-000000000001'),
      ('10000000-0000-4000-8000-000000000002');
    insert into public.web_personal_notification_schedule (user_id, schedule_key)
    values
      ('10000000-0000-4000-8000-000000000001', 'morning-walk'),
      ('10000000-0000-4000-8000-000000000002', 'other-reminder');
    insert into public.web_push_subscriptions
      (endpoint, user_id, p256dh, auth, updated_at)
    values
      (
        'https://fcm.googleapis.com/fcm/send/existing',
        '10000000-0000-4000-8000-000000000001',
        repeat('A', 65), repeat('B', 22), '2026-09-04T08:00:00Z'
      ),
      (
        'https://updates.push.services.mozilla.com/wpush/v2/other',
        '10000000-0000-4000-8000-000000000002',
        repeat('C', 65), repeat('D', 22), '2026-09-04T08:05:00Z'
      ),
      (
        'https://127.0.0.1/internal',
        '10000000-0000-4000-8000-000000000001',
        repeat('E', 65), repeat('F', 22), '2026-09-04T08:10:00Z'
      ),
      (
        'https://fcm.googleapis.com.attacker.example/collect',
        '10000000-0000-4000-8000-000000000001',
        repeat('G', 65), repeat('H', 22), '2026-09-04T08:15:00Z'
      );
    insert into public.web_personal_notification_acceptances
      (user_id, schedule_key, endpoint)
    values
      (
        '10000000-0000-4000-8000-000000000001',
        'morning-walk',
        'https://fcm.googleapis.com/fcm/send/existing'
      ),
      (
        '10000000-0000-4000-8000-000000000001',
        'morning-walk',
        'https://updates.push.services.mozilla.com/wpush/v2/other'
      );
  `);

  await db.exec(migration);

  assert.deepEqual(
    await one(`select count(*)::integer as count from public.web_push_subscriptions`),
    { count: 2 },
    "migration must remove pre-existing untrusted endpoints",
  );
  assert.deepEqual(
    await one(`
      select count(*)::integer as count
      from public.web_personal_notification_acceptances
      where registration_updated_at = '2026-09-04T08:00:00Z'
    `),
    { count: 1 },
    "an unambiguous acceptance must be bound to its exact subscription generation",
  );

  for (const endpoint of [
    "https://web.push.apple.com/example",
    "https://wns2-db5p.notify.windows.com/w/?token=example",
  ]) {
    await db.query(
      `insert into public.web_push_subscriptions
       (endpoint, user_id, p256dh, auth, updated_at)
       values ($1, '10000000-0000-4000-8000-000000000001', repeat('I', 65), repeat('J', 22), clock_timestamp())`,
      [endpoint],
    );
  }
  for (const endpoint of [
    "http://fcm.googleapis.com/fcm/send/example",
    "https://fcm.googleapis.com.evil.example/collect",
    "https://evilpush.apple.com/collect",
    "https://user@fcm.googleapis.com/fcm/send/example",
    "https://fcm.googleapis.com:8443/fcm/send/example",
    "https://[::1]/push",
    "https://web.push.apple.com/example#fragment",
  ]) {
    await rejectsInsert(endpoint);
  }

  const deleted = await one(
    `select public.delete_exact_stale_web_push_subscriptions($1::jsonb) as result`,
    [
      JSON.stringify([
        {
          userId: "10000000-0000-4000-8000-000000000001",
          endpoint: "https://fcm.googleapis.com/fcm/send/existing",
          p256dh: "A".repeat(65),
          auth: "B".repeat(22),
          updatedAt: "2026-09-04T08:00:00Z",
        },
      ]),
    ],
  );
  assert.equal(deleted.result.webSubscriptions, 1);
  assert.equal(deleted.result.changedRegistrations, 0);

  const changed = await one(
    `select public.delete_exact_stale_web_push_subscriptions($1::jsonb) as result`,
    [
      JSON.stringify([
        {
          userId: "10000000-0000-4000-8000-000000000001",
          endpoint: "https://web.push.apple.com/example",
          p256dh: "I".repeat(65),
          auth: "J".repeat(22),
          updatedAt: "2026-09-04T07:00:00Z",
        },
      ]),
    ],
  );
  assert.equal(changed.result.webSubscriptions, 0);
  assert.equal(changed.result.changedRegistrations, 1);
  assert.deepEqual(
    await one(`
      select count(*)::integer as count
      from public.web_push_subscriptions
      where endpoint = 'https://web.push.apple.com/example'
    `),
    { count: 1 },
    "a refreshed registration must survive a late stale response",
  );

  console.log(
    "Web Push security PostgreSQL validation passed: provider allowlist, legacy purge, versioned acceptance, and exact stale cleanup.",
  );
} finally {
  await db.close();
}
