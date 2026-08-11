import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");

const chat = read("app/(tabs)/chat.tsx");
const tabs = read("app/(tabs)/_layout.tsx");
const appConfig = read("app.json");
const manifest = read("android/app/src/main/AndroidManifest.xml");

assert.match(
  chat,
  /enabled=\{Platform\.OS === "ios"\}[\s\S]*?behavior="padding"/,
  "Only iOS may apply KeyboardAvoidingView padding",
);
assert.doesNotMatch(
  chat,
  /Platform\.OS === "android" && keyboardVisible|behavior=\{Platform\.OS === "ios" \? "padding" : "height"\}/,
  "Android must not double-count adjustResize with a KAV height",
);
assert.match(
  chat,
  /paddingBottom:[\s\S]*?Platform\.OS === "android"[\s\S]*?\? 0[\s\S]*?: keyboardVisible[\s\S]*?\? 0[\s\S]*?: tabBarHeight/,
  "Android composer must use its navigator scene bottom; web/iOS reserve the overlay",
);
assert.match(
  tabs,
  /route\.name === "chat" && Platform\.OS !== "android"[\s\S]*?\? "absolute"/,
  "Android Chat tab bar must remain in normal navigator layout",
);
assert.match(
  tabs,
  /tabBarHideOnKeyboard: Platform\.OS !== "web"/,
  "Native tab bar must hide while the IME is open",
);
assert.match(appConfig, /"softwareKeyboardLayoutMode": "resize"/);
assert.match(manifest, /android:windowSoftInputMode="adjustResize"/);

const pluginSource = read("plugins/habhub-android/java/HabHubWidgetProvider.kt");
const nativeSource = read(
  "android/app/src/main/java/app/paceboard/mobile/HabHubWidgetProvider.kt",
);
assert.equal(
  pluginSource.replace("__ANDROID_PACKAGE__", "app.paceboard.mobile"),
  nativeSource,
  "Generated widget renderer must match its config-plugin source",
);

const pluginConfig = read("plugins/withHabHubAndroid.js");
const widgetLayout = read("plugins/habhub-android/res/layout/habhub_widget.xml");
const requiredResources = [
  "habhub_widget_badge.xml",
  "habhub_widget_badge_complete.xml",
  "habhub_widget_goal.xml",
  "habhub_widget_goal_complete.xml",
  "habhub_widget_progress_lime.xml",
  "habhub_widget_progress_gold.xml",
];
for (const resource of requiredResources) {
  assert.match(pluginConfig, new RegExp(resource.replace(".", "\\.")));
  assert.ok(
    fs.existsSync(path.join(root, "plugins/habhub-android/res/drawable", resource)),
    `Missing plugin resource ${resource}`,
  );
  assert.ok(
    fs.existsSync(path.join(root, "android/app/src/main/res/drawable", resource)),
    `Missing generated Android resource ${resource}`,
  );
}

for (const id of [
  "widget_completion_badge",
  "widget_badge_value",
  "widget_progress_lime",
  "widget_goal_1",
  "widget_goal_2",
  "widget_goal_3",
]) {
  assert.match(widgetLayout, new RegExp(id));
}
assert.match(pluginSource, /if \(oneRow\) View\.GONE else View\.VISIBLE/);
assert.match(pluginSource, /if \(minWidth < 150\)[\s\S]*widget_goal_2[\s\S]*widget_goal_3/);
assert.match(pluginSource, /habhub_widget_background_complete/);
assert.match(pluginSource, /habhub_widget_badge_complete/);
assert.match(pluginSource, /habhub_widget_goal_complete/);
assert.doesNotMatch(pluginSource, /ValueAnimator|ObjectAnimator|AnimationUtils/);

console.log("Native Chat layout and all three RemoteViews widget modes validated.");
