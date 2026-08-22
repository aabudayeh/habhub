import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { dateKey } from "../src/domain/date.ts";
import { stateWithoutGoogleHealthLocalData } from "../src/domain/googleHealthLocalPrivacy.ts";
import { statusRangeRollup } from "../src/domain/status.ts";
import { todayHeroSummary } from "../src/domain/todayHero.ts";
import {
  featuredWidgetSnapshot,
  statusWidgetSnapshot,
} from "../src/widgets/snapshot.ts";

const root = fileURLToPath(new URL("../", import.meta.url));
const read = (path) => readFileSync(`${root}${path}`, "utf8");
// Metro supplies `require()` for bundled demo assets. The focused Node
// validator only needs the state fixture, so represent those asset handles by
// their stable source names.
globalThis.require = (source) => source;
const { createInitialState } = await import("../src/data/seed.ts");
const identity = (source) => source;
const theme = {
  backgroundColor: "#123456",
  completedBackgroundColor: "#654321",
};
const today = dateKey();
const state = createInitialState();

const hero = todayHeroSummary(state, state.currentUserId, today);
const featured = featuredWidgetSnapshot(
  state,
  today,
  state.settings.language ?? "en",
  identity,
  theme,
);
assert.equal(featured.id, "__featured__");
assert.equal(featured.progress, hero.progress);
assert.equal(featured.allComplete, hero.allMet);
assert.deepEqual(
  featured.goals.map((goal) => goal.id),
  hero.goalProgress.map((goal) => goal.id),
  "Featured tiles must preserve Today's tracked-goal order",
);
assert.ok(featured.completionIcon);
assert.ok(["clockwise", "bottom_up", "center_out"].includes(featured.fillMode));
assert.equal(
  featured.showProgressOutline,
  state.settings.showFeaturedCardProgressOutline !== false,
);
for (const goal of featured.goals) {
  assert.ok(goal.progress >= 0 && goal.progress <= 1);
  assert.match(goal.deepLink, new RegExp(`metric=${goal.id}(?:&|$)`));
}

const status = statusRangeRollup(state, state.currentUserId, [today]);
const avatar = statusWidgetSnapshot(
  state,
  today,
  state.settings.language ?? "en",
  theme,
  {
    avatarUri: "asset://status-avatar",
    avatarStyle: "silhouette",
    heightScale: 1,
  },
);
assert.deepEqual(
  avatar.goals.map((goal) => goal.id),
  status.metrics.map((rollup) => rollup.metric.id),
  "Status rings must preserve the Status page's tracker order",
);
for (const forbidden of [
  "eyebrow",
  "title",
  "value",
  "subtitle",
  "weightLabel",
  "bodyCompositionLabel",
])
  assert.equal(
    Object.hasOwn(avatar, forbidden),
    false,
    `Status snapshot must omit ${forbidden}`,
  );

const activeTodoFilterState = {
  ...state,
  settings: {
    ...state.settings,
    activeTodayTrackerViewFilterId: "widget-filter",
    trackerViewFilters: [
      {
        id: "widget-filter",
        name: "No todos",
        metricIds: [],
        includeTodos: false,
      },
    ],
  },
};
const filteredHero = todayHeroSummary(
  activeTodoFilterState,
  state.currentUserId,
  today,
);
assert.equal(filteredHero.todoVisible, false);
assert.deepEqual(filteredHero.todos, []);

const googleEntry = {
  id: "google-health:widget-private-steps",
  metricId: "steps",
  userId: state.currentUserId,
  value: 987654,
  localDate: today,
  recordedAt: `${today}T12:00:00.000Z`,
  visibility: "private",
  source: "imported",
  sourceProvider: "google_health",
  sourceRecordId: `aggregate:steps:${today}`,
};
const safeState = stateWithoutGoogleHealthLocalData({
  ...state,
  entries: [...state.entries, googleEntry],
});
assert.equal(
  safeState.entries.some((entry) => entry.id === googleEntry.id),
  false,
);
const safePayload = JSON.stringify({
  featured: featuredWidgetSnapshot(
    safeState,
    today,
    safeState.settings.language ?? "en",
    identity,
    theme,
  ),
  avatar: statusWidgetSnapshot(
    safeState,
    today,
    safeState.settings.language ?? "en",
    theme,
    { avatarStyle: "silhouette", heightScale: 1 },
  ),
});
assert.doesNotMatch(safePayload, /google_health|widget-private-steps|987654/);

const bridge = read("src/widgets/WidgetSnapshotBridge.tsx");
assert.match(
  bridge,
  /const currentState = stateWithoutGoogleHealthLocalData\(stateRef\.current\)[\s\S]{0,900}featuredWidgetSnapshot\([\s\S]{0,300}currentState/,
  "both durable widget snapshots must be derived only after the Google projection",
);

console.log("Privacy-safe Featured and Status widget snapshots validated.");
