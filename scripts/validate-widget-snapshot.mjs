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
  privacySafeLeaderboardWidgetState,
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
const todayScreen = read("app/(tabs)/index.tsx");
const nativeWidget = read(
  "plugins/habhub-android/java/HabHubWidgetProvider.kt",
);

assert.match(
  todayScreen,
  /const heroProgress = tutorialCompletionPreview \? 1 : todayHero\.progress/,
  "The in-app Featured percentage must use the same partial-goal average as its widget snapshot",
);

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
assert.equal(
  featured.progress,
  hero.goalProgress.filter((goal) => !goal.unavailable).length
    ? hero.goalProgress
        .filter((goal) => !goal.unavailable)
        .reduce((sum, goal) => sum + goal.progress, 0) /
        hero.goalProgress.filter((goal) => !goal.unavailable).length
    : 0,
  "Featured progress must average only applicable goals' partial completion like the Status avatar",
);
assert.notEqual(
  featured.progress,
  hero.total ? hero.met / hero.total : 0,
  "The seeded partial goals must prove Featured is no longer a binary completed-goal percentage",
);
assert.equal(featured.allComplete, hero.allMet);
assert.equal(
  featured.deepLink,
  "paceboard://",
  "Tapping Featured must open Today rather than Status",
);
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
assert.match(todoFeatured.goalSummary, /goals? left/);
assert.equal(
  todoFeatured.todoSummary,
  "0/1 To-Dos",
  "Native rendering needs a dedicated To-Do segment so compact layouts cannot ellipsize it away",
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
assert.equal(noTodoFeatured.todoSummary, "0/0 To-Dos");

const hiddenTodoFeatured = featuredWidgetSnapshot(
  {
    ...state,
    settings: { ...state.settings, showTodosToday: false },
    todos: [
      {
        id: "hidden-widget-todo",
        title: "Hidden widget to-do",
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
assert.equal(
  hiddenTodoFeatured.todoSummary,
  "",
  "Featured widgets must hide the To-Do segment when To-Dos are hidden in Today",
);
assert.doesNotMatch(hiddenTodoFeatured.compactSubtitle, /To-Dos/);

const status = statusRangeRollup(state, state.currentUserId, [today]);
assert.equal(
  featured.progress,
  status.progress,
  "Today, its Featured widget, and Status must share the same one-day aggregate percentage",
);
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

const webSharedStatusState = {
  ...leaderboardState,
  entries: leaderboardState.entries.filter(
    (entry) =>
      entry.metricId !== "steps" ||
      entry.localDate !== today ||
      ![state.currentUserId, "sarah", "daniel"].includes(entry.userId),
  ),
  dailyMetricStatuses: [
    ...leaderboardState.dailyMetricStatuses.filter(
      (status) =>
        status.metricId !== "steps" ||
        status.localDate !== today ||
        ![state.currentUserId, "sarah", "daniel"].includes(status.userId),
    ),
    {
      groupId: state.group.id,
      metricId: "steps",
      userId: "sarah",
      localDate: today,
      goalReached: false,
      scoreContribution: 43.21,
      visibility: "group",
      exactValue: 4321,
      privacyProjectionVersion: 2,
      hasData: true,
      sourceProvider: "google_health",
    },
    {
      groupId: state.group.id,
      metricId: "steps",
      userId: "daniel",
      localDate: today,
      goalReached: true,
      scoreContribution: 100,
      visibility: "private",
      exactValue: 999999,
      privacyProjectionVersion: 2,
      hasData: true,
      sourceProvider: "google_health",
    },
    {
      groupId: state.group.id,
      metricId: "steps",
      userId: state.currentUserId,
      localDate: today,
      goalReached: true,
      scoreContribution: 100,
      visibility: "group",
      exactValue: 888888,
      privacyProjectionVersion: 2,
      hasData: true,
      sourceProvider: "google_health",
    },
  ],
};
const genericCacheSafeState = stateWithoutGoogleHealthLocalData(
  webSharedStatusState,
);
assert.equal(
  genericCacheSafeState.dailyMetricStatuses.some(
    (status) =>
      status.metricId === "steps" &&
      status.localDate === today &&
      status.userId === "sarah",
  ),
  false,
  "the generic plaintext-cache scrub intentionally removes Google-derived compact rows",
);
const widgetLeaderboardState = privacySafeLeaderboardWidgetState(
  webSharedStatusState,
  today,
  ["steps"],
);
assert.equal(
  widgetLeaderboardState.dailyMetricStatuses.some(
    (status) =>
      status.metricId === "steps" &&
      status.localDate === today &&
      status.userId === "sarah" &&
      status.exactValue === 4321,
  ),
  true,
  "an explicit v2 group projection from a web-only peer must remain visible to the widget",
);
assert.equal(
  widgetLeaderboardState.dailyMetricStatuses.some(
    (status) =>
      status.metricId === "steps" &&
      status.localDate === today &&
      [state.currentUserId, "daniel"].includes(status.userId),
  ),
  false,
  "private peer projections and this device owner's Google projection must stay outside the launcher state",
);
const webSharedLeaderboard = leaderboardWidgetSnapshot(
  widgetLeaderboardState,
  today,
  state.settings.language ?? "en",
  identity,
  theme,
  ["steps"],
);
const webSarah = webSharedLeaderboard.metrics[0]?.rows.find(
  (row) => row.id === "sarah",
);
const privateDaniel = webSharedLeaderboard.metrics[0]?.rows.find(
  (row) => row.id === "daniel",
);
assert.equal(webSarah?.private, false);
assert.match(webSarah?.value ?? "", /4[.,]321 steps/);
assert.equal(privateDaniel?.private, true);
assert.equal(privateDaniel?.value, "Private");
assert.doesNotMatch(
  JSON.stringify(webSharedLeaderboard),
  /google_health|888888|999999/,
  "the native payload may contain only the authorized formatted peer value, never provider metadata or excluded values",
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
assert.equal(
  featuredWidgetSnapshot(
    activeTodoFilterState,
    today,
    state.settings.language ?? "en",
    identity,
    theme,
  ).todoSummary,
  "",
  "Featured widgets must follow a Today filter that hides To-Dos",
);

const labelFilteredState = {
  ...state,
  settings: {
    ...state.settings,
    showTodosToday: true,
    activeTodayTrackerViewFilterId: "widget-label-filter",
    trackerViewFilters: [
      {
        id: "widget-label-filter",
        name: "Work",
        metricIds: [],
        includeTodos: true,
        todoLabels: ["work"],
      },
    ],
  },
  todos: [
    {
      id: "widget-work-todo",
      title: "Draft #Work plan",
      createdAt: `${today}T08:00:00.000Z`,
      priority: "normal",
      reminders: [],
      completedDates: [],
    },
    {
      id: "widget-home-todo",
      title: "Tidy #Home",
      createdAt: `${today}T09:00:00.000Z`,
      priority: "normal",
      reminders: [],
      completedDates: [],
    },
  ],
};
const labelFilteredHero = todayHeroSummary(
  labelFilteredState,
  state.currentUserId,
  today,
);
assert.deepEqual(
  labelFilteredHero.todos.map((todo) => todo.id),
  ["widget-work-todo"],
  "a persisted Today label rule must dynamically select matching To-Dos",
);
assert.equal(
  featuredWidgetSnapshot(
    labelFilteredState,
    today,
    state.settings.language ?? "en",
    identity,
    theme,
  ).todoSummary,
  "0/1 To-Dos",
  "Featured widget counts must use the same persisted label filter as Today",
);

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
  "Featured and Status snapshots must remain derived only after the Google cache scrub",
);
assert.match(
  bridge,
  /const leaderboardState = leaderboardConfigurations\.length[\s\S]{0,200}privacySafeLeaderboardWidgetState\([\s\S]{0,160}stateRef\.current,[\s\S]{0,100}today,[\s\S]{0,100}requestedLeaderboardMetricIds[\s\S]{0,500}leaderboardWidgetSnapshot\([\s\S]{0,100}leaderboardState/,
  "Leaderboard snapshots must use the peer-authorized projection rather than the broader local cache projection",
);

assert.match(
  nativeWidget,
  /val twoByOneFeatured = size\.compact && !size\.wide/,
  "The native renderer must identify 2 x 1 Featured bounds across launcher-specific reported widths",
);
assert.match(
  nativeWidget,
  /val height = if \(portrait\) maxHeight else minHeight/,
  "The Featured bitmap must retain the launcher's real current-orientation proportions instead of stretching a forced 50dp render",
);
assert.match(
  nativeWidget,
  /if \(twoByOneFeatured\) 4f else 5\.1f,[\s\S]{0,120}if \(twoByOneFeatured\) 2\.8f else 4\.1f[\s\S]{0,180}if \(twoByOneFeatured\) 0f else 0\.04f/,
  "The 2 x 1 Featured widget must use its own fitted header treatment so TODAY'S FOCUS is not ellipsized",
);
assert.match(
  nativeWidget,
  /val twoByOneFeatured = size\.compact && !size\.wide[\s\S]{0,240}size\.wide -> 8[\s\S]{0,80}twoByOneFeatured -> 7[\s\S]{0,160}else -> 5[\s\S]{0,160}val gap = if \(twoByOneFeatured\) 1\.5f else 3f/,
  "Only the 2 x 1 Featured widget should expand its compact goal row to seven squares",
);
assert.match(
  nativeWidget,
  /val availableWidth = size\.widthDp - 12f - if \(twoByOneFeatured\) 0f else badgeReserve/,
  "The 2 x 1 goal row must use its full lower width instead of reserving the top progress badge",
);

console.log("Privacy-safe Featured, Status, and Leaderboard widget snapshots validated.");
