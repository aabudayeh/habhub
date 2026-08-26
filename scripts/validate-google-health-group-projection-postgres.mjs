import assert from "node:assert/strict";
import { PGlite } from "npm:@electric-sql/pglite@0.3.10";

const db = new PGlite();

async function scalar(sql, params = []) {
  const result = await db.query(sql, params);
  const row = result.rows[0];
  return row ? Object.values(row)[0] : undefined;
}

try {
  await db.exec(`
    create role anon;
    create role authenticated;
    create role service_role;
    create schema auth;
    create table auth.test_context (
      singleton boolean primary key default true,
      role_value text,
      user_id uuid
    );
    insert into auth.test_context (singleton, role_value) values (true, 'service_role');
    create function auth.role() returns text language sql stable as
      'select role_value from auth.test_context where singleton';
    create function auth.uid() returns uuid language sql stable as
      'select user_id from auth.test_context where singleton';

    create type public.entry_visibility as enum ('private', 'status', 'group');
    create type public.metric_data_type as enum ('number', 'boolean', 'calculated', 'text', 'photo');

    create table public.user_snapshots (
      user_id uuid primary key,
      payload jsonb not null,
      revision bigint not null,
      device_id text,
      updated_at timestamptz not null default now()
    );
    create table public.group_members (
      group_id uuid not null,
      user_id uuid not null,
      status text not null,
      last_data_synced_at timestamptz,
      primary key (group_id, user_id)
    );
    create table public.metric_definitions (
      id uuid primary key,
      group_id uuid,
      slug text not null,
      aggregation_method text not null,
      data_type public.metric_data_type not null,
      archived_at timestamptz
    );
    create table public.google_health_import_records (
      user_id uuid not null,
      external_id text not null,
      data_type text not null,
      local_date date not null,
      entry_id text not null,
      entry jsonb not null,
      primary key (user_id, external_id, entry_id)
    );
    create table public.metric_entries (
      id bigint generated always as identity primary key,
      client_generated_id text not null,
      metric_id uuid not null,
      user_id uuid not null,
      value jsonb not null,
      local_date date not null,
      recorded_at timestamptz not null,
      visibility public.entry_visibility not null,
      source text not null,
      label text,
      note text,
      nutrition jsonb,
      submetric_values jsonb,
      image_path text,
      source_provider text,
      source_record_id text,
      source_origin text,
      source_updated_at timestamptz,
      account_revision bigint,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now(),
      unique (user_id, client_generated_id)
    );
    create unique index metric_entries_source_record_unique
      on public.metric_entries (user_id, source_provider, source_record_id, metric_id)
      where source_provider is not null and source_record_id is not null;
    create table public.daily_metric_status (
      group_id uuid not null,
      metric_id uuid not null,
      user_id uuid not null,
      local_date date not null,
      goal_reached boolean not null,
      score_contribution numeric not null default 0,
      goal_progress numeric,
      goal_kind text,
      goal_target numeric,
      visibility text,
      goal_eligible boolean not null default true,
      exact_value numeric,
      has_data boolean not null default false,
      privacy_projection_version smallint not null default 1,
      source_provider text,
      account_revision bigint,
      updated_at timestamptz not null default now(),
      primary key (group_id, metric_id, user_id, local_date),
      check (visibility = 'group' or exact_value is null),
      check (score_contribution between 0 and 100),
      check (goal_progress between 0 and 300)
    );
    create table public.metric_entry_tombstones (
      group_id uuid not null,
      user_id uuid not null,
      client_generated_id text not null,
      local_date date not null,
      visibility public.entry_visibility not null,
      deleted_at timestamptz not null,
      primary key (user_id, client_generated_id)
    );
    create table public.metric_privacy_cache_fences (
      group_id uuid not null,
      metric_id uuid not null,
      user_id uuid not null,
      revision bigint not null,
      primary key (group_id, metric_id, user_id)
    );
    create table public.group_activity_versions (
      group_id uuid primary key,
      version bigint not null,
      since_date date not null,
      updated_at timestamptz not null
    );
    create table public.google_health_connections (
      user_id uuid primary key,
      status text not null,
      refresh_token_ciphertext text,
      health_user_id text,
      next_catchup_at timestamptz not null
    );
    create table public.google_health_entry_preferences (
      user_id uuid not null,
      entry_id text not null,
      metric_id text not null,
      data_type text not null,
      source_local_date date not null,
      visibility text,
      dismissed boolean not null default false,
      primary key (user_id, entry_id)
    );
    create function public.mutate_google_health_food_family(
      p_user_id uuid,
      p_entry_id text,
      p_action text,
      p_patch jsonb default '{}'::jsonb
    ) returns jsonb language sql as
      'select jsonb_build_object(''revision'', 1)';
    create function public.update_google_health_metric_visibility(
      p_user_id uuid,
      p_metric_id text,
      p_visibility text
    ) returns jsonb language sql as
      'select jsonb_build_object(''revision'', 1)';
    insert into public.google_health_connections (
      user_id,
      status,
      refresh_token_ciphertext,
      health_user_id,
      next_catchup_at
    ) values (
      '00000000-0000-4000-8000-000000000001',
      'connected',
      'encrypted-test-token',
      'health-user-1',
      now() + interval '7 days'
    );
  `);

  await db.exec(await Deno.readTextFile(
    "supabase/migrations/202608240007_google_health_group_projection.sql",
  ));
  await db.exec(await Deno.readTextFile(
    "supabase/migrations/202608240008_conditional_daily_status_upserts.sql",
  ));
  await db.exec(await Deno.readTextFile(
    "supabase/migrations/202608260002_google_health_workout_detail_projection.sql",
  ));

  assert.equal(
    await scalar(`
      select next_catchup_at <= now()
        from public.google_health_connections
       where user_id = '00000000-0000-4000-8000-000000000001'
    `),
    true,
    "the projection upgrade must queue connected accounts through the bounded catch-up worker",
  );

  const userId = "00000000-0000-4000-8000-000000000001";
  const activeGroup = "00000000-0000-4000-8000-000000000101";
  const secondActiveGroup = "00000000-0000-4000-8000-000000000102";
  const inactiveGroup = "00000000-0000-4000-8000-000000000103";
  const ids = {
    steps: "00000000-0000-4000-8000-000000001001",
    food: "00000000-0000-4000-8000-000000001002",
    workout: "00000000-0000-4000-8000-000000001003",
    exercise: "00000000-0000-4000-8000-000000001004",
    water: "00000000-0000-4000-8000-000000001005",
    unrelated: "00000000-0000-4000-8000-000000001006",
    workoutDuration: "00000000-0000-4000-8000-000000001007",
    workoutDistance: "00000000-0000-4000-8000-000000001008",
    secondSteps: "00000000-0000-4000-8000-000000002001",
    secondFood: "00000000-0000-4000-8000-000000002002",
    secondWorkout: "00000000-0000-4000-8000-000000002003",
    secondExercise: "00000000-0000-4000-8000-000000002004",
    secondWater: "00000000-0000-4000-8000-000000002005",
    inactiveSteps: "00000000-0000-4000-8000-000000003001",
  };
  const day = "2026-08-24";
  const entry = (input) => ({
    userId,
    localDate: day,
    source: "imported",
    recordedAt: `${day}T12:00:00.000Z`,
    sourceUpdatedAt: `${day}T12:00:00.000Z`,
    ...input,
  });
  const entries = [
    entry({
      id: "google-health:steps:steps",
      metricId: "steps",
      value: 500,
      visibility: "group",
      sourceProvider: "google_health",
      sourceRecordId: `aggregate:steps:${day}`,
      sourceOrigin: "Google Health API",
    }),
    entry({
      id: "native-health-connect-steps",
      metricId: "steps",
      value: 625,
      visibility: "group",
      sourceProvider: "health_connect",
      sourceRecordId: `aggregate:steps:${day}:native`,
      sourceOrigin: "Samsung Health",
      sourceUpdatedAt: `${day}T13:00:00.000Z`,
    }),
    entry({
      id: "google-health:food:food",
      metricId: "food",
      value: 400,
      visibility: "group",
      label: "Breakfast bowl",
      note: "Oats · Synced from Google Health",
      nutrition: { proteinG: 20, fiberG: 8 },
      sourceProvider: "google_health",
      sourceRecordId: "google-health:nutrition:breakfast",
      sourceOrigin: "MyFitnessPal via Google Health",
    }),
    entry({
      id: "google-health:workout:workout",
      metricId: "workout",
      value: true,
      visibility: "private",
      label: "Private walk",
      submetricValues: { exercise: 77 },
      sourceProvider: "google_health",
      sourceRecordId: "google-health:exercise:private-walk",
      sourceOrigin: "Google Health API",
    }),
    entry({
      id: "google-health:workout:workout-visible",
      metricId: "workout",
      value: true,
      visibility: "group",
      label: "Morning walk",
      note: "Synced from Google Health",
      submetricValues: { exercise: 100 },
      sourceProvider: "google_health",
      sourceRecordId: "google-health:exercise:morning-walk",
      sourceOrigin: "Samsung Health via Google Health",
    }),
    entry({
      id: "google-health:workout:dismissed-carrier",
      metricId: "workout",
      value: true,
      visibility: "group",
      label: "Dismissed calorie carrier",
      submetricValues: { exercise: 66 },
      sourceProvider: "google_health",
      sourceRecordId: "google-health:exercise:dismissed-carrier",
      sourceOrigin: "Google Health API",
    }),
    entry({
      id: "google-health:energy:exercise",
      metricId: "exercise",
      value: 100,
      visibility: "group",
      label: "Morning walk",
      sourceProvider: "google_health",
      sourceRecordId: "google-health:exercise:morning-walk",
      sourceOrigin: "Google Health API",
    }),
    entry({
      id: "google-health:energy:passive-step-estimate",
      metricId: "exercise",
      value: 25,
      visibility: "group",
      source: "calculated",
      label: "Estimated unrecorded walking from steps",
      sourceProvider: "google_health",
      sourceRecordId: `google-health:passive-step-estimate:${day}`,
      sourceOrigin: "HabHub",
    }),
    entry({
      id: "google-health:workout-duration:morning-walk",
      metricId: "workout_duration",
      value: 42,
      visibility: "group",
      label: "Morning walk",
      sourceProvider: "google_health",
      sourceRecordId: "google-health:exercise:morning-walk",
      sourceOrigin: "Samsung Health via Google Health",
    }),
    entry({
      id: "google-health:workout-distance:morning-walk",
      metricId: "workout_distance",
      value: 3.4,
      visibility: "group",
      label: "Morning walk",
      sourceProvider: "google_health",
      sourceRecordId: "google-health:exercise:morning-walk",
      sourceOrigin: "Samsung Health via Google Health",
    }),
    entry({
      id: "google-health:workout-duration:private-copy",
      metricId: "workout_duration",
      value: 999,
      visibility: "private",
      label: "Morning walk",
      sourceProvider: "google_health",
      sourceRecordId: "google-health:exercise:morning-walk",
      sourceOrigin: "Google Health API",
    }),
    entry({
      id: "google-health:workout-distance:different-workout",
      metricId: "workout_distance",
      value: 88,
      visibility: "group",
      label: "Different workout",
      sourceProvider: "google_health",
      sourceRecordId: "google-health:exercise:different-workout",
      sourceOrigin: "Google Health API",
    }),
    {
      id: "manual-energy",
      metricId: "exercise",
      userId,
      value: 50,
      localDate: day,
      recordedAt: `${day}T14:00:00.000Z`,
      visibility: "group",
      source: "manual",
    },
    entry({
      id: "google-health:water:water",
      metricId: "water",
      value: 2,
      visibility: "status",
      sourceProvider: "google_health",
      sourceRecordId: "google-health:water:two",
      sourceOrigin: "Google Health API",
    }),
    {
      id: "manual-water",
      metricId: "water",
      userId,
      value: 1,
      localDate: day,
      recordedAt: `${day}T14:00:00.000Z`,
      visibility: "status",
      source: "manual",
    },
    {
      id: "unrelated-native-sleep",
      metricId: "unrelated",
      userId,
      value: 8,
      localDate: "2026-08-23",
      recordedAt: "2026-08-23T08:00:00.000Z",
      visibility: "group",
      source: "imported",
      sourceProvider: "health_connect",
      sourceRecordId: "native-unrelated",
    },
  ];
  const metrics = [
    { id: "steps", unit: "steps", goal: { kind: "at_least", target: 1000 }, sections: { today: true }, activeFrom: day },
    { id: "food", unit: "kcal", goal: { kind: "at_most", target: 2000 }, sections: { today: true }, activeFrom: day },
    { id: "workout", unit: "", goal: { kind: "complete", target: 1 }, sections: { today: true }, activeFrom: day },
    { id: "exercise", unit: "kcal", defaultVisibility: "group", goal: { kind: "at_least", target: 300 }, sections: { today: true }, activeFrom: day },
    { id: "water", unit: "cups", goal: { kind: "at_least", target: 8 }, sections: { today: true }, activeFrom: day },
    { id: "unrelated", unit: "hr", goal: { kind: "at_least", target: 8 }, sections: { today: true }, activeFrom: day },
    { id: "workout_duration", unit: "min", goal: { kind: "at_least", target: 30 }, sections: { today: true }, activeFrom: day },
    { id: "workout_distance", unit: "km", goal: { kind: "at_least", target: 3 }, sections: { today: true }, activeFrom: day },
  ];
  await db.query(
    "insert into public.user_snapshots (user_id, payload, revision) values ($1, $2, 1)",
    [userId, JSON.stringify({ entries, metrics, trackedGoalPeriods: {} })],
  );
  await db.query(
    `insert into public.group_members (group_id, user_id, status) values
      ($1, $4, 'active'), ($2, $4, 'active'), ($3, $4, 'pending')`,
    [activeGroup, secondActiveGroup, inactiveGroup, userId],
  );
  const definitions = [
    [ids.steps, activeGroup, "steps", "sum", "number"],
    [ids.food, activeGroup, "food", "sum", "number"],
    [ids.workout, activeGroup, "workout", "sum", "boolean"],
    [ids.exercise, activeGroup, "exercise", "sum", "number"],
    [ids.water, activeGroup, "water", "sum", "number"],
    [ids.unrelated, activeGroup, "unrelated", "latest", "number"],
    [ids.workoutDuration, activeGroup, "workout_duration", "sum", "number"],
    [ids.workoutDistance, activeGroup, "workout_distance", "sum", "number"],
    [ids.secondSteps, secondActiveGroup, "steps", "sum", "number"],
    [ids.secondFood, secondActiveGroup, "food", "sum", "number"],
    [ids.secondWorkout, secondActiveGroup, "workout", "sum", "boolean"],
    [ids.secondExercise, secondActiveGroup, "exercise", "sum", "number"],
    [ids.secondWater, secondActiveGroup, "water", "sum", "number"],
    [ids.inactiveSteps, inactiveGroup, "steps", "sum", "number"],
  ];
  for (const definition of definitions) {
    await db.query(
      `insert into public.metric_definitions
        (id, group_id, slug, aggregation_method, data_type)
       values ($1, $2, $3, $4, $5::public.metric_data_type)`,
      definition,
    );
  }
  const ownedEntries = entries.filter((candidate) =>
    String(candidate.id).startsWith("google-health:")
  );
  for (const [index, ownedEntry] of ownedEntries.entries()) {
    await db.query(
      `insert into public.google_health_import_records
        (user_id, external_id, data_type, local_date, entry_id, entry)
       values ($1, $2, $3, $4, $5, $6)`,
      [
        userId,
        `external-${index}`,
        String(ownedEntry.metricId),
        day,
        String(ownedEntry.id),
        JSON.stringify(ownedEntry),
      ],
    );
  }
  await db.query(
    `insert into public.google_health_entry_preferences
      (user_id, entry_id, metric_id, data_type, source_local_date, dismissed)
     values ($1, 'google-health:exercise:dismissed-carrier:exercise',
       'exercise', 'workouts', $2, true)`,
    [userId, day],
  );

  await db.query(
    `insert into public.metric_entries
      (client_generated_id, metric_id, user_id, value, local_date, recorded_at,
       visibility, source, source_provider, source_record_id, account_revision)
     values
      ('native-relational-row', $1, $3, '625', $4, $4::date, 'group', 'imported',
       'health_connect', 'native-relational-source', 1),
      ('google-health-group:lookalike-native', $2, $3, '7', $4, $4::date,
       'group', 'imported', 'health_connect', 'lookalike-native-source', 1),
      ('stale-client-private-google', $5, $3, 'true', $4, $4::date,
       'group', 'imported', 'google_health', 'google-health:exercise:private-walk', 1)`,
    [ids.steps, ids.unrelated, userId, day, ids.workout],
  );
  await db.query(
    `insert into public.metric_entries
      (client_generated_id, metric_id, user_id, value, local_date, recorded_at,
       visibility, source, submetric_values, source_provider, source_record_id,
       account_revision)
     values ('native-workout-linked-leak', $1, $2, 'true', $3, $3::date,
       'group', 'imported', '{"exercise":900,"workout_duration":99}',
       'health_connect', 'native-workout-linked-leak', 1)`,
    [ids.workout, userId, day],
  );
  await db.query(
    `insert into public.daily_metric_status
      (group_id, metric_id, user_id, local_date, goal_reached,
       score_contribution, goal_progress, goal_kind, goal_target, visibility,
       exact_value, has_data, privacy_projection_version, source_provider,
       account_revision)
     values ($1, $2, $3, '2026-08-23', true, 100, 100, 'at_least', 8,
       'group', 8, true, 2, null, 1)`,
    [activeGroup, ids.unrelated, userId],
  );
  await db.query(
    `insert into public.metric_privacy_cache_fences
      (group_id, metric_id, user_id, revision) values ($1, $2, $3, 1)`,
    [activeGroup, ids.steps, userId],
  );

  const projected = await db.query(
    "select * from public.project_google_health_group_data($1, 1)",
    [userId],
  );
  assert.equal(projected.rows.length, 1);
  assert.equal(
    Number(await scalar(
      "select revision from public.user_snapshots where user_id = $1",
      [userId],
    )),
    2,
    "an exact re-share must be causally newer than an existing privacy fence",
  );
  assert.equal(
    Number(await scalar(
      `select account_revision from public.daily_metric_status
        where group_id = $1 and metric_id = $2 and local_date = $3`,
      [activeGroup, ids.steps, day],
    )),
    2,
    "server statuses must carry the authoritative account revision",
  );

  assert.equal(
    Number(await scalar(
      `select exact_value from public.daily_metric_status
        where group_id = $1 and metric_id = $2 and local_date = $3`,
      [activeGroup, ids.steps, day],
    )),
    625,
    "the fresher native canonical Steps total must outrank Google",
  );
  assert.equal(
    await scalar(
      `select source_provider from public.daily_metric_status
        where group_id = $1 and metric_id = $2 and local_date = $3`,
      [activeGroup, ids.steps, day],
    ),
    null,
    "a stale Google Steps fallback must not claim native-owned projection authority",
  );
  assert.equal(
    Number(await scalar(
      `select exact_value from public.daily_metric_status
        where group_id = $1 and metric_id = $2 and local_date = $3`,
      [activeGroup, ids.exercise, day],
    )),
    175,
    "manual and Google group-visible values must remain combined",
  );
  assert.equal(
    Number(await scalar(
      `select count(*) from public.metric_entries
        where user_id = $1 and client_generated_id = 'native-relational-row'`,
      [userId],
    )),
    1,
    "projection cleanup must preserve native relational rows",
  );
  assert.equal(
    Number(await scalar(
      `select count(*) from public.metric_entries
        where user_id = $1 and client_generated_id = 'google-health-group:lookalike-native'`,
      [userId],
    )),
    1,
    "the server id namespace alone must never make a non-Google row deletable",
  );
  assert.equal(
    Number(await scalar(
      `select count(*) from public.daily_metric_status
        where group_id = $1 and metric_id = $2 and local_date = '2026-08-23'`,
      [activeGroup, ids.unrelated],
    )),
    1,
    "a metric/date with no Google ownership must remain untouched",
  );
  assert.equal(
    Number(await scalar(
      `select count(*) from public.daily_metric_status
        where group_id = $1`,
      [inactiveGroup],
    )),
    0,
    "pending/inactive group memberships must not receive projections",
  );

  const statusOnly = (await db.query(
    `select visibility, exact_value, goal_target, score_contribution, goal_progress
       from public.daily_metric_status
      where group_id = $1 and metric_id = $2 and local_date = $3`,
    [activeGroup, ids.water, day],
  )).rows[0];
  assert.equal(statusOnly.visibility, "status");
  assert.equal(statusOnly.exact_value, null);
  assert.equal(statusOnly.goal_target, null);
  assert.equal(Number(statusOnly.score_contribution) % 25, 0);
  assert.equal(Number(statusOnly.goal_progress) % 25, 0);

  const rawFood = (await db.query(
    `select visibility, label, nutrition, source_provider, source_record_id,
            source_origin, source_updated_at
       from public.metric_entries
      where user_id = $1 and metric_id = $2 and source_provider = 'google_health'`,
    [userId, ids.food],
  )).rows[0];
  assert.equal(rawFood.visibility, "group");
  assert.equal(rawFood.label, "Breakfast bowl");
  assert.deepEqual(rawFood.nutrition, { fiberG: 8, proteinG: 20 });
  assert.equal(rawFood.source_provider, "google_health");
  assert.equal(rawFood.source_record_id, "google-health:nutrition:breakfast");
  assert.equal(rawFood.source_origin, "MyFitnessPal via Google Health");
  assert.ok(rawFood.source_updated_at);
  assert.equal(
    Number(await scalar(
      `select count(*) from public.metric_entries
        where user_id = $1 and metric_id in ($2, $3)
          and source_provider = 'google_health'
          and source_record_id = 'google-health:exercise:private-walk'`,
      [userId, ids.workout, ids.secondWorkout],
    )),
    0,
    "private workout detail must not create a relational group row",
  );
  const rawWorkout = (await db.query(
    `select visibility, label, source_record_id, source_origin, submetric_values
       from public.metric_entries
      where user_id = $1 and metric_id = $2
        and source_record_id = 'google-health:exercise:morning-walk'`,
    [userId, ids.workout],
  )).rows[0];
  assert.equal(rawWorkout.visibility, "group");
  assert.equal(rawWorkout.label, "Morning walk");
  assert.equal(rawWorkout.source_record_id, "google-health:exercise:morning-walk");
  assert.equal(rawWorkout.source_origin, "Samsung Health via Google Health");
  assert.deepEqual(
    rawWorkout.submetric_values,
    null,
    "a shared Workout parent must never inherit linked tracker values under its own RLS visibility",
  );
  const workoutSidecars = (await db.query(
    `select definition.slug, entry.label, entry.value
       from public.metric_entries entry
       join public.metric_definitions definition on definition.id = entry.metric_id
      where entry.user_id = $1
        and definition.group_id = $2
        and definition.slug in ('exercise', 'workout_duration', 'workout_distance')
        and entry.source_provider = 'google_health'
      order by definition.slug, entry.label`,
    [userId, activeGroup],
  )).rows;
  assert.deepEqual(
    workoutSidecars.map((row) => [row.slug, row.label, Number(row.value)]),
    [
      ["exercise", "Morning walk", 100],
      ["exercise", "Workout energy", 77],
      ["workout_distance", "Different workout", 88],
      ["workout_distance", "Morning walk", 3.4],
      ["workout_duration", "Morning walk", 42],
    ],
    "each authorized named workout detail must use its own destination tracker while passive step estimates stay compact",
  );
  assert.equal(
    Number(await scalar(
      `select count(*) from public.metric_entries
        where user_id = $1
          and source_record_id = 'google-health:exercise:dismissed-carrier'
          and metric_id = $2`,
      [userId, ids.exercise],
    )),
    0,
    "a dismissed same-source Active energy detail must not resurrect from the private Workout carrier",
  );
  assert.equal(
    await scalar(
      `select submetric_values from public.metric_entries
        where user_id = $1 and client_generated_id = 'native-workout-linked-leak'`,
      [userId],
    ),
    null,
    "the database trigger must strip linked tracker values from native shared Workout parents",
  );
  assert.equal(
    Number(await scalar(
      `select count(*)
         from public.metric_entries entry
         join public.metric_definitions definition on definition.id = entry.metric_id
        where entry.user_id = $1
          and definition.group_id = $2
          and definition.slug in ('workout_duration', 'workout_distance')`,
      [userId, secondActiveGroup],
    )),
    0,
    "a group without a linked tracker definition must not receive that workout detail",
  );
  assert.equal(
    Number(await scalar(
      `select count(*) from public.metric_entry_tombstones
        where user_id = $1 and client_generated_id = 'stale-client-private-google'`,
      [userId],
    )),
    1,
    "withdrawing group detail must emit a peer-visible deletion tombstone",
  );
  assert.equal(
    Number(await scalar(
      `select count(distinct group_id) from public.daily_metric_status
        where user_id = $1 and metric_id in ($2, $3)`,
      [userId, ids.steps, ids.secondSteps],
    )),
    2,
    "personal metric slugs must map into every active group definition",
  );
  assert.equal(
    Number(await scalar("select count(*) from public.group_activity_versions")),
    2,
    "each changed active group must receive one activity-version bump",
  );

  await db.query(
    `update public.user_snapshots
        set payload = jsonb_set(
          payload,
          '{entries}',
          (
            select jsonb_agg(item)
              from jsonb_array_elements(payload -> 'entries') item
             where item ->> 'id' not in (
               'google-health:energy:exercise',
               'google-health:energy:passive-step-estimate'
             )
          )
        ),
            revision = 3
      where user_id = $1`,
    [userId],
  );
  await db.query(
    `delete from public.google_health_import_records
      where user_id = $1 and entry_id in (
        'google-health:energy:exercise',
        'google-health:energy:passive-step-estimate'
      )`,
    [userId],
  );
  await db.query(
    `delete from public.daily_metric_status
      where user_id = $1 and metric_id in ($2, $3)`,
    [userId, ids.exercise, ids.secondExercise],
  );
  for (const [groupId, metricId] of [
    [activeGroup, ids.exercise],
    [secondActiveGroup, ids.secondExercise],
  ]) {
    await db.query(
      `insert into public.metric_privacy_cache_fences
        (group_id, metric_id, user_id, revision) values ($1, $2, $3, 3)
        on conflict (group_id, metric_id, user_id) do update
          set revision = excluded.revision`,
      [groupId, metricId, userId],
    );
  }
  await db.query(
    "select * from public.project_google_health_group_data($1, 3)",
    [userId],
  );
  const exerciseFallback = (await db.query(
    `select exact_value, source_provider
       from public.daily_metric_status
      where group_id = $1 and metric_id = $2 and local_date = $3`,
    [activeGroup, ids.exercise, day],
  )).rows[0];
  assert.equal(
    Number(exerciseFallback.exact_value),
    50,
    "deleting the last Google contribution must retain the remaining manual aggregate",
  );
  assert.equal(
    exerciseFallback.source_provider,
    null,
    "a post-delete manual fallback must no longer claim Google provenance",
  );

  const statusRow = async (metricId) => (await db.query(
    `select group_id, metric_id, user_id, local_date, goal_reached,
            score_contribution, goal_progress, goal_kind, goal_target,
            visibility, goal_eligible, exact_value, has_data, account_revision,
            privacy_projection_version, source_provider
       from public.daily_metric_status
      where group_id = $1 and metric_id = $2 and local_date = $3`,
    [activeGroup, metricId, day],
  )).rows[0];
  const unchangedFood = await statusRow(ids.food);
  const noFenceChanges = await scalar(
    "select public.upsert_daily_metric_status_rows_if_changed($1::jsonb)",
    [JSON.stringify([{ ...unchangedFood, account_revision: 5 }])],
  );
  assert.equal(
    Number(noFenceChanges),
    0,
    "an ordinary revision-only status publish must remain a no-op",
  );
  assert.equal(
    Number((await statusRow(ids.food)).account_revision),
    4,
    "an ordinary no-op must preserve the stored revision",
  );

  const unchangedExercise = await statusRow(ids.exercise);
  await db.query(
    `insert into public.metric_privacy_cache_fences
      (group_id, metric_id, user_id, revision) values ($1, $2, $3, 4)
      on conflict (group_id, metric_id, user_id) do update set revision = excluded.revision`,
    [activeGroup, ids.exercise, userId],
  );
  const reShareChanges = await scalar(
    "select public.upsert_daily_metric_status_rows_if_changed($1::jsonb)",
    [JSON.stringify([{ ...unchangedExercise, account_revision: 5 }])],
  );
  assert.equal(
    Number(reShareChanges),
    1,
    "a revision-only exact re-share must cross its older privacy fence",
  );
  assert.equal(
    Number((await statusRow(ids.exercise)).account_revision),
    5,
    "the re-shared status must become causally newer than the privacy fence",
  );

  const serverFoodId = String(await scalar(
    `select client_generated_id from public.metric_entries
      where user_id = $1 and metric_id = $2 and source_record_id = $3`,
    [userId, ids.secondFood, "google-health:nutrition:breakfast"],
  ));
  assert.ok(serverFoodId.startsWith("google-health-group:"));
  await db.query(
    "update auth.test_context set role_value = 'authenticated', user_id = $1 where singleton",
    [userId],
  );
  const versionBeforeFreshness = Number(await scalar(
    "select coalesce(sum(version), 0) from public.group_activity_versions",
  ));
  const firstFreshness = String(await scalar(
    "select public.touch_group_member_data_freshness($1)",
    [activeGroup],
  ));
  const secondFreshness = String(await scalar(
    "select public.touch_group_member_data_freshness($1)",
    [activeGroup],
  ));
  assert.equal(
    secondFreshness,
    firstFreshness,
    "rapid freshness retries must reuse the server-rate-limited stamp",
  );
  assert.equal(
    Number(await scalar(
      "select coalesce(sum(version), 0) from public.group_activity_versions",
    )),
    versionBeforeFreshness,
    "a freshness-only publish must not bump shared activity versions",
  );
  let pendingFreshnessRejected = false;
  try {
    await db.query("select public.touch_group_member_data_freshness($1)", [inactiveGroup]);
  } catch (error) {
    pendingFreshnessRejected = /group_membership_required/.test(String(error));
  }
  assert.equal(
    pendingFreshnessRejected,
    true,
    "pending members must not stamp group data freshness",
  );
  await db.query(
    `insert into public.metric_entries
      (client_generated_id, metric_id, user_id, value, local_date, recorded_at,
       visibility, source, label, nutrition, source_provider, source_record_id,
       source_origin, source_updated_at, account_revision)
     values ('client-stable-food-id', $1, $2, '400', $3, $3::date, 'group',
       'imported', 'Breakfast bowl', '{"proteinG":20}', 'google_health',
       'google-health:nutrition:breakfast', 'Google Health API', $3::date, 2)`,
    [ids.secondFood, userId, day],
  );
  assert.equal(
    Number(await scalar(
      `select count(*) from public.metric_entries
        where user_id = $1 and metric_id = $2 and source_record_id = $3`,
      [userId, ids.secondFood, "google-health:nutrition:breakfast"],
    )),
    1,
    "client handoff must replace only the matching server projection",
  );
  assert.equal(
    Number(await scalar(
      `select count(*) from public.metric_entry_tombstones
        where user_id = $1 and client_generated_id = $2`,
      [userId, serverFoodId],
    )),
    1,
    "client handoff must tombstone the superseded server id for offline peers",
  );
  assert.equal(
    Number(await scalar(
      `select count(*) from public.metric_entries
        where user_id = $1 and client_generated_id = 'google-health-group:lookalike-native'`,
      [userId],
    )),
    1,
    "source-id handoff must not delete an unrelated row",
  );

  let unauthorized = false;
  try {
    await db.query("select * from public.project_google_health_group_data($1, 1)", [userId]);
  } catch (error) {
    unauthorized = /google_health_service_role_required/.test(String(error));
  }
  assert.equal(unauthorized, true, "authenticated callers must not execute the projector");

  console.log(
    "Google Health group projection validated in PostgreSQL 17: authority, containment, handoff, revision, and active-group mapping passed.",
  );
} finally {
  await db.close();
}
