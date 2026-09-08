import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { calendarWeekRange, dateKey, dateWithOffsetFrom } from "../src/domain/date.ts";
import { scheduleEventsForHourSlot } from "../src/domain/calendar.ts";
import { canonicalGroupScheduleAllDayInstant } from "../src/domain/groupHub.ts";
import { GROUP_EVENT_REMINDER_MINUTES, groupCalendarEventsForDate, groupScheduleCalendarRange, localGroupScheduleDateTime } from "../src/domain/groupSchedule.ts";

const event = (overrides = {}) => ({ id: "event", groupId: "g1", creatorId: "friend", title: "Park circuit", startsAt: "2026-09-08T10:00:00", endsAt: "2026-09-08T11:00:00", allDay: false, revision: 1, createdAt: "2026-09-01T12:00:00Z", updatedAt: "2026-09-01T12:00:00Z", ...overrides });
const task = (overrides = {}) => ({ id: "task", groupId: "g1", creatorId: "friend", title: "Bring water", dueAt: "2026-09-08T10:30:00", completionMode: "individual", priority: "normal", completedByIds: [], completedBy: [], createdAt: "2026-09-01T12:00:00Z", updatedAt: "2026-09-01T12:00:00Z", ...overrides });
const state = {
  currentUserId: "me", group: { id: "g1", groupTodosEnabled: true, members: [{ id: "me" }, { id: "friend" }] }, groups: [],
  settings: { notifications: { groupPreferencesByGroup: { g1: { scheduleReminders: true } } } },
  calendarReminders: [
    { id: "task-reminder", title: "Remember water", groupId: "g1", groupTodoId: "task", kind: "todo", time: "09:00", enabled: true, schedule: { mode: "daily" } },
    { id: "private", title: "Private appointment", kind: "general", time: "09:00", enabled: true, schedule: { mode: "daily" } },
    { id: "other-group", title: "Other group", groupId: "g2", groupTodoId: "task", kind: "todo", time: "09:00", enabled: true, schedule: { mode: "daily" } },
  ],
  // Group calendar must never call the personal projection on this snapshot.
  todos: [{ id: "private-todo", title: "Private health task" }], metrics: [{ id: "private-metric" }], entries: [],
};
const project = (localDate, items, todos = [], changes = {}) => groupCalendarEventsForDate({ state, localDate, items, todos, ...changes });
const originalTZ = process.env.TZ;
for (const timezone of ["UTC", "America/New_York", "Europe/Berlin", "Pacific/Auckland"]) {
  process.env.TZ = timezone;
  const normal = project("2026-09-08", [event()]);
  assert.equal(normal.length, 1, `${timezone}: visible event`);
  assert.equal(normal[0].time, "10:00");
  assert.equal(normal[0].durationMinutes, 60);
  assert.equal(scheduleEventsForHourSlot(normal, 10).length, 1);
  assert.equal(scheduleEventsForHourSlot(normal, 11).length, 0, "half-open end does not duplicate");
  assert.equal(project("2026-09-07", [event()]).length, 0);

  const overnight = event({ startsAt: "2026-09-07T23:30:00", endsAt: "2026-09-08T01:15:00" });
  assert.equal(project("2026-09-07", [overnight])[0].durationMinutes, 30);
  assert.equal(project("2026-09-08", [overnight])[0].durationMinutes, 75);
  assert.equal(project("2026-09-08", [overnight])[0].time, "00:00");
  const through = event({ startsAt: "2026-08-01T09:00:00", endsAt: "2026-09-10T00:00:00" });
  assert.equal(project("2026-09-08", [through])[0].durationMinutes, 1440);
  assert.equal(project("2026-09-10", [through]).length, 0);

  const allDay = event({ startsAt: canonicalGroupScheduleAllDayInstant("2026-09-08"), allDay: true, endsAt: undefined, reminderMinutes: 15 });
  assert.equal(project("2026-09-08", [allDay]).length, 1, `${timezone}: all-day semantic date`);
  assert.equal(project("2026-09-08", [allDay])[0].time, undefined);
  assert.equal(project("2026-09-07", [allDay]).length, 0);
  const reminded = event({ startsAt: "2026-09-08T00:05:00", endsAt: undefined, reminderMinutes: 15 });
  assert.equal(project("2026-09-07", [reminded])[0].time, "23:50");
  assert.equal(project("2026-09-07", [reminded])[0].source, "reminder");
  assert.equal(project("2026-09-07", [reminded], [], { state: { ...state, settings: { notifications: {} } } }).length, 0, "reminders explicitly opt in");
  assert.equal(project("2026-09-07", [reminded], [], { state: { ...state, settings: { notifications: { mutedGroupIds: ["g1"], groupPreferencesByGroup: { g1: { scheduleReminders: true } } } } } }).length, 0);
  assert.equal(project("2026-09-07", [reminded], [], { state: { ...state, settings: { notifications: { groupPreferencesByGroup: { g1: { scheduleReminders: true, enabled: false } } } } } }).length, 0);

  const dated = project("2026-09-08", [], [task()]);
  assert.equal(dated.find((row) => row.source === "task")?.time, "10:30");
  assert.equal(dated.filter((row) => row.source === "reminder").length, 1);
  assert(!dated.some((row) => row.id === "reminder:private" || row.id === "reminder:other-group"));
  assert.equal(project("2026-09-09", [], [task()]).filter((row) => row.source === "task").length, 0);
  const recurring = task({ recurrence: { mode: "selected_days", daysOfWeek: [2], anchorDate: "2026-09-01" } });
  assert.equal(project("2026-09-15", [], [recurring]).find((row) => row.source === "task")?.time, "10:30");
  assert.equal(project("2026-09-16", [], [recurring]).filter((row) => row.source === "task").length, 0);
  assert.equal(project("2026-09-08", [], [task()], { state: { ...state, group: { ...state.group, groupTodosEnabled: false } } }).length, 0);

  const range = groupScheduleCalendarRange("2026-11-01");
  for (const weekStart of [0, 1, 6]) {
    for (const anchor of ["2026-11-01", "2026-11-30", "2026-08-01", "2026-08-31"]) {
      const window = groupScheduleCalendarRange(anchor);
      for (const date of calendarWeekRange(anchor, weekStart)) assert(date >= window.from && date < window.to, `${timezone} ${anchor} week ${weekStart}: ${date} must load`);
    }
  }
  assert(range.startsAfter <= new Date(`${range.from}T00:00:00`).toISOString());
  assert(range.startsAfter <= `${range.from}T00:00:00.000Z`);
  assert(range.startsBefore >= new Date(`${dateWithOffsetFrom(range.to, 1)}T00:00:00`).toISOString(), "last visible day can show next-day event's 24h reminder");
  assert.equal(dateWithOffsetFrom(range.from, 56), range.to, "read window stays fixed and bounded");
}
process.env.TZ = "America/New_York";
for (const [date, end] of [["2026-03-08", "2026-03-09"], ["2026-11-01", "2026-11-02"]]) {
  const dst = project(date, [event({ startsAt: `${date}T00:00:00`, endsAt: `${end}T00:00:00` })]);
  assert.equal(dst[0].durationMinutes, 1440, "DST days still project onto the same 24 wall-clock slots");
  for (let hour = 0; hour < 24; hour++) assert.equal(scheduleEventsForHourSlot(dst, hour).length, 1);
}
assert.equal(localGroupScheduleDateTime("2026-03-08 02:30"), undefined, "nonexistent DST time must not silently normalize");
assert.equal(localGroupScheduleDateTime("2026-02-30 10:00"), undefined);
assert.equal(localGroupScheduleDateTime("2026-09-08 24:00"), undefined);
assert.equal(dateKey(new Date(localGroupScheduleDateTime("2026-09-08 09:15"))), "2026-09-08");
if (originalTZ === undefined) delete process.env.TZ; else process.env.TZ = originalTZ;

