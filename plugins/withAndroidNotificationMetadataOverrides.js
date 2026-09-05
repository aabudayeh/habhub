const {
  AndroidConfig,
  createRunOncePlugin,
  withBaseMod,
} = require("expo/config-plugins");

const PLUGIN_NAME = "with-habhub-android-notification-metadata-overrides";
const PLUGIN_VERSION = "1.0.0";
const TOOLS_NAMESPACE = "http://schemas.android.com/tools";
const OVERRIDES = [
  {
    name: "com.google.firebase.messaging.default_notification_channel_id",
    attribute: "android:value",
  },
  {
    name: "com.google.firebase.messaging.default_notification_color",
    attribute: "android:resource",
  },
];

function appendToolsReplace(currentValue, attribute) {
  const attributes = new Set(
    String(currentValue ?? "")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean),
  );
  attributes.add(attribute);
  return [...attributes].join(",");
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

function withAndroidNotificationMetadataOverrides(config) {
  return withAndroidManifestPostProcessor(config, (androidConfig) => {
    const manifest = androidConfig.modResults.manifest;
    manifest.$ = manifest.$ ?? {};
    manifest.$["xmlns:tools"] = TOOLS_NAMESPACE;

    const application =
      AndroidConfig.Manifest.getMainApplicationOrThrow(
        androidConfig.modResults,
      );
    const metadata = application["meta-data"] ?? [];

    for (const override of OVERRIDES) {
      const item = metadata.find(
        (candidate) => candidate.$?.["android:name"] === override.name,
      );
      if (!item) {
        throw new Error(
          `${PLUGIN_NAME} expected Expo Notifications to generate ${override.name}.`,
        );
      }
      item.$["tools:replace"] = appendToolsReplace(
        item.$["tools:replace"],
        override.attribute,
      );
    }

    return androidConfig;
  });
}

module.exports = createRunOncePlugin(
  withAndroidNotificationMetadataOverrides,
  PLUGIN_NAME,
  PLUGIN_VERSION,
);
