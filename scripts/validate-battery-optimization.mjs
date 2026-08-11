import assert from "node:assert/strict";
import fs from "node:fs";

const read = (path) => fs.readFileSync(path, "utf8");
const nativeSource = read("plugins/habhub-android/java/HabHubNativeModule.kt");
const bridgeSource = read("src/notifications/batteryOptimization.ts");
const settingsSource = read("app/notifications.tsx");
const appConfig = read("app.json");
const pluginConfig = read("plugins/withHabHubAndroid.js");

assert.match(nativeSource, /PowerManager/);
assert.match(nativeSource, /isIgnoringBatteryOptimizations/);
assert.match(
  nativeSource,
  /Settings\.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS/,
  "The explicit settings action must open Android's user-managed exemption list",
);
assert.match(nativeSource, /Settings\.ACTION_APPLICATION_DETAILS_SETTINGS/);
assert.match(nativeSource, /Settings\.ACTION_BATTERY_SAVER_SETTINGS/);
assert.doesNotMatch(nativeSource, /ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS/);
assert.doesNotMatch(
  [appConfig, pluginConfig, nativeSource].join("\n"),
  /REQUEST_IGNORE_BATTERY_OPTIMIZATIONS/,
  "HabHub must not request the restricted direct-exemption permission",
);

assert.match(bridgeSource, /Platform\.OS === "android"/);
assert.match(bridgeSource, /getBatteryOptimizationStatus/);
assert.match(bridgeSource, /openBatteryOptimizationSettings/);
assert.match(settingsSource, /AppState\.addEventListener\("change"/);
assert.match(
  settingsSource,
  /async function reviewBatteryOptimization\(\)[\s\S]*await openBatteryOptimizationSettings\(\)/,
);
assert.match(settingsSource, /onPress=\{reviewBatteryOptimization\}/);

const effectStart = settingsSource.indexOf("useEffect(() => {");
const effectEnd = settingsSource.indexOf(
  "}, [refreshBatteryOptimization]);",
  effectStart,
);
assert.ok(effectStart >= 0 && effectEnd > effectStart);
assert.doesNotMatch(
  settingsSource.slice(effectStart, effectEnd),
  /openBatteryOptimizationSettings/,
  "Battery settings must never open automatically",
);

console.log(
  "Android battery-optimization status and user-initiated settings route validated.",
);
