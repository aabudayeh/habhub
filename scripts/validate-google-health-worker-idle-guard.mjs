import assert from "node:assert/strict";
import { PGlite } from "npm:@electric-sql/pglite@0.3.10";

const root = new URL("../", import.meta.url);
const read = (relativePath) => Deno.readTextFile(new URL(relativePath, root));
const migration = await read(
  "supabase/migrations/202608280003_suppress_redundant_google_health_worker_wakeups.sql",
);
const conditionalStatus = await read(
  "supabase/migrations/202608240008_conditional_daily_status_upserts.sql",
);
const legacyStatusGuard = await read(
  "supabase/migrations/202608240009_legacy_workspace_publish_containment.sql",
);

assert.match(
  migration,
  /create index if not exists google_health_webhook_queue_active_synthetic_idx[\s\S]*job_kind in \('initial', 'catchup'\)[\s\S]*status in \('pending', 'processing'\)/,
  "The active synthetic-job lookup needs a matching partial index.",
);
assert.match(
  migration,
  /connection\.next_catchup_at <= clock_timestamp\(\)[\s\S]*not exists \([\s\S]*active_job\.health_user_id = connection\.health_user_id[\s\S]*active_job\.connection_generation =[\s\S]*connection\.connection_generation[\s\S]*active_job\.job_kind in \('initial', 'catchup'\)[\s\S]*active_job\.status in \('pending', 'processing'\)/,
  "A due connection must not wake while its generation already owns durable synthetic work.",
);
assert.match(
  migration,
  /v_hourly_maintenance := extract\(minute from clock_timestamp\(\)\)::integer = 0/,
  "The bounded hourly maintenance wake must be preserved.",
);
assert.match(
  migration,
  /google_health_webhook_queue queued[\s\S]*queued\.status = 'pending'[\s\S]*queued\.available_at <= clock_timestamp\(\)[\s\S]*queued\.status = 'processing'[\s\S]*interval '30 minutes'/,
  "Due webhook/retry work and expired leases must still wake the worker.",
);
assert.match(
  migration,
  /google_health_pending_grants staged[\s\S]*staged\.consumed_at is null[\s\S]*staged\.expires_at <= clock_timestamp\(\)/,
  "Expired pending grants must still wake the worker.",
);
assert.match(
  migration,
  /google_health_revocation_queue queued[\s\S]*interval '10 minutes'/,
  "Due and expired-lease revocations must still wake the worker.",
);
assert.match(
  migration,
  /revoke all on function public\.invoke_google_health_worker\(\)[\s\S]*grant execute[\s\S]*service_role/,
  "Worker invocation must stay service-role-only.",
);

// The write spike is historical/cumulative. The already-applied containment
// layers remain stronger than a new trigger: the current RPC avoids material
// no-op conflicts, while legacy/direct revision-only writes are cancelled by
// the before-update trigger unless they cross a privacy fence.
assert.match(
  conditionalStatus,
  /on conflict \(group_id, metric_id, user_id, local_date\) do update[\s\S]*row\([\s\S]*is distinct from row\([\s\S]*metric_privacy_cache_fences/,
  "The primary status RPC must retain material-change and privacy-fence checks.",
);
assert.match(
  legacyStatusGuard,
  /to_jsonb\(new\) - array\['updated_at', 'account_revision'\][\s\S]*is not distinct from[\s\S]*if not v_crosses_privacy_fence then[\s\S]*return null/,
  "Direct revision-only status writes must remain cancelled before tuple churn.",
);

const hourlyAssignment =
  "v_hourly_maintenance := extract(minute from clock_timestamp())::integer = 0;";
assert.ok(migration.includes(hourlyAssignment));
// Runtime cases isolate the non-hourly guard. The production definition above
// is still parsed in exactly the same migration; only the clock-dependent
// assignment is made deterministic for this test.
const runtimeMigration = migration.replace(
  hourlyAssignment,
  "v_hourly_maintenance := false;",
);
const db = new PGlite();

async function httpCallCount() {
  const result = await db.query("select count(*)::integer as count from net.http_calls");
  return Number(result.rows[0]?.count ?? 0);
}

async function resetCalls() {
  await db.exec("truncate net.http_calls");
}

try {
  await db.exec(`
    create role anon;
    create role authenticated;
    create role service_role;
    create schema vault;
    create schema net;

    create table public.google_health_runtime_config (
      singleton boolean primary key,
      enabled boolean not null
    );
    create table public.google_health_pending_grants (
      consumed_at timestamptz,
      expires_at timestamptz not null
    );
    create table public.google_health_revocation_queue (
      status text not null,
      available_at timestamptz not null,
      claimed_at timestamptz
    );
    create table public.google_health_webhook_queue (
      health_user_id text not null,
      connection_generation bigint,
      job_kind text not null,
      status text not null,
      available_at timestamptz not null,
      claimed_at timestamptz
    );
    create table public.google_health_connections (
      user_id uuid primary key,
      status text not null,
      refresh_token_ciphertext text,
      health_user_id text,
      connection_generation bigint not null,
      next_catchup_at timestamptz not null
    );
    create table vault.decrypted_secrets (
      name text not null,
      decrypted_secret text,
      created_at timestamptz not null default now()
    );
    create table net.http_calls (url text not null);
    create function net.http_post(
      url text,
      headers jsonb,
      body jsonb,
      timeout_milliseconds integer
    ) returns bigint language plpgsql as $$
    begin
      insert into net.http_calls (url) values (url);
      return 1;
    end;
    $$;

    insert into public.google_health_runtime_config values (true, true);
    insert into vault.decrypted_secrets (name, decrypted_secret) values
      ('google_health_worker_url', 'https://worker.invalid'),
      ('google_health_worker_secret', 'secret');
    insert into public.google_health_connections values (
      '00000000-0000-4000-8000-000000000001',
      'connected',
      'ciphertext',
      'health-user-1',
      7,
      now() - interval '1 hour'
    );
  `);
  await db.exec(runtimeMigration);

  await db.exec(`
    insert into public.google_health_webhook_queue values (
      'health-user-1', 7, 'initial', 'pending',
      now() + interval '20 minutes', null
    )
  `);
  await db.exec("select public.invoke_google_health_worker()");
  assert.equal(
    await httpCallCount(),
    0,
    "A delayed synthetic retry must own its schedule without minute wakeups.",
  );

  await db.exec(`
    update public.google_health_webhook_queue
       set status = 'processing', claimed_at = now()
  `);
  await db.exec("select public.invoke_google_health_worker()");
  assert.equal(
    await httpCallCount(),
    0,
    "A healthy processing lease must not produce a duplicate wakeup.",
  );

  await db.exec(`
    update public.google_health_webhook_queue
       set claimed_at = now() - interval '31 minutes'
  `);
  await db.exec("select public.invoke_google_health_worker()");
  assert.equal(
    await httpCallCount(),
    1,
    "An expired processing lease must still wake for recovery.",
  );

  await resetCalls();
  await db.exec(`
    update public.google_health_webhook_queue
       set status = 'pending',
           available_at = now() - interval '1 minute',
           claimed_at = null
  `);
  await db.exec("select public.invoke_google_health_worker()");
  assert.equal(await httpCallCount(), 1, "A due retry must wake the worker.");

  await resetCalls();
  await db.exec("delete from public.google_health_webhook_queue");
  await db.exec("select public.invoke_google_health_worker()");
  assert.equal(
    await httpCallCount(),
    1,
    "A due connection without synthetic work must wake to stage catch-up.",
  );

  await resetCalls();
  await db.exec(`
    update public.google_health_connections
       set next_catchup_at = now() + interval '1 hour';
    insert into public.google_health_webhook_queue values (
      'health-user-1', null, 'webhook', 'pending',
      now() - interval '1 minute', null
    )
  `);
  await db.exec("select public.invoke_google_health_worker()");
  assert.equal(await httpCallCount(), 1, "A due provider webhook must wake.");

  await resetCalls();
  await db.exec(`
    delete from public.google_health_webhook_queue;
    update public.google_health_runtime_config set enabled = false;
    insert into public.google_health_pending_grants values (
      null, now() - interval '1 minute'
    )
  `);
  await db.exec("select public.invoke_google_health_worker()");
  assert.equal(
    await httpCallCount(),
    1,
    "Expired OAuth grants must be cleaned even while sync is disabled.",
  );

  await resetCalls();
  await db.exec(`
    delete from public.google_health_pending_grants;
    insert into public.google_health_revocation_queue values (
      'pending', now() - interval '1 minute', null
    )
  `);
  await db.exec("select public.invoke_google_health_worker()");
  assert.equal(
    await httpCallCount(),
    1,
    "Due revocations must be processed even while sync is disabled.",
  );

  const indexResult = await db.query(`
    select indexname
      from pg_indexes
     where schemaname = 'public'
       and indexname = 'google_health_webhook_queue_active_synthetic_idx'
  `);
  assert.equal(indexResult.rows.length, 1, "Active synthetic index was not installed.");
} finally {
  await db.close();
}

console.log(
  "Google Health worker idle-guard validation passed: duplicate generation work stays asleep while retries, leases, webhooks, catch-ups, grants, and revocations remain runnable.",
);
