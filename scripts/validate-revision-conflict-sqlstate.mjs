import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const read = (...parts) =>
  fs.readFileSync(path.join(root, ...parts), "utf8");

const migration = read(
  "supabase",
  "migrations",
  "202608130002_nonretry_revision_conflicts.sql",
);
const provider = read("src", "cloud", "CloudSyncProvider.tsx");

const expectedFunctions = [
  "assert_account_snapshot_revision",
  "enforce_account_profile_revision",
  "enforce_group_configuration_fence",
  "enforce_group_projection_revision",
  "publish_account_workspace_metadata",
];

const expectedArray = migration.match(
  /expected_functions constant text\[\] := array\[([\s\S]*?)\n\s*\];/i,
)?.[1];
assert.ok(expectedArray, "the migration must declare its complete fence allowlist");
assert.deepEqual(
  [...expectedArray.matchAll(/'([a-z0-9_]+)'/g)].map((match) => match[1]),
  expectedFunctions,
  "the non-retry migration must fail closed if the active fence set drifts",
);

const latestDefinitions = new Map([
  [
    "assert_account_snapshot_revision",
    read(
      "supabase",
      "migrations",
      "202608100004_reduce_revision_fence_pool_pressure.sql",
    ),
  ],
  [
    "enforce_account_profile_revision",
    read(
      "supabase",
      "migrations",
      "202608100003_fix_revision_trigger_dispatch.sql",
    ),
  ],
  [
    "enforce_group_configuration_fence",
    read(
      "supabase",
      "migrations",
      "202608100002_fix_group_configuration_trigger_dispatch.sql",
    ),
  ],
  [
    "enforce_group_projection_revision",
    read(
      "supabase",
      "migrations",
      "202608100003_fix_revision_trigger_dispatch.sql",
    ),
  ],
  [
    "publish_account_workspace_metadata",
    read(
      "supabase",
      "migrations",
      "202608040003_atomic_workspace_metadata.sql",
    ),
  ],
]);

function currentDefinition(source, name) {
  const start = source.lastIndexOf(`create or replace function public.${name}(`);
  assert.notEqual(start, -1, `latest definition for ${name} must exist`);
  const next = source.indexOf("\ncreate or replace function public.", start + 1);
  return source.slice(start, next === -1 ? source.length : next);
}

for (const [name, source] of latestDefinitions) {
  assert.match(
    currentDefinition(source, name),
    /using errcode = '40001'/i,
    `${name} must be one of the legacy retry-class definitions being rewritten`,
  );
}

assert.match(
  migration,
  /pg_catalog\.replace\(\s*target\.function_definition,\s*'''40001''',\s*'''P0001'''\s*\)/i,
  "every allowlisted live function must be rewritten from 40001 to P0001",
);
assert.match(
  migration,
  /if retry_functions is distinct from expected_functions/i,
  "unexpected retry-class functions must abort the migration",
);
assert.match(
  migration,
  /if exists \([\s\S]*pg_catalog\.pg_get_functiondef[\s\S]*'''40001'''[\s\S]*raise exception 'A public function still uses retry-class SQLSTATE 40001'/i,
  "the migration must verify that no public function retains 40001",
);
assert.doesNotMatch(
  migration,
  /return\s+null|exception\s+when/i,
  "revision conflicts must still reject atomically rather than being swallowed",
);
assert.match(
  provider,
  /stale_group_configuration/i,
  "group configuration rebasing must continue to use the stable error message",
);
assert.match(
  provider,
  /stale_group_publish\|40001/i,
  "workspace rebasing must recognize the stable stale_group_publish message after the SQLSTATE changes",
);
const freshnessBody = provider.match(
  /const publishLeaderboardFreshness = useCallback\(async \(\) => \{([\s\S]*?)\n\s*const current = stateRef\.current;/,
)?.[1];
assert.ok(freshnessBody, "the compact group freshness publisher must exist");
assert.match(
  freshnessBody,
  /cloudConflictBackoffActive\(\s*workspaceConflictGateRef\.current,\s*auth\.user\.id,\s*Date\.now\(\)/,
  "periodic freshness writes must honor the same per-account conflict gate as full workspace writes",
);

console.log(
  "Revision-fence validation passed: all five live CAS guards stay fail-closed and migrate from retry-class 40001 to P0001.",
);
