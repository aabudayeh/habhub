import assert from "node:assert/strict";
import fs from "node:fs";
import { performance } from "node:perf_hooks";

import { dailyScore } from "../src/domain/metrics.ts";
import { buildGroupRecapFeed } from "../src/domain/recaps.ts";

const recapSource = fs.readFileSync("src/domain/recaps.ts", "utf8");
const metricSource = fs.readFileSync("src/domain/metrics.ts", "utf8");
const feedScreen = fs.readFileSync("app/recap.tsx", "utf8");
const responsiveFeedHook = fs.readFileSync(
  "src/components/useResponsiveRecapFeed.ts",
  "utf8",
);
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
assert.match(
  feedScreen,
  /const deriveFeed = useCallback\(\(\) => \{[\s\S]{0,900}buildBadges\([\s\S]{0,900}buildGroupRecapFeed\(/,
  "badge and feed projection must live inside the deferred feed derivation",
);
assert.doesNotMatch(
  feedScreen,
  /const badges = useMemo\(/,
  "native feed navigation must not synchronously build the broad badge projection",
);
assert.match(
  feedScreen,
  /const feedScopeKey = useMemo\([\s\S]{0,500}state\.currentUserId[\s\S]{0,180}state\.group\.id/,
  "feed cache keys must remain account and group scoped",
);
assert.match(
  feedScreen,
  /const feedAuthority = useMemo\([\s\S]{0,900}state\.entries[\s\S]{0,180}state\.dailyMetricStatuses[\s\S]{0,180}state\.photos[\s\S]{0,420}state\.group\.members[\s\S]{0,220}state\.group\.metricConfiguration/,
  "native feed cache authority must follow current entries, status/privacy, photos, membership, and configured group metrics",
);
assert.match(
  feedScreen,
  /useResponsiveRecapFeed\(\s*feedScopeKey,\s*deriveFeed,\s*feedAuthority,?\s*\)/,
  "feed screen must use the responsive cached derivation hook",
);
assert.match(
  feedScreen,
  /!feedReady && !visibleFeed\.length[\s\S]{0,260}accessibilityRole="progressbar"[\s\S]{0,220}t\("Loading/,
  "native loading affordance must only appear when no cached feed is ready",
);
assert.match(
  feedScreen,
  /feedReady && !visibleFeed\.length[\s\S]{0,220}Nothing meaningful to recap yet/,
  "an unfinished native projection must not flash the empty-feed state",
);
assert.match(
  feedScreen,
  /useGroupSocialEngagement\(state\.group\.id, targets, "feed"\)/,
  "feed reactions must preserve their feed notification origin",
);
assert.match(
  responsiveFeedHook,
  /const nativeFeedCache = new Map<string, CachedFeed>\(\)/,
  "native feed snapshots must survive screen unmounts in an account-scoped cache",
);
assert.match(
  responsiveFeedHook,
  /type CachedFeed = \{[\s\S]{0,180}authority: RecapFeedAuthoritySignature;[\s\S]{0,260}const feedAuthorityObjectIds = new WeakMap<object, number>\(\)/,
  "cached feeds must retain only compact weak identity signatures, not historical state arrays",
);
assert.doesNotMatch(
  responsiveFeedHook,
  /type CachedFeed = \{[\s\S]{0,180}authority: RecapFeedAuthority;/,
  "the bounded feed cache must not pin old entry, status, or photo array generations",
);
assert.match(
  responsiveFeedHook,
  /function feedAuthoritySignature\([\s\S]{0,900}feedAuthorityObjectIds\.get\([\s\S]{0,500}feedAuthorityObjectIds\.set\(/,
  "authorization source identities must compact through weak object ids",
);
assert.match(
  responsiveFeedHook,
  /function authorizedCachedFeed\([\s\S]{0,320}sameFeedAuthority\(cached\.authority, authority\)/,
  "native cache lookup must fail closed when current authorization sources change",
);
assert.match(
  responsiveFeedHook,
  /nativeSnapshot\?\.scopeKey === scopeKey[\s\S]{0,180}sameFeedAuthority\(nativeSnapshot\.authority, authoritySignature\)/,
  "an already-mounted native snapshot must not survive a privacy authority change",
);
assert.match(
  responsiveFeedHook,
  /Platform\.OS === "web" \? derive\(\) : undefined/,
  "web must retain synchronous feed projection",
);
assert.match(
  responsiveFeedHook,
  /scheduleResponsiveWork\([\s\S]{0,1100}minimumUserQuietMs: 550/,
  "native badge and feed projection must yield to navigation and taps",
);
assert.match(
  responsiveFeedHook,
  /deriveRef\.current = derive[\s\S]{0,1400}if \(nativeFeedTaskRef\.current\) return[\s\S]{0,500}deriveRef\.current\(\)/,
  "a live sync stream must update one pending feed projection instead of repeatedly cancelling and starving it",
);
assert.match(
  responsiveFeedHook,
  /const snapshot =[\s\S]{0,280}sameFeedAuthority\(nativeSnapshot\.authority, authoritySignature\)[\s\S]{0,180}ready: Boolean\(snapshot\)/,
  "only a cache authorized by current immutable state may be ready on the first reopen frame",
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
