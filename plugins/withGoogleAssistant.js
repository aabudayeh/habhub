const fs = require("fs");
const path = require("path");
const {
  AndroidConfig,
  withAndroidManifest,
  withDangerousMod,
} = require("expo/config-plugins");

function shortcutsXml(scheme) {
  return `<?xml version="1.0" encoding="utf-8"?>
<shortcuts
    xmlns:android="http://schemas.android.com/apk/res/android"
    xmlns:app="http://schemas.android.com/apk/res-auto">

  <capability
      android:name="custom.actions.intent.LOG_TRACKER"
      app:queryPatterns="@array/assistant_log_tracker_queries">
    <intent android:action="android.intent.action.VIEW">
      <url-template android:value="${scheme}://assistant-log?kind=number&amp;auto=true{&amp;amount,unit,tracker}" />
      <parameter
          android:name="amount"
          android:key="amount"
          android:mimeType="https://schema.org/Number"
          android:required="true" />
      <parameter
          android:name="unit"
          android:key="unit"
          android:mimeType="https://schema.org/Text" />
      <parameter
          android:name="tracker"
          android:key="tracker"
          android:mimeType="https://schema.org/Text"
          android:required="true" />
    </intent>
    <intent android:action="android.intent.action.VIEW">
      <url-template android:value="${scheme}://assistant-log?kind=number" />
    </intent>
  </capability>

  <capability
      android:name="custom.actions.intent.LOG_FOOD"
      app:queryPatterns="@array/assistant_log_food_queries">
    <intent android:action="android.intent.action.VIEW">
      <url-template android:value="${scheme}://assistant-log?kind=food&amp;auto=true{&amp;calories,meal,food}" />
      <parameter
          android:name="calories"
          android:key="calories"
          android:mimeType="https://schema.org/Number"
          android:required="true" />
      <parameter
          android:name="meal"
          android:key="meal"
          android:mimeType="https://schema.org/Text" />
      <parameter
          android:name="food"
          android:key="food"
          android:mimeType="https://schema.org/Text" />
    </intent>
    <intent android:action="android.intent.action.VIEW">
      <url-template android:value="${scheme}://assistant-log?kind=food" />
    </intent>
  </capability>

  <capability
      android:name="custom.actions.intent.LOG_BLOOD_PRESSURE"
      app:queryPatterns="@array/assistant_log_blood_pressure_queries">
    <intent android:action="android.intent.action.VIEW">
      <url-template android:value="${scheme}://assistant-log?kind=blood_pressure&amp;auto=true{&amp;systolic,diastolic,pulse}" />
      <parameter
          android:name="systolic"
          android:key="systolic"
          android:mimeType="https://schema.org/Number"
          android:required="true" />
      <parameter
          android:name="diastolic"
          android:key="diastolic"
          android:mimeType="https://schema.org/Number"
          android:required="true" />
      <parameter
          android:name="pulse"
          android:key="pulse"
          android:mimeType="https://schema.org/Number" />
    </intent>
    <intent android:action="android.intent.action.VIEW">
      <url-template android:value="${scheme}://assistant-log?kind=blood_pressure" />
    </intent>
  </capability>

  <capability
      android:name="custom.actions.intent.COMPLETE_TRACKER"
      app:queryPatterns="@array/assistant_complete_tracker_queries">
    <intent android:action="android.intent.action.VIEW">
      <url-template android:value="${scheme}://assistant-log?kind=complete&amp;auto=true{&amp;tracker}" />
      <parameter
          android:name="tracker"
          android:key="tracker"
          android:mimeType="https://schema.org/Text"
          android:required="true" />
    </intent>
    <intent android:action="android.intent.action.VIEW">
      <url-template android:value="${scheme}://assistant-log?kind=complete" />
    </intent>
  </capability>

  <capability
      android:name="custom.actions.intent.LOG_TEXT_TRACKER"
      app:queryPatterns="@array/assistant_log_text_queries">
    <intent android:action="android.intent.action.VIEW">
      <url-template android:value="${scheme}://assistant-log?kind=text&amp;auto=true{&amp;value,tracker}" />
      <parameter
          android:name="value"
          android:key="value"
          android:mimeType="https://schema.org/Text"
          android:required="true" />
      <parameter
          android:name="tracker"
          android:key="tracker"
          android:mimeType="https://schema.org/Text"
          android:required="true" />
    </intent>
    <intent android:action="android.intent.action.VIEW">
      <url-template android:value="${scheme}://assistant-log?kind=text" />
    </intent>
  </capability>

  <capability android:name="actions.intent.GET_THING">
    <intent android:action="android.intent.action.VIEW">
      <url-template android:value="${scheme}://food-search{?q}" />
      <parameter
          android:name="thing.name"
          android:key="q"
          android:required="true" />
    </intent>
    <intent android:action="android.intent.action.VIEW">
      <url-template android:value="${scheme}://food-search" />
    </intent>
  </capability>

  <shortcut
      android:shortcutId="assistant_log_tracker"
      android:enabled="true"
      android:icon="@mipmap/ic_launcher"
      android:shortcutShortLabel="@string/assistant_shortcut_log"
      android:shortcutLongLabel="@string/assistant_shortcut_log_long">
    <intent
        android:action="android.intent.action.VIEW"
        android:data="${scheme}://assistant-log" />
    <capability-binding android:key="custom.actions.intent.LOG_TRACKER" />
  </shortcut>
</shortcuts>
`;
}

