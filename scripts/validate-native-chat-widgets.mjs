import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");
const normalizeEol = (value) => value.replace(/\r\n/g, "\n");

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
  normalizeEol(
    pluginSource.replace("__ANDROID_PACKAGE__", "app.paceboard.mobile"),
  ),
  normalizeEol(nativeSource),
  "Generated widget renderer must match its config-plugin source",
);

const pluginConfig = read("plugins/withHabHubAndroid.js");
const widgetLayout = read("plugins/habhub-android/res/layout/habhub_widget.xml");
const widgetConfig = read(
  "plugins/habhub-android/java/HabHubWidgetConfigActivity.kt",
);
const widgetBridge = read("src/widgets/WidgetSnapshotBridge.tsx");
const widgetSnapshots = read("src/widgets/snapshot.ts");
const widgetTypes = read("src/widgets/index.ts");
const smallInfo = read("plugins/habhub-android/res/xml/habhub_widget_small_info.xml");
const squareInfo = read("plugins/habhub-android/res/xml/habhub_widget_square_info.xml");
const wideCompactInfo = read(
  "plugins/habhub-android/res/xml/habhub_widget_wide_compact_info.xml",
);
const wideInfo = read("plugins/habhub-android/res/xml/habhub_widget_wide_info.xml");

assert.match(pluginConfig, /\["layout", "habhub_widget\.xml"\]/);
assert.match(pluginConfig, /habhub_widget_preview_small/);
assert.match(pluginConfig, /habhub_widget_preview_square/);
assert.match(pluginConfig, /habhub_widget_preview_wide_compact/);
assert.match(pluginConfig, /habhub_widget_preview_wide/);
assert.match(pluginConfig, /HabHubWideCompactWidgetProvider/);
assert.match(widgetLayout, /android:id="@\+id\/widget_card_image"/);
assert.match(widgetLayout, /android:scaleType="fitXY"/);
assert.doesNotMatch(widgetLayout, /ProgressBar|widget_goal_|widget_completion_badge/);

assert.match(
  widgetConfig,
  /"square" -> listOf\("__avatar__"[\s\S]*"wide_compact" -> listOf\("__featured__"[\s\S]*else -> listOf\([\s\S]*"__featured__"[\s\S]*"__avatar__"/,
  "2x2 is Status, 4x1 is Featured, and the shared 2x1/4x2 families offer both",
);
assert.match(widgetConfig, /"square" -> "2 x 2"/);
assert.match(widgetConfig, /"wide_compact" -> "4 x 1"/);
assert.match(widgetConfig, /"wide" -> "4 x 2"/);
assert.match(widgetConfig, /else -> "2 x 1"/);
assert.match(widgetConfig, /"theme"[\s\S]*"transparent"[\s\S]*"custom"/);
assert.match(widgetConfig, /SeekBar\(this\)[\s\S]*max = 100/);
assert.match(widgetConfig, /habhub_widget_blur_note/);
assert.match(pluginSource, /BACKGROUND_MODE_PREFIX/);
assert.match(pluginSource, /BACKGROUND_COLOR_PREFIX/);
assert.match(pluginSource, /BACKGROUND_OPACITY_PREFIX/);
assert.match(pluginSource, /setOf\("theme", "transparent", "custom"\)/);
assert.match(
  pluginSource,
  /private fun defaultTracker[\s\S]*HabHubSquareWidgetProvider[\s\S]*"__avatar__" else "__featured__"/,
  "Optional widget configuration must respect each family default",
);
assert.match(
  pluginSource,
  /backgroundMode: String = "transparent"[\s\S]*backgroundOpacity: Int = 55/,
  "New widgets must default to the readable translucent presentation",
);
assert.match(
  pluginSource,
  /configuration\.trackerId == "__avatar__"[\s\S]*snapshot\.optJSONObject\("avatar"\)[\s\S]*snapshot\.optJSONObject\("featured"\)/,
);
for (const [source, width, height, preview] of [
  [smallInfo, 2, 1, "small"],
  [squareInfo, 2, 2, "square"],
  [wideCompactInfo, 4, 1, "wide_compact"],
  [wideInfo, 4, 2, "wide"],
]) {
  assert.match(source, new RegExp(`android:targetCellWidth="${width}"`));
  assert.match(source, new RegExp(`android:targetCellHeight="${height}"`));
  assert.match(source, new RegExp(`android:previewImage="@drawable/habhub_widget_preview_${preview}"`));
  assert.match(source, new RegExp(`android:previewLayout="@layout/habhub_widget_preview_${preview}"`));
}
assert.match(pluginSource, /paceboard:\/\/status/);
assert.match(pluginSource, /paceboard:\/\//);
assert.match(pluginSource, /setImageViewBitmap/);
assert.match(pluginSource, /LinearGradient/);
assert.match(pluginSource, /RadialGradient/);
assert.match(pluginSource, /drawProgressOutline/);
assert.match(pluginSource, /drawGoalTiles/);
assert.match(pluginSource, /drawFeaturedGoalDot/);
assert.match(pluginSource, /drawAvatarCard/);
assert.match(pluginSource, /drawStatusGoalGrid/);
assert.match(pluginSource, /val rows = \(count \+ columns - 1\) \/ columns/);
assert.match(pluginSource, /goal\.optString\("title", "Goal"\)/);
assert.match(pluginSource, /item\.optJSONArray\("goals"\)/);
assert.match(pluginSource, /item\.optString\("completionIcon"/);
assert.match(pluginSource, /item\.optBoolean\("showProgressOutline", true\)/);
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

assert.match(widgetTypes, /export type WidgetGoalSnapshot/);
assert.match(widgetTypes, /export type WidgetFeaturedSnapshot/);
assert.match(widgetTypes, /export type WidgetAvatarSnapshot/);
assert.match(widgetTypes, /avatarUri\?: string/);
assert.match(widgetTypes, /goals: WidgetGoalSnapshot\[\]/);
assert.doesNotMatch(widgetTypes, /weightLabel|bodyCompositionLabel/);
assert.match(widgetBridge, /Image\.resolveAssetSource\(sprite\)/);
assert.match(widgetBridge, /statusAvatarAtlasBlend/);
assert.match(widgetBridge, /statusAvatarBodyProgression/);
assert.doesNotMatch(widgetBridge, /statusAvatarProgression\(/);
assert.match(
  widgetBridge,
  /const currentState = stateWithoutGoogleHealthLocalData\(stateRef\.current\)[\s\S]*featuredWidgetSnapshot\([\s\S]*currentState/,
  "durable Featured and Status payloads must use the Google-safe projection",
);
assert.match(widgetBridge, /const payload = JSON\.stringify\(\{ featured, avatar \}\)/);
assert.match(widgetSnapshots, /todayHeroSummary\(state, state\.currentUserId, today\)/);
assert.match(widgetSnapshots, /statusRangeRollup\(state, state\.currentUserId, \[today\]\)/);
assert.match(widgetSnapshots, /completionIndicatorOption/);
assert.match(widgetSnapshots, /showProgressOutline:/);
assert.match(widgetSnapshots, /goals: WidgetGoalSnapshot\[\]/);
assert.doesNotMatch(widgetSnapshots, /weightLabel|bodyCompositionLabel/);
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

console.log("Native Chat layout and four privacy-safe Featured/Status widget families validated.");
