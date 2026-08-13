import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import { scheduleEventsForDate } from "../src/domain/calendar.ts";

const root = path.resolve(import.meta.dirname, "..");
const source = fs.readFileSync(
  path.join(root, "app", "(tabs)", "calendar.tsx"),
  "utf8",
);

assert.match(
  source,
  /events=\{\(eventsByDate\[date\] \?\? \[\]\)\.filter\([\s\S]*?!event\.time[\s\S]*?\)\}[\s\S]*?slotEvents=\{eventsByDate\[date\] \?\? \[\]\}/,
  "ALL keeps an all-day grid preview but opens every filtered event on that date",
);
assert.match(
  source,
  /slotMenu\.hour === null[\s\S]*?t\("All"\)/,
  "the daily overview must not be mislabeled as an all-day-only list",
);
assert.match(
  source,
  /uniformColumnShell=\{hour === hours\[0\]\}/,
  "the first visible hour must give every day cell the tutorial target's flex shell",
);
assert.match(
  source,
  /<TutorialTarget id=\{tutorialId\} style=\{styles\.cellTarget\}>[\s\S]*?: uniformColumnShell \? \([\s\S]*?<View style=\{styles\.cellTarget\}>/,
  "tutorial and ordinary Schedule cells must share the same flex shell so hour columns stay straight",
);

const scheduledTodo = {
  id: "future-deadline",
  title: "Submit report",
  createdAt: "2099-06-01T10:00:00.000Z",
  dueAt: "2099-06-10T18:00:00",
  scheduledStartAt: "2099-06-08T07:00:00",
  scheduledEndAt: "2099-06-08T08:00:00",
  priority: "normal",
  reminders: [],
  completedDates: [],
  skippedDates: [],
};
const fixtureState = {
  currentUserId: "owner",
  metrics: [],
  entries: [],
  todos: [scheduledTodo],
  calendarReminders: [],
  gymSessions: [],
  settings: { calendarEventOrder: [] },
};

const plannedEvents = scheduleEventsForDate(fixtureState, "2099-06-08");
assert.deepEqual(
  plannedEvents.map((event) => event.id),
  ["todo:future-deadline:block:2099-06-08:2099-06-08"],
  "a planned to-do must be projected on its scheduled block date",
);
const deadlineEvents = scheduleEventsForDate(fixtureState, "2099-06-10");
assert.deepEqual(
  deadlineEvents.map((event) => event.id),
  ["todo:future-deadline:due"],
  "a planned to-do must be projected on its deadline date",
);
assert.deepEqual(
  scheduleEventsForDate(fixtureState, "2099-06-11").filter(
    (event) => event.todoId === scheduledTodo.id,
  ),
  [],
  "a not-yet-arrived deadline must not leak into later future ALL cells",
);

console.log("Schedule projection and grid geometry validation passed.");
