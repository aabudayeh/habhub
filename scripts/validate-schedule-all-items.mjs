import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

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

console.log("Schedule ALL daily-overview validation passed.");
