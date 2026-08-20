const fs = require("fs");
const path = require("path");
const {
  AndroidConfig,
  withAndroidManifest,
  withDangerousMod,
  withMainApplication,
} = require("expo/config-plugins");

const NATIVE_SOURCES = [
  "HabHubNativeModule.kt",
  "HabHubNativePackage.kt",
  "HabHubNotificationsService.kt",
  "HabHubWidgetConfigActivity.kt",
  "HabHubWidgetProvider.kt",
];

const RESOURCE_FILES = [
  ["drawable", "habhub_widget_background.xml"],
  ["drawable", "habhub_widget_background_complete.xml"],
  ["drawable", "habhub_widget_badge.xml"],
  ["drawable", "habhub_widget_badge_complete.xml"],
  ["drawable", "habhub_widget_goal.xml"],
  ["drawable", "habhub_widget_goal_complete.xml"],
  ["drawable", "habhub_widget_progress_lime.xml"],
  ["drawable", "habhub_widget_progress_gold.xml"],
  ["layout", "habhub_widget.xml"],
  ["values", "habhub_widgets.xml"],
  ["values-ar", "habhub_widgets.xml"],
  ["values-de", "habhub_widgets.xml"],
  ["values-es", "habhub_widgets.xml"],
  ["values-fr", "habhub_widgets.xml"],
  ["values-ru", "habhub_widgets.xml"],
  ["values-sv", "habhub_widgets.xml"],
  ["values-zh-rCN", "habhub_widgets.xml"],
  ["xml", "habhub_widget_small_info.xml"],
  ["xml", "habhub_widget_square_info.xml"],
  ["xml", "habhub_widget_wide_info.xml"],
];

const PROVIDERS = [
  ["HabHubSmallWidgetProvider", "@xml/habhub_widget_small_info"],
  ["HabHubSquareWidgetProvider", "@xml/habhub_widget_square_info"],
  ["HabHubWideWidgetProvider", "@xml/habhub_widget_wide_info"],
];

function appWidgetReceiver(packageName, className, infoResource) {
  return {
    $: {
      "android:name": `${packageName}.${className}`,
      "android:exported": "false",
      "android:label": "HabHub",
    },
    "intent-filter": [
      {
        action: [
          {
            $: {
              "android:name": "android.appwidget.action.APPWIDGET_UPDATE",
            },
          },
        ],
      },
    ],
    "meta-data": [
      {
        $: {
          "android:name": "android.appwidget.provider",
          "android:resource": infoResource,
        },
      },
    ],
  };
}

function withNativeManifest(config, packageName) {
  return withAndroidManifest(config, (androidConfig) => {
    const manifest = androidConfig.modResults.manifest;
    const application = AndroidConfig.Manifest.getMainApplicationOrThrow(
      androidConfig.modResults,
    );

    manifest["uses-permission"] = manifest["uses-permission"] ?? [];
    if (
      !manifest["uses-permission"].some(
        (permission) =>
          permission.$?.["android:name"] ===
          "android.permission.PACKAGE_USAGE_STATS",
      )
    ) {
      manifest["uses-permission"].push({
        $: { "android:name": "android.permission.PACKAGE_USAGE_STATS" },
      });
    }
    if (
      !manifest["uses-permission"].some(
        (permission) =>
          permission.$?.["android:name"] ===
          "android.permission.SCHEDULE_EXACT_ALARM",
      )
    ) {
      manifest["uses-permission"].push({
        $: { "android:name": "android.permission.SCHEDULE_EXACT_ALARM" },
      });
    }

    const configActivity = `${packageName}.HabHubWidgetConfigActivity`;
    application.activity = (application.activity ?? []).filter(
      (activity) => activity.$?.["android:name"] !== configActivity,
    );
    application.activity.push({
      $: {
        "android:name": configActivity,
        "android:exported": "true",
        "android:theme": "@style/Theme.AppCompat.DayNight.NoActionBar",
      },
    });

    const notificationService = `${packageName}.HabHubNotificationsService`;
    const providerNames = new Set(
      PROVIDERS.map(([className]) => `${packageName}.${className}`),
    );
    application.receiver = (application.receiver ?? []).filter(
      (receiver) =>
        receiver.$?.["android:name"] !== notificationService &&
        !providerNames.has(receiver.$?.["android:name"]),
    );
    // expo-notifications resolves one app-local receiver when it creates its
    // category action PendingIntents. This subclass keeps Expo's normal
    // delivery path but updates the workout row synchronously before Android's
    // deferred JS background job runs, which is important while the phone is
    // locked or in Doze.
    application.receiver.unshift({
      $: {
        "android:name": notificationService,
        "android:enabled": "true",
        "android:exported": "false",
      },
      "intent-filter": [
        {
          $: { "android:priority": "1000" },
          action: [
            {
              $: {
                "android:name":
                  "expo.modules.notifications.NOTIFICATION_EVENT",
              },
            },
          ],
        },
      ],
    });
    PROVIDERS.forEach(([className, infoResource]) => {
      application.receiver.push(
        appWidgetReceiver(packageName, className, infoResource),
      );
    });

    return androidConfig;
  });
}

function withNativePackageRegistration(config) {
  return withMainApplication(config, (mainApplication) => {
    if (mainApplication.modResults.language !== "kt") {
      throw new Error("HabHub Android integration requires a Kotlin MainApplication.");
    }
    let contents = mainApplication.modResults.contents;
    if (!contents.includes("add(HabHubNativePackage())")) {
      const packagesBlock = /PackageList\(this\)\.packages\.apply\s*\{/;
      if (!packagesBlock.test(contents)) {
        throw new Error("Could not locate the React Native package list.");
      }
      contents = contents.replace(
        packagesBlock,
        (match) => `${match}\n              add(HabHubNativePackage())`,
      );
    }
    mainApplication.modResults.contents = contents;
    return mainApplication;
  });
}

function withNativeFiles(config, packageName) {
  return withDangerousMod(config, [
    "android",
    async (androidConfig) => {
      const projectRoot = androidConfig.modRequest.platformProjectRoot;
      const templateRoot = path.join(__dirname, "habhub-android");
      const javaRoot = path.join(
        projectRoot,
        "app",
        "src",
        "main",
        "java",
        ...packageName.split("."),
      );
      fs.mkdirSync(javaRoot, { recursive: true });

      for (const fileName of NATIVE_SOURCES) {
        const source = fs
          .readFileSync(path.join(templateRoot, "java", fileName), "utf8")
          .replace(/^package\s+[^\r\n]+/m, `package ${packageName}`);
        fs.writeFileSync(path.join(javaRoot, fileName), source);
      }

      for (const [resourceType, fileName] of RESOURCE_FILES) {
        const destination = path.join(
          projectRoot,
          "app",
          "src",
          "main",
          "res",
          resourceType,
        );
        fs.mkdirSync(destination, { recursive: true });
        const source = fs
          .readFileSync(
            path.join(templateRoot, "res", resourceType, fileName),
            "utf8",
          )
          .replaceAll("__ANDROID_PACKAGE__", packageName);
        fs.writeFileSync(path.join(destination, fileName), source);
      }

      return androidConfig;
    },
  ]);
}

module.exports = function withHabHubAndroid(config) {
  const packageName = config.android?.package;
  if (!packageName) {
    throw new Error("Set expo.android.package before enabling HabHub Android.");
  }
  config = withNativeManifest(config, packageName);
  config = withNativePackageRegistration(config);
  return withNativeFiles(config, packageName);
};
