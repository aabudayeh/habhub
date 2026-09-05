import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (relativePath) =>
  fs.readFileSync(path.join(repoRoot, relativePath), "utf8");
const sha256 = (source) =>
  crypto.createHash("sha256").update(source).digest("hex");
const generatedRootFlagIndex = process.argv.indexOf("--generated-root");
const generatedRoot =
  generatedRootFlagIndex >= 0
    ? path.resolve(process.argv[generatedRootFlagIndex + 1] ?? "")
    : repoRoot;
const requireGenerated =
  process.argv.includes("--require-generated") || generatedRootFlagIndex >= 0;

const RATIONALE_ACTION = "androidx.health.ACTION_SHOW_PERMISSIONS_RATIONALE";
const VIEW_USAGE_ACTION = "android.intent.action.VIEW_PERMISSION_USAGE";
const HEALTH_CATEGORY = "android.intent.category.HEALTH_PERMISSIONS";
const ACTIVITY_CLASS = "HabHubHealthConnectPrivacyActivity";
const ALIAS_NAME = "ViewPermissionUsageActivity";
const NOTIFICATION_OVERRIDE_PLUGIN =
  "./plugins/withAndroidNotificationMetadataOverrides";
const NOTIFICATION_METADATA_OVERRIDES = [
  {
    name: "com.google.firebase.messaging.default_notification_channel_id",
    attribute: "android:value",
  },
  {
    name: "com.google.firebase.messaging.default_notification_color",
    attribute: "android:resource",
  },
];

function pluginName(plugin) {
  return Array.isArray(plugin) ? plugin[0] : plugin;
}

function intentFilters(component) {
  return component?.["intent-filter"] ?? [];
}

function actionNames(component) {
  return intentFilters(component).flatMap((filter) =>
    (filter.action ?? [])
      .map((action) => action.$?.["android:name"])
      .filter(Boolean),
  );
}

function categoryNames(component) {
  return intentFilters(component).flatMap((filter) =>
    (filter.category ?? [])
      .map((category) => category.$?.["android:name"])
      .filter(Boolean),
  );
}

function asArray(value) {
  if (value == null) return [];
  return Array.isArray(value) ? value : [value];
}

const appConfig = JSON.parse(read("app.json")).expo;
const plugins = appConfig.plugins ?? [];
const healthPluginIndex = plugins.findIndex(
  (plugin) => pluginName(plugin) === "react-native-health-connect",
);
const privacyPluginIndex = plugins.findIndex(
  (plugin) => pluginName(plugin) === "./plugins/withHealthConnectPrivacy",
);
const notificationsPluginIndex = plugins.findIndex(
  (plugin) => pluginName(plugin) === "expo-notifications",
);
const notificationOverridePluginIndex = plugins.findIndex(
  (plugin) => pluginName(plugin) === NOTIFICATION_OVERRIDE_PLUGIN,
);
assert.ok(healthPluginIndex >= 0, "react-native-health-connect must be configured.");
assert.ok(
  privacyPluginIndex > healthPluginIndex,
  "The HabHub privacy override must be listed after react-native-health-connect.",
);
assert.ok(notificationsPluginIndex >= 0, "expo-notifications must be configured.");
assert.ok(
  notificationOverridePluginIndex > notificationsPluginIndex,
  "The Android notification metadata override must follow expo-notifications.",
);

const privacyPluginEntry = plugins[privacyPluginIndex];
assert.ok(Array.isArray(privacyPluginEntry), "The privacy plugin needs explicit options.");
const privacyUrl = privacyPluginEntry[1]?.privacyUrl;
const parsedPrivacyUrl = new URL(privacyUrl);
assert.equal(parsedPrivacyUrl.protocol, "https:");
assert.ok(parsedPrivacyUrl.pathname.endsWith("/privacy"));
assert.equal(parsedPrivacyUrl.username, "");
assert.equal(parsedPrivacyUrl.password, "");
assert.equal(parsedPrivacyUrl.search, "");
assert.equal(parsedPrivacyUrl.hash, "");

