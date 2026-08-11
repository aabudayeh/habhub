import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const pauseHook = fs.readFileSync(
  path.join(root, "src", "cloud", "useFocusedCloudSyncPause.ts"),
  "utf8",
);
const tabLayout = fs.readFileSync(
  path.join(root, "app", "(tabs)", "_layout.tsx"),
  "utf8",
);
const gym = fs.readFileSync(
  path.join(root, "app", "(tabs)", "gym.tsx"),
  "utf8",
);

assert.match(
  tabLayout,
  /<Freeze freeze=\{!isFocused\}>/,
  "inactive web tabs must freeze their expensive mounted subtrees",
);
assert.match(
  pauseHook,
  /navigation\.addListener\("blur", releaseOnBlur\)/,
  "an imperative blur listener must release edit-mode cloud gates before a tab freezes",
);
assert.match(
  pauseHook,
  /navigation\.addListener\([\s\S]{0,80}"focus"[\s\S]{0,80}applyFocusedState/,
  "returning to a still-editing tab must restore its cloud gate",
);
assert.match(
  gym,
  /useFocusEffect\([\s\S]{0,500}setInterval\(\(\) => setTimerNow\(Date\.now\(\)\), 1000\)[\s\S]{0,160}clearInterval/,
  "the Gym display ticker must stop from the navigation blur cleanup even when the screen freezes",
);

console.log("Focused sync-gate and offscreen ticker validation passed.");
