import assert from "node:assert/strict";
import fs from "node:fs";

import {
  DEFAULT_TAB_ORDER,
  isFixedNavigationPage,
  navigationDefaultsForVersion,
  normalizeTabOrder,
} from "../src/domain/navigation.ts";

assert.deepEqual(DEFAULT_TAB_ORDER, [
  "index",
  "status",
  "log",
  "group",
  "insights",
  "gym",
  "calendar",
  "journal",
  "performance",
  "chat",
]);

assert.deepEqual(
  normalizeTabOrder([
    "chat",
    "gym",
    "status",
    "index",
    "gym",
    "group",
  ]),
  [
    "index",
    "status",
    "gym",
    "group",
    "log",
    "insights",
    "calendar",
    "journal",
    "performance",
    "chat",
  ],
  "fixed tabs must be repaired without losing the user's middle-page order",
);

assert.deepEqual(
  normalizeTabOrder(undefined).filter((id) => id !== "status"),
  [
    "index",
    "log",
    "group",
    "insights",
    "gym",
    "calendar",
    "journal",
    "performance",
    "chat",
  ],
  "hiding Status must leave Today first and Chat last",
);

assert.equal(navigationDefaultsForVersion({ showStatus: false }, 24).showStatus, true);
assert.equal(
  navigationDefaultsForVersion({ showStatus: false }, 25).showStatus,
  false,
  "a post-migration Status opt-out must remain disabled",
);
assert.equal(navigationDefaultsForVersion({}, 25).showStatus, true);
assert.equal(isFixedNavigationPage("index"), true);
assert.equal(isFixedNavigationPage("status"), true);
assert.equal(isFixedNavigationPage("chat"), true);
assert.equal(isFixedNavigationPage("group"), false);

const tabs = fs.readFileSync("app/(tabs)/_layout.tsx", "utf8");
const display = fs.readFileSync("app/display-settings.tsx", "utf8");
const onboarding = fs.readFileSync("app/onboarding.tsx", "utf8");
const seed = fs.readFileSync("src/data/seed.ts", "utf8");
const provider = fs.readFileSync("src/state/AppProvider.tsx", "utf8");
const cloudProvider = fs.readFileSync("src/cloud/CloudSyncProvider.tsx", "utf8");

assert.match(tabs, /const showStatus = state\.settings\.showStatus !== false/);
assert.match(tabs, /normalizeTabOrder\(state\.settings\.tabOrder\)/);
assert.match(display, /page\.id !== "status" \|\| state\.settings\.showStatus !== false/);
assert.match(display, /key === "showStatus"[\s\S]{0,100}state\.settings\.showStatus !== false/);
assert.match(display, /isFixedNavigationPage\(id\)/);
assert.match(onboarding, /landingPage === "status" \|\| state\.settings\.showStatus !== false/);
assert.match(seed, /version: 26/);
assert.match(seed, /showStatus: true/);
assert.match(provider, /const restoredState: AppState = \{[\s\S]{0,100}version: 26/);
assert.doesNotMatch(cloudProvider, /version: 24/);

console.log(
  "Status-first-pair, Chat-right-edge, visibility, onboarding, and v26 migration defaults validated.",
);
