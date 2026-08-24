import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import {
  scheduleEventTouchesHourSlot,
  scheduleEventsForDate,
  scheduleEventsForHourSlot,
} from "../src/domain/calendar.ts";
import {
  scheduleAppliesOnDate,
  todoReminderAppliesOnDate,
  todoResolvedOnDate,
} from "../src/domain/schedule.ts";

const root = path.resolve(import.meta.dirname, "..");
const source = fs.readFileSync(
  path.join(root, "app", "(tabs)", "calendar.tsx"),
  "utf8",
);
const metricDetailSource = fs.readFileSync(
  path.join(root, "app", "metric-detail.tsx"),
  "utf8",
);

assert.match(
  source,
  /events=\{\(eventsByDate\[date\] \?\? \[\]\)\.filter\([\s\S]*?!event\.time[\s\S]*?\)\}[\s\S]*?slotEvents=\{eventsByDate\[date\] \?\? \[\]\}/,
  "ALL keeps an all-day grid preview but opens every filtered event on that date",
);
assert.match(
  source,
  /event\.kind === "todo"[\s\S]{0,220}pathname: "\/metric-detail"[\s\S]{0,220}metric: "todo_completion"[\s\S]{0,220}focusTodo: event\.todoId/,
  "opening a scheduled to-do must show that date's To-Do tracker instead of its editor",
);
assert.match(
  metricDetailSource,
  /focusTodoId=\{focusTodo\}[\s\S]{0,180}onRequestScroll/,
  "the To-Do tracker must receive the schedule focus target and a scroll callback",
);
assert.match(
  metricDetailSource,
  /highlightedTodoId === todo\.id \? "#E9A23B"/,
  "the selected scheduled to-do must receive an orange outline",
);
assert.match(
  metricDetailSource,
  /focusAnimation\.interpolate\([\s\S]{0,180}outputRange: \[-5, 0, 5\]/,
  "the selected scheduled to-do must receive a wiggle animation",
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
assert.match(
  source,
  /events=\{hourSlotEventsByDate\[date\]\?\.\[hour\] \?\? \[\]\}[\s\S]*?slotEvents=\{hourSlotEventsByDate\[date\]\?\.\[hour\] \?\? \[\]\}/,
  "hour cells must preview the same complete overlap set opened by the slot menu",
);
assert.doesNotMatch(
  source,
  /minuteOffset|durationEvent|splitDurationEvent|eventBesideDuration/,
  "timed blocks must use compact rows instead of duration-height or overlapping geometry",
);
assert.match(
  source,
  /accessibilityRole="button"[\s\S]{0,180}accessibilityLabel=\{accessibilityLabel\}[\s\S]{0,180}accessibilityHint=\{t\(/,
  "schedule hour cells must expose their date, time window, and action to assistive technology",
);
assert.match(
  source,
  /accessibilityLabel=\{`\$\{event\.title\}\. \$\{accessibilityLabel\}`\}[\s\S]{0,180}accessibilityHint=\{t\(/,
  "compact event rows must remain independently understandable to assistive technology",
);
assert.match(
  source,
  /Opens this schedule slot\. Long press to add an item/,
  "schedule slot accessibility must explain both supported actions",
);
assert.match(
  source,
  /Opens all items in this schedule slot\. Long press to add an item/,
  "event-row accessibility must explain both supported actions",
);

const longBlock = {
  id: "long-block",
  title: "Workout",
  time: "07:00",
  durationMinutes: 150,
  kind: "todo",
};
assert.deepEqual(
  [6, 7, 8, 9, 10].filter((hour) =>
    scheduleEventTouchesHourSlot(longBlock, hour),
  ),
  [7, 8, 9],
  "07:00-09:30 must render once in each hour it overlaps",
);

const boundaryBlock = {
  ...longBlock,
  id: "boundary-block",
  durationMinutes: 120,
};
assert.deepEqual(
  [7, 8, 9].filter((hour) =>
    scheduleEventTouchesHourSlot(boundaryBlock, hour),
  ),
  [7, 8],
  "a block ending exactly at 09:00 must not leak into the 09:00 slot",
);

const pointReminder = {
  id: "point-reminder",
  title: "Drink water",
  time: "08:15",
  kind: "reminder",
};
assert.deepEqual(
  scheduleEventsForHourSlot(
    [longBlock, pointReminder, { ...pointReminder }],
    8,
  ).map((event) => event.id),
  ["long-block", "point-reminder"],
  "an hour must keep multiple overlapping rows in stable order and de-duplicate ids",
);
assert.equal(
  scheduleEventTouchesHourSlot(pointReminder, 7),
  false,
  "point reminders must remain in their own start hour",
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

const deadlineReminderTodo = {
  ...scheduledTodo,
  reminders: [{ id: "two-days-before", daysBeforeDue: 2, time: "09:00" }],
};
assert.equal(
  todoReminderAppliesOnDate(
    deadlineReminderTodo,
    deadlineReminderTodo.reminders[0],
    "2099-06-08",
  ),
  true,
  "relative to-do reminders must resolve against the deadline date",
);
const horizonStart = new Date("2099-08-01T12:00:00.000Z");
const sparseMonthlyOccurrence = Array.from({ length: 367 }, (_, offset) => {
  const candidate = new Date(horizonStart);
  candidate.setUTCDate(candidate.getUTCDate() + offset);
  return candidate.toISOString().slice(0, 10);
}).find((localDate) =>
  scheduleAppliesOnDate(
    {
      mode: "days_of_month",
      daysOfMonth: [25],
      anchorDate: "2099-08-25",
    },
    "2099-08-25",
    localDate,
  ),
);
assert.equal(
  sparseMonthlyOccurrence,
  "2099-08-25",
  "a year-bounded planner must find a sparse monthly reminder while the app stays closed",
);
assert.equal(
  todoReminderAppliesOnDate(
    deadlineReminderTodo,
    deadlineReminderTodo.reminders[0],
    "2099-06-09",
  ),
  false,
  "relative to-do reminders must not repeat on neighboring dates",
);
assert.equal(
  todoReminderAppliesOnDate(
    scheduledTodo,
    { id: "deadline-only", time: "18:00" },
    "2099-06-10",
  ),
  true,
  "a due-date-only reminder row must fire on the deadline",
);
assert.equal(
  todoResolvedOnDate(
    { ...deadlineReminderTodo, skippedDates: ["2099-06-08"] },
    "2099-06-08",
  ),
  true,
  "skipping a recurring to-do occurrence must remove that date's pending reminder",
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
