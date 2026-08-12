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
  /enabled=\{[\s\S]*?Platform\.OS === "ios" \|\|[\s\S]*?Platform\.OS === "android" && keyboardVisible[\s\S]*?\}[\s\S]*?behavior="padding"/,
  "Android Chat must enable measured KAV padding only while the IME is visible",
);
assert.doesNotMatch(
  chat,
  /behavior=\{Platform\.OS === "ios" \? "padding" : "height"\}|behavior="height"/,
  "Android must not combine adjustResize with a fixed KAV height",
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
const widgetConfig = read(
  "plugins/habhub-android/java/HabHubWidgetConfigActivity.kt",
);
const widgetBridge = read("src/widgets/WidgetSnapshotBridge.tsx");
const widgetTypes = read("src/widgets/index.ts");

assert.match(pluginConfig, /\["layout", "habhub_widget\.xml"\]/);
assert.match(widgetLayout, /android:id="@\+id\/widget_card_image"/);
assert.match(widgetLayout, /android:scaleType="fitXY"/);
assert.doesNotMatch(widgetLayout, /ProgressBar|widget_goal_|widget_completion_badge/);

assert.match(widgetConfig, /trackerChoices = listOf\([\s\S]*"__avatar__"/);
assert.doesNotMatch(widgetConfig, /"__featured__"/);
assert.match(pluginSource, /val selected = snapshot\.optJSONObject\("avatar"\)/);
assert.match(
  pluginSource,
  /fun configuration\([\s\S]*?HabHubWidgetConfiguration\([\s\S]*?"__avatar__"/,
  "legacy widget configurations must render the Status avatar",
);
assert.match(pluginSource, /paceboard:\/\/status/);
assert.match(pluginSource, /paceboard:\/\//);
assert.match(pluginSource, /setImageViewBitmap/);
assert.match(pluginSource, /LinearGradient/);
assert.match(pluginSource, /RadialGradient/);
assert.match(pluginSource, /drawProgressOutline/);
assert.match(pluginSource, /drawGoalTiles/);
assert.match(pluginSource, /drawAvatarCard/);
assert.match(pluginSource, /PorterDuffColorFilter/);
assert.match(pluginSource, /LruCache<String, Bitmap>/);
assert.match(pluginSource, /MAX_RENDER_PIXELS/);
assert.match(pluginSource, /size\.compact/);
assert.match(pluginSource, /size\.wide/);
assert.match(pluginSource, /Never block a widget broadcast on a development URL/);
assert.match(pluginSource, /setContentDescription/);
assert.match(pluginSource, /GOAL_LIME/);
assert.match(pluginSource, /GOAL_GOLD/);
assert.doesNotMatch(pluginSource, /ValueAnimator|ObjectAnimator|AnimationUtils/);

assert.match(widgetTypes, /export type WidgetAvatarSnapshot/);
assert.match(widgetTypes, /avatarUri\?: string/);
assert.match(widgetBridge, /Image\.resolveAssetSource\(sprite\)/);
assert.match(widgetBridge, /statusAvatarAtlasBlend/);
assert.match(widgetBridge, /statusRangeRollup/);
assert.match(widgetBridge, /statusAvatarBodyProgression/);
assert.doesNotMatch(widgetBridge, /statusAvatarProgression\(/);
assert.match(widgetBridge, /catalog: \[\]/);
assert.match(widgetBridge, /trackers: \[\]/);
assert.match(widgetBridge, /NativeAppState\.addEventListener/);
assert.match(widgetBridge, /scheduleDayBoundary/);
assert.match(widgetBridge, /if \(dirtyRef\.current\) queueRef\.current\(100\)/);
assert.doesNotMatch(widgetBridge, /InteractionManager/);
assert.match(widgetBridge, /getHomeScreenWidgetConfigurations\(\)/);
assert.match(widgetBridge, /const seededRef = useRef\(false\)/);
assert.match(
  widgetBridge,
  /if \(configurations\.length === 0 && seededRef\.current\) return/,
);
assert.match(widgetBridge, /seededRef\.current \? 320 : 1_200/);
assert.match(widgetBridge, /scheduleDayBoundary\(\);\s*queueRef\.current\(1_200\)/);

console.log("Native Chat layout and live Status-avatar widgets validated.");
