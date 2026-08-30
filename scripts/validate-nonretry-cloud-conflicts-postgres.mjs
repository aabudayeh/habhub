import assert from "node:assert/strict";
import { PGlite } from "npm:@electric-sql/pglite@0.3.10";

const migrationPath =
  "supabase/migrations/202608280005_restore_nonretry_cloud_conflicts.sql";
const migration = await Deno.readTextFile(migrationPath);

async function installRetryClassFixtures(db, includeUnexpected = false) {
  await db.exec(`
    create table public.revision_conflict_side_effects (
      source text primary key
    );

    create or replace function public.assert_account_snapshot_revision(
      p_user_id uuid,
      p_expected_revision bigint
    )
    returns void
    language plpgsql
    as $$
    begin
      insert into public.revision_conflict_side_effects (source)
        values ('account');
      raise exception 'stale_group_publish' using errcode = '40001';
    end;
    $$;

    create or replace function public.apply_google_health_import(
      p_user_id uuid,
      p_records jsonb,
      p_seen_records jsonb,
      p_replacements jsonb,
      p_synced_at timestamptz,
      p_expected_revision bigint,
      p_import_id uuid
    )
    returns void
    language plpgsql
    as $$
    begin
      insert into public.revision_conflict_side_effects (source)
        values ('import');
      raise exception 'google_health_snapshot_conflict'
        using errcode = '40001';
    end;
    $$;

    create or replace function public.project_google_health_group_data(
      p_user_id uuid,
      p_snapshot_revision bigint
    )
    returns void
    language plpgsql
    as $$
    begin
      insert into public.revision_conflict_side_effects (source)
        values ('projection');
      raise exception 'google_health_projection_conflict'
        using errcode = '40001';
    end;
    $$;
  `);
  if (includeUnexpected) {
    await db.exec(`
      create or replace function public.unexpected_retry_class_conflict()
      returns void
      language plpgsql
      as $$
      begin
        raise exception 'unexpected_conflict' using errcode = '40001';
      end;
      $$;
    `);
  }
}

async function assertConflict(db, sql, expectedMessage) {
  await assert.rejects(
    async () => {
      try {
        await db.query(sql);
      } catch (error) {
        assert.equal(
          error.code,
          "P0001",
          `${expectedMessage} must be returned once as a non-retryable application conflict`,
        );
        throw error;
      }
    },
    new RegExp(expectedMessage),
  );
}

const db = new PGlite();
try {
  await installRetryClassFixtures(db);
  await db.exec(migration);

  await assertConflict(
    db,
    "select public.assert_account_snapshot_revision('00000000-0000-4000-8000-000000000001', 1)",
    "stale_group_publish",
  );
  await assertConflict(
    db,
    "select public.apply_google_health_import('00000000-0000-4000-8000-000000000001', '[]'::jsonb, '[]'::jsonb, '[]'::jsonb, now(), 1, '00000000-0000-4000-8000-000000000002')",
    "google_health_snapshot_conflict",
  );
  await assertConflict(
    db,
    "select public.project_google_health_group_data('00000000-0000-4000-8000-000000000001', 1)",
    "google_health_projection_conflict",
  );

  assert.equal(
    Number(
      (
        await db.query(
          "select count(*)::integer as count from public.revision_conflict_side_effects",
        )
      ).rows[0]?.count ?? -1,
    ),
    0,
    "changing the SQLSTATE must not weaken atomic rollback or preserve partial writes",
  );
  assert.equal(
    Number(
      (
        await db.query(`
          select count(*)::integer as count
            from pg_catalog.pg_proc p
            join pg_catalog.pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public'
             and p.prokind in ('f', 'p')
             and pg_catalog.strpos(
               pg_catalog.pg_get_functiondef(p.oid),
               '''40001'''
             ) > 0
        `)
      ).rows[0]?.count ?? -1,
    ),
    0,
    "the final schema must contain no deterministic retry-class conflict",
  );
} finally {
  await db.close();
}

const driftDb = new PGlite();
try {
  await installRetryClassFixtures(driftDb, true);
  await assert.rejects(
    () => driftDb.exec(migration),
    /Unexpected public functions use retry-class SQLSTATE 40001/,
    "the migration must fail closed instead of silently rewriting an unknown function",
  );
  assert.equal(
    Number(
      (
        await driftDb.query(`
          select count(*)::integer as count
            from pg_catalog.pg_proc p
            join pg_catalog.pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public'
             and p.prokind in ('f', 'p')
             and pg_catalog.strpos(
               pg_catalog.pg_get_functiondef(p.oid),
               '''40001'''
             ) > 0
        `)
      ).rows[0]?.count ?? -1,
    ),
    4,
    "a drift failure must leave every function definition unchanged",
  );
} finally {
  await driftDb.close();
}

console.log(
  "Non-retry cloud conflict PostgreSQL validation passed (P0001 delivery, stable messages, atomic rollback, complete rewrite, and fail-closed drift detection).",
);
