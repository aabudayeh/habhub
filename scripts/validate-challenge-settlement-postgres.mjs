import { PGlite } from "npm:@electric-sql/pglite@0.3.10";

const root = new URL("../", import.meta.url);
const read = (relativePath) =>
  Deno.readTextFile(new URL(relativePath, root));

function requiredSlice(source, startMarker, endMarker, label) {
  const start = source.indexOf(startMarker);
  if (start < 0) throw new Error(`${label}: start marker not found`);
  const end = source.indexOf(endMarker, start);
  if (end < 0) throw new Error(`${label}: end marker not found`);
  return source.slice(start, end + endMarker.length);
}

function migrationBlockAfter(source, marker, label) {
  const markerIndex = source.indexOf(marker);
  if (markerIndex < 0) throw new Error(`${label}: marker not found`);
  const start = source.indexOf("do $migration$", markerIndex);
  if (start < 0) throw new Error(`${label}: migration block not found`);
  const endMarker = "$migration$;";
  const end = source.indexOf(endMarker, start);
  if (end < 0) throw new Error(`${label}: migration block end not found`);
  return source.slice(start, end + endMarker.length);
}

function assertMatch(source, pattern, message) {
  if (!pattern.test(source)) throw new Error(message);
}

const [periodMigration, publicMigration, rankMigration] = await Promise.all([
  read("supabase/migrations/202608220006_group_challenge_periods_and_notifications.sql"),
  read("supabase/migrations/202608270002_public_challenges_and_sync_settlement.sql"),
  read("supabase/migrations/202608270005_challenge_rank_rewards.sql"),
]);

const installedWorker = requiredSlice(
  periodMigration,
  "create or replace function public.stage_group_challenge_notifications(",
  "$$;",
  "base challenge worker",
);
const publicSettlementPatch = migrationBlockAfter(
  publicMigration,
  "-- Patch the installed worker conservatively:",
  "public settlement patch",
);
const resultNotificationPatch = migrationBlockAfter(
  rankMigration,
  "-- Preserve all existing notification-worker privacy and settlement rules",
  "result notification patch",
);
const occurrenceSettlementPatch = migrationBlockAfter(
  rankMigration,
  "-- Make the installed settlement worker use the same occurrence-scoped roster",
  "occurrence settlement patch",
);
const scalableWorkerPatch = migrationBlockAfter(
  rankMigration,
  "-- Public challenges may contain thousands of accepted participants.",
  "scalable worker patch",
);

const db = new PGlite();
await db.exec(`
  set check_function_bodies = off;
  create table public.group_challenge_notification_state (
    challenge_id uuid not null,
    occurrence_date date not null,
    recipient_id uuid not null,
    last_leader_id uuid,
    last_standing_at timestamptz,
    last_reminder_at timestamptz,
    result_notified_at timestamptz,
    updated_at timestamptz,
    primary key (challenge_id, occurrence_date, recipient_id)
  );
`);
await db.exec(installedWorker);
await db.exec(publicSettlementPatch);
await db.exec(resultNotificationPatch);
await db.exec(occurrenceSettlementPatch);
await db.exec(scalableWorkerPatch);

const result = await db.query(`
  select pg_catalog.pg_get_functiondef(
    'public.stage_group_challenge_notifications(integer)'::regprocedure
  ) as definition
`);
const definition = String(result.rows[0]?.definition ?? "");

assertMatch(
  definition,
  /left join public\.user_snapshots current_snapshot[\s\S]{0,180}current_snapshot\.user_id = accepted\.user_id/i,
  "The installed worker did not retain the current-snapshot join.",
);
assertMatch(
  definition,
  /challenge_projection\.synced_at[\s\S]{0,300}occurrence_end_date \+ 1[\s\S]{0,500}challenge_projection\.source_updated_at =\s*current_snapshot\.updated_at/i,
  "The installed worker can settle without a post-deadline current-revision projection.",
);
const revisionChecks = definition.match(
  /challenge_projection\.source_updated_at =\s*current_snapshot\.updated_at/gi,
) ?? [];
if (revisionChecks.length !== 2)
  throw new Error(
    `Expected matching readiness predicates for settlement and waiting names; found ${revisionChecks.length}.`,
  );
assertMatch(
  definition,
  /string_agg\([\s\S]{0,900}filter \(where\s+not \([\s\S]{0,1200}challenge_projection\.source_updated_at =\s*current_snapshot\.updated_at/i,
  "Waiting participant names do not use the settlement readiness predicate.",
);
if (/public_challenge_participant_syncs/i.test(definition))
  throw new Error("The installed worker still uses challenge-wide sync markers.");

console.log(
  "Challenge settlement PostgreSQL validation passed: occurrence marker, post-deadline attempt, current snapshot revision, waiting parity, and scalable worker rewrite.",
);