assert.equal(project("2026-09-08", [event({ groupId: "g2" })], [task({ groupId: "g2" })]).length, 0, "other-group state never leaks");
assert.equal(project("2026-09-08", [event()], [task()], { blockedUserIds: new Set(["friend"]) }).length, 0, "blocked events/tasks/their private reminders are hidden");
assert.equal(project("2026-09-08", [event()], [task()], { safetyHydrated: false }).length, 0, "remote authors fail closed until safety hydration");
assert.equal(project("2026-09-08", [event({ creatorId: "me" })], [], { safetyHydrated: false }).length, 1);
assert.equal(project("2026-09-08", [event({ creatorId: "me" })], [], { state: { ...state, group: { ...state.group, members: [] } } }).length, 0, "former members cannot view cached group events");
assert.deepEqual(GROUP_EVENT_REMINDER_MINUTES, [0, 5, 15, 30, 60, 1440]);

const read = (relative) => fs.readFileSync(new URL(`../${relative}`, import.meta.url), "utf8");
const query = read("src/cloud/groupHubContent.ts");
// Execute the actual page-loader function against a deterministic fluent
// transport. This proves pagination rather than merely checking for a limit.
const loaderSource = query.slice(query.indexOf("export async function loadGroupSchedule("), query.indexOf("/** Notification links"));
const fixtureRows = [
  { id: "0000", starts_at: "2026-07-01T10:00:00Z", ends_at: "2026-09-09T12:00:00Z" },
  ...Array.from({ length: 760 }, (_, i) => ({ id: String(i + 1).padStart(4, "0"), starts_at: "2026-09-08T10:00:00Z", ends_at: "2026-09-08T11:00:00Z" })),
];
let calls = 0;
let abortRequested = false;
const transport = { from(table) {
  assert.equal(table, "group_schedule_items");
  const filters = [];
  let cursor;
  let limit;
  let upper;
  let lower;
  let signal;
  return {
    select() { return this; },
    eq(column, value) { filters.push([column, value]); return this; },
    lt(column, value) { assert.equal(column, "starts_at"); upper = value; return this; },
    order() { return this; },
    limit(value) { limit = value; return this; },
    abortSignal(value) { signal = value; return this; },
    or(value) {
      if (value.includes("ends_at.gt.")) lower = value.split("ends_at.gt.")[1];
      else cursor = { start: value.match(/^starts_at\.gt\.(.*?),and/)[1], id: value.match(/id\.gt\.([^)]*)/)[1] };
      return this;
    },
    then(resolve, reject) {
      calls += 1;
      assert.deepEqual(filters, [["group_id", "g1"]]);
      assert.equal(limit, 250);
      if (abortRequested || signal?.aborted) return Promise.resolve({ data: null, error: { message: "Aborted" } }).then(resolve, reject);
      const data = fixtureRows.filter((row) => row.starts_at < upper && (row.starts_at >= lower || row.ends_at > lower) && (!cursor || row.starts_at > cursor.start || (row.starts_at === cursor.start && row.id > cursor.id))).slice(0, limit);
      return Promise.resolve({ data, error: null }).then(resolve, reject);
    },
  };
} };
const context = { exports: {}, supabase: transport, groupScheduleCalendarRange, dateKey, scheduleFromRow: (row) => row, cloudError: (error) => new Error(error.message) };
vm.runInNewContext(ts.transpileModule(loaderSource, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText, context);
const loaded = await context.exports.loadGroupSchedule("g1", groupScheduleCalendarRange("2026-09-08"));
assert.equal(loaded.length, 761, "all popular same-timestamp events and the old overlapping event are retained");
assert.equal(new Set(loaded.map((row) => row.id)).size, 761);
assert.equal(calls, 4, "four bounded keyset pages instead of a silent 500-row cap");
abortRequested = true;
await assert.rejects(() => context.exports.loadGroupSchedule("g1", groupScheduleCalendarRange("2026-09-08")), /Aborted/);
assert.match(query, /ends_at\.gt\.\$\{range\.startsAfter\}/, "overlapping events are loaded even if they start before this window");
assert.match(query, /\.order\("id", \{ ascending: true \}\)/, "timestamp ties have stable ordering");
assert.match(query, /\.limit\(250\)/);
assert.match(query, /id\.gt\.\$\{cursor\.id\}/);
assert.match(query, /query\.abortSignal\(signal\)/);
assert.match(query, /p_reminder_minutes: input\.allDay \? null : \(input\.reminderMinutes \?\? null\)/);
const hook = read("src/cloud/useGroupHubContent.ts");
assert.match(hook, /scheduleRequestControllers\.get\(scopeKey\)\?\.abort\(\)/);
assert.match(hook, /scheduleWriteVersions/, "realtime and optimistic writes fence stale reads");
assert.match(hook, /rowsByScope\.schedule\.delete\(scopeKey\)/, "unused month windows do not accumulate forever");
const screen = read("app/group-schedule.tsx");
assert.match(screen, /GroupScheduleCalendar/);
assert.match(screen, /loadGroupScheduleItem/);
assert.match(screen, /reminderMinutes: allDay \? undefined : reminderMinutes/);
assert.match(screen, /expectedRevision: editing\?\.revision/);
assert.match(screen, /item\.creatorId === state\.currentUserId \|\| canManageAll/);
assert.match(screen, /scheduleReminders === true/);
const calendar = read("src/components/GroupScheduleCalendar.tsx");
assert.match(calendar, /MonthCalendar/);
assert.match(calendar, /calendarWeekRange/);
assert.match(calendar, /scheduleEventsForHourSlot/);
assert.match(calendar, /width < 350 \? "day" : "week"/);
assert.match(calendar, /onLongPress=\{\(\) => onCreate\(date, hour\)\}/);
console.log("Group schedule: time-grid, month/week boundaries, timezones/DST, reminders, privacy and bounded cloud query regressions passed.");