const pluginSource = read("plugins/withHealthConnectPrivacy.js");
const notificationOverridePluginSource = read(
  "plugins/withAndroidNotificationMetadataOverrides.js",
);
const templateSource = read(
  "plugins/health-connect-privacy/HabHubHealthConnectPrivacyActivity.kt",
);
assert.match(pluginSource, /withAndroidManifestPostProcessor/);
assert.match(pluginSource, /const generated = await nextMod/);
assert.match(pluginSource, /mainActivity\["intent-filter"\] = withoutHealthPrivacyFilters/);
assert.match(pluginSource, /android:targetActivity/);
assert.match(notificationOverridePluginSource, /withAndroidManifestPostProcessor/);
assert.match(notificationOverridePluginSource, /const generated = await nextMod/);
assert.match(notificationOverridePluginSource, /tools:replace/);
for (const override of NOTIFICATION_METADATA_OVERRIDES) {
  assert.ok(notificationOverridePluginSource.includes(override.name));
  assert.ok(notificationOverridePluginSource.includes(override.attribute));
}
assert.match(templateSource, /private const val PRIVACY_URL = __PRIVACY_URL__/);
assert.match(templateSource, /text = "HabHub privacy policy"/);
assert.match(templateSource, /text = PRIVACY_URL/);
assert.match(templateSource, /webView\.loadUrl\(PRIVACY_URL\)/);
assert.match(templateSource, /settings\.javaScriptEnabled = true/);
assert.match(templateSource, /settings\.domStorageEnabled = true/);
assert.match(templateSource, /MIXED_CONTENT_NEVER_ALLOW/);
assert.match(templateSource, /settings\.allowFileAccess = false/);
assert.match(templateSource, /settings\.allowContentAccess = false/);
assert.match(templateSource, /request\.url\.scheme\?\.lowercase\(\) != "https"/);

const expoCli = path.join(repoRoot, "node_modules", "expo", "bin", "cli");
const introspection = spawnSync(
  process.execPath,
  [expoCli, "config", "--type", "introspect", "--json"],
  {
    cwd: repoRoot,
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
    env: { ...process.env, FORCE_COLOR: "0", NO_COLOR: "1" },
  },
);
assert.equal(
  introspection.status,
  0,
  `Expo config introspection failed:\n${introspection.stderr}`,
);
const introspected = JSON.parse(introspection.stdout);
const manifest = introspected._internal?.modResults?.android?.manifest?.manifest;
assert.ok(manifest, "Expo introspection did not expose the Android manifest.");
const application = asArray(manifest.application)[0];
assert.ok(application, "Generated Android manifest has no application node.");
const activities = asArray(application.activity);
const aliases = asArray(application["activity-alias"]);
const metadata = asArray(application["meta-data"]);
const packageName = appConfig.android.package;
const activityName = `${packageName}.${ACTIVITY_CLASS}`;
const mainActivity = activities.find(
  (activity) => activity.$?.["android:name"] === ".MainActivity",
);
assert.ok(mainActivity, "Generated manifest has no .MainActivity.");
assert.ok(
  !actionNames(mainActivity).includes(RATIONALE_ACTION),
  "MainActivity must not handle the Health Connect rationale intent.",
);
assert.ok(
  !actionNames(mainActivity).includes(VIEW_USAGE_ACTION),
  "MainActivity must not handle Android 14 Health permission usage.",
);

const dedicatedActivities = activities.filter(
  (activity) => activity.$?.["android:name"] === activityName,
);
assert.equal(dedicatedActivities.length, 1, "Generate exactly one privacy activity.");
const dedicatedActivity = dedicatedActivities[0];
assert.equal(dedicatedActivity.$?.["android:exported"], "true");
assert.ok(actionNames(dedicatedActivity).includes(RATIONALE_ACTION));

const rationaleHandlers = activities.filter((activity) =>
  actionNames(activity).includes(RATIONALE_ACTION),
);
assert.deepEqual(
  rationaleHandlers.map((activity) => activity.$?.["android:name"]),
  [activityName],
  "Only the dedicated activity may handle the pre-Android-14 rationale intent.",
);

