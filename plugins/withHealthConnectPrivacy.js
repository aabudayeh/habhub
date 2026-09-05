const fs = require("fs");
const path = require("path");
const {
  AndroidConfig,
  createRunOncePlugin,
  withBaseMod,
  withDangerousMod,
} = require("expo/config-plugins");

const PLUGIN_NAME = "with-habhub-health-connect-privacy";
const PLUGIN_VERSION = "1.0.0";
const ACTIVITY_CLASS = "HabHubHealthConnectPrivacyActivity";
const USAGE_ALIAS = "ViewPermissionUsageActivity";
const RATIONALE_ACTION = "androidx.health.ACTION_SHOW_PERMISSIONS_RATIONALE";
const VIEW_USAGE_ACTION = "android.intent.action.VIEW_PERMISSION_USAGE";
const HEALTH_PERMISSIONS_CATEGORY =
  "android.intent.category.HEALTH_PERMISSIONS";

function validatedPrivacyUrl(value) {
  if (typeof value !== "string" || value.trim() !== value) {
    throw new Error(
      `${PLUGIN_NAME} requires a whitespace-free privacyUrl string.`,
    );
  }
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${PLUGIN_NAME} privacyUrl must be an absolute URL.`);
  }
  if (
    url.protocol !== "https:" ||
    !url.hostname ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    !url.pathname.endsWith("/privacy")
  ) {
    throw new Error(
      `${PLUGIN_NAME} privacyUrl must be a public HTTPS /privacy URL without credentials, query, or fragment.`,
    );
  }
  return url.toString();
}

function actionsFor(intentFilter) {
  return (intentFilter.action ?? [])
    .map((action) => action.$?.["android:name"])
    .filter(Boolean);
}

function withoutHealthPrivacyFilters(intentFilters = []) {
  return intentFilters.filter((intentFilter) => {
    const actions = actionsFor(intentFilter);
    return (
      !actions.includes(RATIONALE_ACTION) &&
      !actions.includes(VIEW_USAGE_ACTION)
    );
  });
}

function withAndroidManifestPostProcessor(config, action) {
  return withBaseMod(config, {
    platform: "android",
    mod: "manifest",
    isProvider: false,
    skipEmptyMod: false,
    isIntrospective: true,
    saveToInternal: false,
    async action({ modRequest: { nextMod, ...modRequest }, ...androidConfig }) {
      const generated = await nextMod({ ...androidConfig, modRequest });
      return action(generated);
    },
  });
}

function withDedicatedHealthPrivacyManifest(config, packageName) {
  return withAndroidManifestPostProcessor(config, (androidConfig) => {
    const application =
      AndroidConfig.Manifest.getMainApplicationOrThrow(
        androidConfig.modResults,
      );
    const mainActivity = AndroidConfig.Manifest.getMainActivityOrThrow(
      androidConfig.modResults,
    );
    const activityName = `${packageName}.${ACTIVITY_CLASS}`;

    // react-native-health-connect sends both rationale entry points to the
    // React MainActivity. Remove those dependency-owned routes so Health
    // Connect always opens the dedicated, immediately visible policy screen.
    mainActivity["intent-filter"] = withoutHealthPrivacyFilters(
      mainActivity["intent-filter"],
    );

    application.activity = (application.activity ?? []).filter(
      (activity) => activity.$?.["android:name"] !== activityName,
    );
    application.activity.push({
      $: {
        "android:name": activityName,
        "android:exported": "true",
        "android:label": "HabHub privacy policy",
        "android:theme": "@android:style/Theme.Material.Light.NoActionBar",
      },
      "intent-filter": [
        {
          action: [{ $: { "android:name": RATIONALE_ACTION } }],
        },
      ],
    });

    application["activity-alias"] = (
      application["activity-alias"] ?? []
    ).filter((alias) => {
      const aliasName = alias.$?.["android:name"];
      const hasViewUsageAction = (alias["intent-filter"] ?? []).some(
        (intentFilter) => actionsFor(intentFilter).includes(VIEW_USAGE_ACTION),
      );
      return (
        aliasName !== USAGE_ALIAS &&
        aliasName !== `${packageName}.${USAGE_ALIAS}` &&
        !hasViewUsageAction
      );
    });
    application["activity-alias"].push({
      $: {
        "android:name": USAGE_ALIAS,
        "android:exported": "true",
        "android:targetActivity": activityName,
        "android:permission":
          "android.permission.START_VIEW_PERMISSION_USAGE",
      },
      "intent-filter": [
        {
          action: [{ $: { "android:name": VIEW_USAGE_ACTION } }],
          category: [
            { $: { "android:name": HEALTH_PERMISSIONS_CATEGORY } },
          ],
        },
      ],
    });

    return androidConfig;
  });
}

function withHealthPrivacyActivity(config, packageName, privacyUrl) {
  return withDangerousMod(config, [
    "android",
    async (androidConfig) => {
      const projectRoot = androidConfig.modRequest.platformProjectRoot;
      const destinationDirectory = path.join(
        projectRoot,
        "app",
        "src",
        "main",
        "java",
        ...packageName.split("."),
      );
      const template = fs.readFileSync(
        path.join(
          __dirname,
          "health-connect-privacy",
          `${ACTIVITY_CLASS}.kt`,
        ),
        "utf8",
      );
      const source = template
        .replace(/^package\s+[^\r\n]+/m, `package ${packageName}`)
        .replace("__PRIVACY_URL__", JSON.stringify(privacyUrl));

      fs.mkdirSync(destinationDirectory, { recursive: true });
      fs.writeFileSync(
        path.join(destinationDirectory, `${ACTIVITY_CLASS}.kt`),
        source,
      );
      return androidConfig;
    },
  ]);
}

function withHealthConnectPrivacy(config, options = {}) {
  const packageName = config.android?.package;
  if (!packageName) {
    throw new Error(
      `Set expo.android.package before enabling ${PLUGIN_NAME}.`,
    );
  }
  const privacyUrl = validatedPrivacyUrl(options.privacyUrl);
  config = withDedicatedHealthPrivacyManifest(config, packageName);
  return withHealthPrivacyActivity(config, packageName, privacyUrl);
}

module.exports = createRunOncePlugin(
  withHealthConnectPrivacy,
  PLUGIN_NAME,
  PLUGIN_VERSION,
);