const queryPatternsXml = `<?xml version="1.0" encoding="utf-8"?>
<resources>
  <string name="assistant_shortcut_log">Voice log</string>
  <string name="assistant_shortcut_log_long">Log with Google Assistant</string>

  <string-array name="assistant_log_tracker_queries">
    <item>log $amount $unit of $tracker</item>
    <item>record $amount $unit of $tracker</item>
    <item>add $amount $unit of $tracker to my log</item>
    <item>add $amount $unit to $tracker</item>
    <item>log $amount $unit for $tracker</item>
    <item>record $amount $unit for $tracker</item>
    <item>log $tracker as $amount $unit</item>
    <item>log $amount for $tracker</item>
    <item>record $amount for $tracker</item>
    <item>add $amount to $tracker</item>
  </string-array>

  <string-array name="assistant_log_food_queries">
    <item>log $calories calories as $meal</item>
    <item>add $calories calories to my $meal</item>
    <item>add $calories calories to my food log as $meal</item>
    <item>add $calories kcals to my food log as $meal</item>
    <item>log $calories kcal as $meal</item>
    <item>log $food with $calories calories as $meal</item>
    <item>add $food with $calories calories to my $meal</item>
    <item>log $calories calories of $food</item>
  </string-array>

  <string-array name="assistant_log_blood_pressure_queries">
    <item>log blood pressure $systolic over $diastolic</item>
    <item>record blood pressure $systolic over $diastolic</item>
    <item>log blood pressure $systolic over $diastolic with pulse $pulse</item>
    <item>record BP $systolic over $diastolic pulse $pulse</item>
  </string-array>

  <string-array name="assistant_complete_tracker_queries">
    <item>mark $tracker complete</item>
    <item>mark $tracker as done</item>
    <item>log that I completed $tracker</item>
    <item>record $tracker as complete</item>
  </string-array>

  <string-array name="assistant_log_text_queries">
    <item>log $value for $tracker</item>
    <item>record $value for $tracker</item>
    <item>add $value to $tracker</item>
  </string-array>
</resources>
`;

module.exports = function withGoogleAssistant(config, options = {}) {
  const scheme = options.scheme || config.scheme || "paceboard";

  config = withAndroidManifest(config, (androidConfig) => {
    const activity = AndroidConfig.Manifest.getMainActivityOrThrow(
      androidConfig.modResults,
    );
    const metadata = activity["meta-data"] ?? [];
    const filtered = metadata.filter(
      (item) => item.$?.["android:name"] !== "android.app.shortcuts",
    );
    activity["meta-data"] = [
      ...filtered,
      {
        $: {
          "android:name": "android.app.shortcuts",
          "android:resource": "@xml/shortcuts",
        },
      },
    ];
    return androidConfig;
  });

  return withDangerousMod(config, [
    "android",
    async (androidConfig) => {
      const projectRoot = androidConfig.modRequest.platformProjectRoot;
      const xmlDir = path.join(projectRoot, "app", "src", "main", "res", "xml");
      const valuesDir = path.join(
        projectRoot,
        "app",
        "src",
        "main",
        "res",
        "values",
      );
      fs.mkdirSync(xmlDir, { recursive: true });
      fs.mkdirSync(valuesDir, { recursive: true });
      fs.writeFileSync(
        path.join(xmlDir, "shortcuts.xml"),
        shortcutsXml(scheme),
      );
      fs.writeFileSync(
        path.join(valuesDir, "assistant_queries.xml"),
        queryPatternsXml,
      );
      return androidConfig;
    },
  ]);
};
