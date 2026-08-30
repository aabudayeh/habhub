import assert from "node:assert/strict";
import fs from "node:fs";
import { performance } from "node:perf_hooks";

import { dailyScore } from "../src/domain/metrics.ts";
import { buildGroupRecapFeed } from "../src/domain/recaps.ts";

const recapSource = fs.readFileSync("src/domain/recaps.ts", "utf8");
const metricSource = fs.readFileSync("src/domain/metrics.ts", "utf8");
const feedScreen = fs.readFileSync("app/recap.tsx", "utf8");
const socialHook = fs.readFileSync(
  "src/cloud/useGroupSocialEngagement.ts",
  "utf8",
);

assert.match(recapSource, /const groupMembersById = firstById/);
assert.match(recapSource, /settledPlacementByOccurrence\.get\(settlementKey\)/);
assert.match(
  recapSource,
  /if \(!dateSet\.has\(entry\.localDate\)\) continue;[\s\S]{0,180}activeDates\.add\(entry\.localDate\)/,
  "feed activity discovery must share the selected-date entry pass",
);
assert.doesNotMatch(
  recapSource,
  /const activeDates = new Set\(\[[\s\S]{0,400}state\.entries\.filter/,
  "daily headlines must not rescan all entry history",
);
assert.match(metricSource, /const dailyScoreCache = new WeakMap<AppState/);
assert.match(
  feedScreen,
  /const FEED_PAGE_SIZE = Platform\.OS === "web" \? 30 : 12/,
  "native must mount a bounded first feed batch without changing web behavior",
);
assert.match(feedScreen, /FEED_HIGHLIGHT_MS = 5_000/);
assert.doesNotMatch(
  feedScreen,
  /\[displayedFeed, params\.feedFocusAt, requestedHighlight\]/,
  "cloud/feed recomputation must not restart the notification highlight timer",
);
assert.match(
  socialHook,
  /Platform\.OS === "web"[\s\S]{0,220}scheduleResponsiveWork\(\(\) => void refresh\(\)/,
  "native social hydration must yield while web retains its immediate refresh",
);
assert.match(
  socialHook,
  /"social_updated"[\s\S]{0,500}scheduleResponsiveWork\(\(\) => void refresh\(\)[\s\S]{0,220}minimumUserQuietMs: 650/,
  "Realtime social refreshes must stay behind native taps",
);

const steps = {
  id: "steps",
  name: "Steps",
  icon: "walk-outline",
  color: "#0FBFB8",
  unit: "steps",
  dataType: "number",
  aggregation: "sum",
  rankingDirection: "higher",
  goal: { kind: "at_least", target: 10_000 },
  scoreWeight: 30,
  defaultVisibility: "group",
  activeFrom: "2000-01-01",
  sections: { today: true, group: true, insights: true },
  order: 0,
};
const members = Array.from({ length: 8 }, (_, index) => ({
  id: index === 0 ? "owner" : `peer-${index}`,
  name: index === 0 ? "Owner" : `Peer ${index}`,
  initials: index === 0 ? "O" : `P${index}`,
  color: `#${String(0x225577 + index * 0x10101).padStart(6, "0")}`,
  role: index === 0 ? "owner" : "member",
}));
const dates = Array.from(
  { length: 14 },
  (_, index) => `2026-08-${String(index + 1).padStart(2, "0")}`,
);
const oldEntries = Array.from({ length: 60_000 }, (_, index) => ({
  id: `old-${index}`,
  metricId: "steps",
  userId: members[index % members.length].id,
  localDate: "2020-01-01",
  recordedAt: `2020-01-01T00:${String(index % 60).padStart(2, "0")}:00.000Z`,
  value: 1,
  visibility: "group",
  source: "manual",
}));
const selectedEntries = dates.flatMap((localDate, dateIndex) =>
  members.map((member, memberIndex) => ({
    id: `selected-${localDate}-${member.id}`,
    metricId: "steps",
    userId: member.id,
    localDate,
    recordedAt: `${localDate}T${String(8 + memberIndex).padStart(2, "0")}:00:00.000Z`,
    value: 4_000 + dateIndex * 100 + memberIndex * 50,
    visibility: "group",
    source: "manual",
    label: "Morning walk",
  })),
);
const state = {
  currentUserId: "owner",
  metrics: [steps],
  entries: [...oldEntries, ...selectedEntries],
  photos: [],
  settings: {},
  dailyMetricStatuses: dates.flatMap((localDate, dateIndex) =>
    members.slice(1).map((member, memberIndex) => ({
      id: `status-${localDate}-${member.id}`,
      groupId: "performance-group",
      metricId: "steps",
      userId: member.id,
      localDate,
      value: 4_000 + dateIndex * 100 + memberIndex * 50,
      scoreContribution: 40 + memberIndex,
      visibility: "group",
      updatedAt: `${localDate}T23:00:00.000Z`,
    })),
  ),
  group: {
    id: "performance-group",
    name: "Performance group",
    inviteCode: "PERF",
    templateName: "Performance",
    streakRestDaysPerWeek: 0,
    members,
    metricConfiguration: [steps],
  },
};

const firstStartedAt = performance.now();
const firstFeed = buildGroupRecapFeed(state, dates);
const firstMs = performance.now() - firstStartedAt;
const repeatedStartedAt = performance.now();
const repeatedFeed = buildGroupRecapFeed(state, dates);
const repeatedMs = performance.now() - repeatedStartedAt;

assert.deepEqual(repeatedFeed, firstFeed);
assert.equal(
  firstFeed.filter((item) => item.kind === "leader").length,
  dates.length,
);
assert.ok(firstMs < 1_500, `60k-row recap feed took ${firstMs.toFixed(1)}ms`);
assert.ok(
  repeatedMs < 750,
  `repeated 60k-row recap feed took ${repeatedMs.toFixed(1)}ms`,
);

const baselineScore = dailyScore(state, "owner", dates[0]);
const changedState = {
  ...state,
  entries: [
    ...state.entries,
    {
      ...selectedEntries[0],
      id: "owner-score-delta",
      value: 6_000,
      recordedAt: `${dates[0]}T23:30:00.000Z`,
    },
  ],
};
assert.ok(
  dailyScore(changedState, "owner", dates[0]) > baselineScore,
  "daily score memoization must be scoped to immutable state identity",
);

console.log(
  `Recap feed performance validation passed (60,112 rows: ${firstMs.toFixed(1)} ms first, ${repeatedMs.toFixed(1)} ms repeated).`,
);