const usageAliases = aliases.filter((alias) =>
  actionNames(alias).includes(VIEW_USAGE_ACTION),
);
assert.equal(usageAliases.length, 1, "Generate exactly one Android 14 usage alias.");
const usageAlias = usageAliases[0];
assert.equal(usageAlias.$?.["android:name"], ALIAS_NAME);
assert.equal(usageAlias.$?.["android:exported"], "true");
assert.equal(usageAlias.$?.["android:targetActivity"], activityName);
assert.equal(
  usageAlias.$?.["android:permission"],
  "android.permission.START_VIEW_PERMISSION_USAGE",
);
assert.ok(categoryNames(usageAlias).includes(HEALTH_CATEGORY));

for (const override of NOTIFICATION_METADATA_OVERRIDES) {
  const item = metadata.find(
    (candidate) => candidate.$?.["android:name"] === override.name,
  );
  assert.ok(item, `Generated manifest is missing ${override.name}.`);
  const replacedAttributes = String(item.$?.["tools:replace"] ?? "")
    .split(",")
    .map((attribute) => attribute.trim());
  assert.ok(
    replacedAttributes.includes(override.attribute),
    `${override.name} must replace ${override.attribute} during manifest merging.`,
  );
}

if (requireGenerated) {
  const generatedManifestPath = path.join(
    generatedRoot,
    "android",
    "app",
    "src",
    "main",
    "AndroidManifest.xml",
  );
  const generatedActivityPath = path.join(
    generatedRoot,
    "android",
    "app",
    "src",
    "main",
    "java",
    ...packageName.split("."),
    `${ACTIVITY_CLASS}.kt`,
  );
  assert.ok(fs.existsSync(generatedManifestPath), "Clean prebuild manifest is missing.");
  assert.ok(fs.existsSync(generatedActivityPath), "Generated privacy Activity is missing.");
  const generatedManifest = fs.readFileSync(generatedManifestPath, "utf8");
  const generatedActivity = fs.readFileSync(generatedActivityPath, "utf8");
  const mainActivityXml = generatedManifest.match(
    /<activity\s+[^>]*android:name="\.MainActivity"[\s\S]*?<\/activity>/,
  )?.[0];
  assert.ok(mainActivityXml, "Could not isolate MainActivity in generated XML.");
  assert.ok(!mainActivityXml.includes(RATIONALE_ACTION));
  assert.ok(!mainActivityXml.includes(VIEW_USAGE_ACTION));
  assert.match(
    generatedManifest,
    new RegExp(`android:name="${activityName.replaceAll(".", "\\.")}"`),
  );
  assert.match(
    generatedManifest,
    new RegExp(`android:targetActivity="${activityName.replaceAll(".", "\\.")}"`),
  );
  assert.match(
    generatedActivity,
    new RegExp(`package ${packageName.replaceAll(".", "\\.")}`),
  );
  for (const override of NOTIFICATION_METADATA_OVERRIDES) {
    const metadataXml = generatedManifest.match(
      new RegExp(
        `<meta-data[^>]*android:name="${override.name.replaceAll(".", "\\.")}"[^>]*/>`,
      ),
    )?.[0];
    assert.ok(metadataXml, `Generated XML is missing ${override.name}.`);
    assert.ok(
      metadataXml.includes(`tools:replace="${override.attribute}"`),
      `Generated XML must mark ${override.attribute} replaceable for ${override.name}.`,
    );
  }
  assert.ok(
    generatedActivity.includes(
      `private const val PRIVACY_URL = "${privacyUrl}"`,
    ),
  );
  assert.ok(!generatedActivity.includes("__PRIVACY_URL__"));
  console.log(
    `Generated manifest: ${generatedManifestPath} sha256=${sha256(generatedManifest)}`,
  );
  console.log(
    `Generated Activity: ${generatedActivityPath} sha256=${sha256(generatedActivity)}`,
  );
}

console.log("MainActivity Health rationale handlers: 0");
console.log(`Dedicated rationale Activity: ${activityName}`);
console.log(
  `Android 14 usage alias target: ${usageAlias.$?.["android:targetActivity"]}`,
);
console.log(`HTTPS privacy policy: ${privacyUrl}`);
console.log("Firebase notification metadata merge overrides: 2");
