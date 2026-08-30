import assert from "node:assert/strict";
import fs from "node:fs";
import { performance } from "node:perf_hooks";

import {
  mergeGroupActivityEntries,
  mergeGroupActivityStatuses,
} from "../src/domain/groupActivityMerge.ts";

const leaderboard = fs.readFileSync("app/(tabs)/group.tsx", "utf8");
const cloudProvider = fs.readFileSync(
  "src/cloud/CloudSyncProvider.tsx",
  "utf8",
);

assert.match(
  leaderboard,
  /Platform\.OS === "web" \|\| !leaderboardUsesPages[\s\S]{0,900}const mountedPages = new Set/,
  "native paged Leaderboard must bound ranking projection to mounted pages without changing Web",
);
assert.match(
  leaderboard,
  /for \(const id of rankingMetricIds\)[\s\S]{0,180}leaderboardRows\(/,
  "hidden native pages must not eagerly calculate ranking rows",
);
assert.match(
  leaderboard,
  /onPageChange=\{handleLeaderboardPageChange\}/,
  "the pager must use a stable page callback instead of retriggering effects on every parent render",
);
assert.match(
  leaderboard,
  /const cloud = useCloudSyncActions\(\);/,
  "Leaderboard must subscribe to stable cloud commands instead of the full sync context",
);
assert.doesNotMatch(
  leaderboard,
  /\buseCloudSync\(\)/,
  "background cloud timestamp/retry changes must not redraw the Leaderboard through the full sync context",
);

const authorizedPersistence = cloudProvider.slice(
  cloudProvider.indexOf("const persistAuthorizedActivity = async () =>"),
  cloudProvider.indexOf(
    "const mustPersistBeforeSettle",
    cloudProvider.indexOf("const persistAuthorizedActivity = async () =>"),
  ),
);
assert.ok(authorizedPersistence.length > 0);
assert.ok(
  authorizedPersistence.indexOf("await waitForCloudCacheWriteTurn()") <
    authorizedPersistence.indexOf("cachedGroupActivity(next, groupId)"),
  "native friend-cache projection must wait until the touch-aware maintenance lane",
);

const backgroundHydration = cloudProvider.slice(
  cloudProvider.indexOf("const hydrateGroupInBackground"),
  cloudProvider.indexOf(
    "const switchGroup",
    cloudProvider.indexOf("const hydrateGroupInBackground"),
  ),
);
assert.match(
  backgroundHydration,
  /scheduleResponsiveWork\(\(\) => \{[\s\S]{0,900}const cachePayload = cachedGroupActivity\(next, groupId\)/,
  "group-switch cache projection must be created inside, not before, its quiet task",
);

const entry = (index) => ({
  id: `entry-${index}`,
  metricId: index % 2 ? "steps" : "food",
  userId: "peer",
  value: index,
  localDate: "2026-08-30",
  recordedAt: `2026-08-30T${String(Math.floor(index / 3600) % 24).padStart(2, "0")}:${String(Math.floor(index / 60) % 60).padStart(2, "0")}:${String(index % 60).padStart(2, "0")}.000Z`,
  visibility: "group",
  source: "imported",
  sourceUpdatedAt: "2026-08-30T12:00:00.000Z",
});
const cachedEntries = Array.from({ length: 50_000 }, (_, index) => entry(index));
const repeatedEntries = cachedEntries
  .slice(49_000)
  .map((item) => ({ ...item }));
const firstEntryStartedAt = performance.now();
const unchangedEntries = mergeGroupActivityEntries(
  cachedEntries,
  repeatedEntries,
  "owner",
);
const firstEntryMs = performance.now() - firstEntryStartedAt;
assert.equal(
  unchangedEntries,
  cachedEntries,
  "an identical realtime range must preserve the full entry-array identity",
);
const cachedEntryStartedAt = performance.now();
mergeGroupActivityEntries(cachedEntries, repeatedEntries, "owner");
const cachedEntryMs = performance.now() - cachedEntryStartedAt;
const changedEntryStartedAt = performance.now();
const changedEntries = mergeGroupActivityEntries(
  cachedEntries,
  [
    {
      ...repeatedEntries.at(-1),
      value: 99_999,
      sourceUpdatedAt: "2026-08-30T12:01:00.000Z",
    },
  ],
  "owner",
);
const changedEntryMs = performance.now() - changedEntryStartedAt;
assert.notEqual(changedEntries, cachedEntries);
assert.equal(changedEntries.length, cachedEntries.length);
assert.equal(changedEntries.at(-1)?.value, 99_999);

const cachedStatuses = Array.from({ length: 50_000 }, (_, index) => ({
  groupId: "group",
  metricId: index % 2 ? "steps" : "food",
  userId: `peer-${index % 50}`,
  localDate: `2026-08-${String((index % 28) + 1).padStart(2, "0")}-${index}`,
  goalReached: index % 2 === 0,
  scoreContribution: index % 100,
  visibility: "group",
  syncedAt: "2026-08-30T12:00:00.000Z",
}));
const repeatedStatuses = cachedStatuses
  .slice(49_000)
  .map((item) => ({ ...item }));
const firstStatusStartedAt = performance.now();
const unchangedStatuses = mergeGroupActivityStatuses(
  cachedStatuses,
  repeatedStatuses,
);
const firstStatusMs = performance.now() - firstStatusStartedAt;
assert.equal(
  unchangedStatuses,
  cachedStatuses,
  "an identical realtime range must preserve the full status-array identity",
);
const cachedStatusStartedAt = performance.now();
mergeGroupActivityStatuses(cachedStatuses, repeatedStatuses);
const cachedStatusMs = performance.now() - cachedStatusStartedAt;

assert.ok(
  firstEntryMs < 500,
  `first 50k entry index + 1k-row no-op merge took ${firstEntryMs.toFixed(1)}ms`,
);
assert.ok(
  cachedEntryMs < 80,
  `indexed 1k-row no-op entry merge took ${cachedEntryMs.toFixed(1)}ms`,
);
assert.ok(
  changedEntryMs < 25,
  `indexed one-row entry delta took ${changedEntryMs.toFixed(1)}ms`,
);
assert.ok(
  firstStatusMs < 500,
  `first 50k status index + 1k-row no-op merge took ${firstStatusMs.toFixed(1)}ms`,
);
assert.ok(
  cachedStatusMs < 80,
  `indexed 1k-row no-op status merge took ${cachedStatusMs.toFixed(1)}ms`,
);

console.log(
  `Native Leaderboard performance validation passed (50k cache + 1k repeated rows: entries ${firstEntryMs.toFixed(1)}ms first/${cachedEntryMs.toFixed(1)}ms indexed; one entry delta ${changedEntryMs.toFixed(2)}ms; statuses ${firstStatusMs.toFixed(1)}ms first/${cachedStatusMs.toFixed(1)}ms indexed).`,
);
