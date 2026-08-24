import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { dateKey } from "../src/domain/date.ts";
import { stateWithoutGoogleHealthLocalData } from "../src/domain/googleHealthLocalPrivacy.ts";
import { statusRangeRollup } from "../src/domain/status.ts";
import { todayHeroSummary } from "../src/domain/todayHero.ts";
import {
  featuredWidgetSnapshot,
  leaderboardWidgetSnapshot,
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
assert.match(
  featured.dateLabel,
  /\s/,
  "Widget dates must visibly separate the weekday and numeric day",
);
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

const todoFeatured = featuredWidgetSnapshot(
  {
    ...state,
    todos: [
      {
        id: "widget-todo",
        title: "Widget to-do",
        createdAt: `${today}T08:00:00.000Z`,
        priority: "normal",
        reminders: [],
        completedDates: [],
      },
    ],
  },
  today,
  state.settings.language ?? "en",
  identity,
  theme,
);
assert.match(
  todoFeatured.compactSubtitle,
  /goals? left · 0\/1 To-Dos/,
  "A Featured widget with goals and to-dos must keep both counts on one separated summary line",
);
const noTodoFeatured = featuredWidgetSnapshot(
  { ...state, todos: [] },
  today,
  state.settings.language ?? "en",
  identity,
  theme,
);
assert.match(
  noTodoFeatured.compactSubtitle,
  /goals? left · 0\/0 To-Dos/,
  "A compact Featured widget must reserve its To-Do count even before the first To-Do is added",
);

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

const leaderboardMetricIds = ["steps", "food", "exercise", "water"];
const leaderboardState = {
  ...state,
  group: {
    ...state.group,
    metricConfiguration: state.group.metricConfiguration.map((metric) =>
      leaderboardMetricIds.includes(metric.id)
        ? { ...metric, sections: { ...metric.sections, group: true } }
        : metric,
    ),
  },
};
const leaderboard = leaderboardWidgetSnapshot(
  leaderboardState,
  today,
  state.settings.language ?? "en",
  identity,
  theme,
  leaderboardMetricIds,
);
assert.equal(leaderboard.id, "__leaderboard__");
assert.equal(leaderboard.deepLink, "paceboard://group");
assert.match(
  leaderboard.dateLabel,
  /\s/,
  "Leaderboard dates must visibly separate the weekday and numeric day",
);
assert.deepEqual(
  leaderboard.metrics.map((metric) => metric.id),
  leaderboardMetricIds,
  "The snapshot must retain the union selected by multiple widgets; each native widget applies its own count",
);
for (const metric of leaderboard.metrics) {
  assert.ok(metric.rows.length <= 5);
  assert.match(metric.deepLink, new RegExp(`metric=${metric.id}(?:&|$)`));
}

const privateMemberState = {
  ...leaderboardState,
  dailyMetricStatuses: [
    ...(state.dailyMetricStatuses ?? []),
    {
      groupId: state.group.id,
      metricId: "steps",
      userId: "sarah",
      localDate: today,
      visibility: "private",
      hasData: true,
    },
  ],
};
const privateLeaderboard = leaderboardWidgetSnapshot(
  privateMemberState,
  today,
  state.settings.language ?? "en",
  identity,
  theme,
  ["steps"],
);
const privateSarah = privateLeaderboard.metrics[0]?.rows.find(
  (row) => row.id === "sarah",
);
assert.equal(privateSarah?.private, true);
assert.equal(privateSarah?.value, "Private");

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
  leaderboard: leaderboardWidgetSnapshot(
    safeState,
    today,
    safeState.settings.language ?? "en",
    identity,
    theme,
    ["steps"],
  ),
});
assert.doesNotMatch(safePayload, /google_health|widget-private-steps|987654/);

const bridge = read("src/widgets/WidgetSnapshotBridge.tsx");
assert.match(
  bridge,
  /const currentState = stateWithoutGoogleHealthLocalData\(stateRef\.current\)[\s\S]{0,900}featuredWidgetSnapshot\([\s\S]{0,300}currentState/,
  "both durable widget snapshots must be derived only after the Google projection",
);

console.log("Privacy-safe Featured, Status, and Leaderboard widget snapshots validated.");
