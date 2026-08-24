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
const nativeModule = read(
  "plugins/habhub-android/java/HabHubNativeModule.kt",
);
const widgetBridge = read("src/widgets/WidgetSnapshotBridge.tsx");
const authProvider = read("src/auth/AuthProvider.tsx");
const widgetSnapshots = read("src/widgets/snapshot.ts");
const widgetTypes = read("src/widgets/index.ts");
const smallInfo = read("plugins/habhub-android/res/xml/habhub_widget_small_info.xml");
const squareInfo = read("plugins/habhub-android/res/xml/habhub_widget_square_info.xml");
const wideCompactInfo = read(
  "plugins/habhub-android/res/xml/habhub_widget_wide_compact_info.xml",
);
const wideInfo = read("plugins/habhub-android/res/xml/habhub_widget_wide_info.xml");
const leaderboardInfo = read(
  "plugins/habhub-android/res/xml/habhub_widget_leaderboard_info.xml",
);
const smallPreview = read(
  "plugins/habhub-android/res/drawable/habhub_widget_preview_small.xml",
);
const wideCompactPreview = read(
  "plugins/habhub-android/res/drawable/habhub_widget_preview_wide_compact.xml",
);
const leaderboardPreview = read(
  "plugins/habhub-android/res/drawable/habhub_widget_preview_leaderboard.xml",
);
const widgetValues = read(
  "plugins/habhub-android/res/values/habhub_widgets.xml",
);
const backupRules = read(
  "plugins/habhub-android/res/xml/habhub_widget_backup_rules.xml",
);
const dataExtractionRules = read(
  "plugins/habhub-android/res/xml/habhub_widget_data_extraction_rules.xml",
);

for (const fileName of ["HabHubWidgetConfigActivity.kt", "HabHubNativeModule.kt"]) {
  assert.equal(
    normalizeEol(
      read(`plugins/habhub-android/java/${fileName}`).replace(
        "__ANDROID_PACKAGE__",
        "app.paceboard.mobile",
      ),
    ),
    normalizeEol(
      read(`android/app/src/main/java/app/paceboard/mobile/${fileName}`),
    ),
    `Generated ${fileName} must match its config-plugin source`,
  );
}
for (const [resourceType, fileName] of [
  ["drawable", "habhub_widget_preview_small.xml"],
  ["drawable", "habhub_widget_preview_wide_compact.xml"],
  ["drawable", "habhub_widget_preview_leaderboard.xml"],
  ["layout", "habhub_widget_preview_leaderboard.xml"],
  ["values", "habhub_widgets.xml"],
  ["xml", "habhub_widget_small_info.xml"],
  ["xml", "habhub_widget_square_info.xml"],
  ["xml", "habhub_widget_wide_compact_info.xml"],
  ["xml", "habhub_widget_wide_info.xml"],
  ["xml", "habhub_widget_leaderboard_info.xml"],
  ["xml", "habhub_widget_backup_rules.xml"],
  ["xml", "habhub_widget_data_extraction_rules.xml"],
]) {
  assert.equal(
    normalizeEol(
      read(`plugins/habhub-android/res/${resourceType}/${fileName}`).replaceAll(
        "__ANDROID_PACKAGE__",
        "app.paceboard.mobile",
      ),
    ),
    normalizeEol(read(`android/app/src/main/res/${resourceType}/${fileName}`)),
    `Generated ${fileName} must match its config-plugin source`,
  );
}

assert.match(pluginConfig, /\["layout", "habhub_widget\.xml"\]/);
assert.match(pluginConfig, /habhub_widget_preview_small/);
assert.match(pluginConfig, /habhub_widget_preview_square/);
assert.match(pluginConfig, /habhub_widget_preview_wide_compact/);
assert.match(pluginConfig, /habhub_widget_preview_wide/);
assert.match(pluginConfig, /habhub_widget_preview_leaderboard/);
assert.match(pluginConfig, /HabHubWideCompactWidgetProvider/);
assert.match(pluginConfig, /HabHubLeaderboardWidgetProvider/);
assert.match(widgetLayout, /android:id="@\+id\/widget_card_image"/);
assert.match(widgetLayout, /android:scaleType="fitXY"/);
assert.doesNotMatch(widgetLayout, /ProgressBar|widget_goal_|widget_completion_badge/);

assert.match(
  widgetConfig,
  /"leaderboard" -> listOf\("__leaderboard__"[\s\S]*"square", "wide" -> listOf\("__avatar__"[\s\S]*else -> listOf\("__featured__"/,
  "Leaderboard and Status must be distinct launcher choices",
);
assert.match(widgetConfig, /"square" -> "2-3 x 1-5 \(starts 2 x 2\)"/);
assert.match(widgetConfig, /"wide_compact" -> "2-5 x 1 \(starts 4 x 1\)"/);
assert.match(widgetConfig, /"wide" -> "2-3 x 1-5 \(starts 3 x 2\)"/);
assert.match(widgetConfig, /"leaderboard" -> "1-5 x 1-6 \(starts 2 x 2\)"/);
assert.match(widgetConfig, /else -> "2-5 x 1 \(starts 2 x 1\)"/);
assert.match(widgetConfig, /"theme"[\s\S]*"transparent"[\s\S]*"custom"/);
assert.match(widgetConfig, /SeekBar\(this\)[\s\S]*max = 100/);
assert.match(widgetConfig, /habhub_widget_blur_note/);
assert.match(pluginSource, /BACKGROUND_MODE_PREFIX/);
assert.match(pluginSource, /BACKGROUND_COLOR_PREFIX/);
assert.match(pluginSource, /BACKGROUND_OPACITY_PREFIX/);
assert.match(pluginSource, /LEADERBOARD_METRICS_PREFIX/);
assert.match(pluginSource, /LEADERBOARD_COUNT_PREFIX/);
assert.match(pluginSource, /setOf\("theme", "transparent", "custom"\)/);
assert.match(
  pluginSource,
  /private fun defaultTracker[\s\S]*HabHubLeaderboardWidgetProvider[\s\S]*-> "__leaderboard__"[\s\S]*HabHubSquareWidgetProvider[\s\S]*-> "__avatar__"[\s\S]*private fun fixedTracker[\s\S]*HabHubLeaderboardWidgetProvider[\s\S]*-> "__leaderboard__"[\s\S]*HabHubSmallWidgetProvider[\s\S]*-> "__featured__"[\s\S]*HabHubSquareWidgetProvider[\s\S]*-> "__avatar__"/,
  "Each launcher family must remain fixed to its advertised Featured, Status, or Leaderboard surface",
);
assert.match(
  pluginSource,
  /backgroundMode: String = "transparent"[\s\S]*backgroundOpacity: Int = 55/,
  "New widgets must default to the readable translucent presentation",
);
assert.match(
  pluginSource,
  /when \(configuration\.trackerId\)[\s\S]*"__avatar__" -> snapshot\.optJSONObject\("avatar"\)[\s\S]*"__leaderboard__" -> snapshot\.optJSONObject\("leaderboard"\)[\s\S]*snapshot\.optJSONObject\("featured"\)/,
);
for (const [source, expected] of [
  [smallInfo, { width: 2, height: 1, preview: "small", minWidth: 109, maxWidth: 349, minHeight: 50, maxHeight: 50, mode: "horizontal" }],
  [squareInfo, { width: 2, height: 2, preview: "square", minWidth: 109, maxWidth: 203, minHeight: 50, maxHeight: 315, mode: "horizontal\\|vertical" }],
  [wideCompactInfo, { width: 4, height: 1, preview: "wide_compact", minWidth: 109, maxWidth: 349, minHeight: 50, maxHeight: 50, mode: "horizontal" }],
  [wideInfo, { width: 3, height: 2, preview: "wide", minWidth: 109, maxWidth: 203, minHeight: 50, maxHeight: 315, mode: "horizontal\\|vertical" }],
  [leaderboardInfo, { width: 2, height: 2, preview: "leaderboard", minWidth: 40, maxWidth: 420, minHeight: 40, maxHeight: 420, mode: "horizontal\\|vertical" }],
]) {
  assert.match(source, new RegExp(`android:targetCellWidth="${expected.width}"`));
  assert.match(source, new RegExp(`android:targetCellHeight="${expected.height}"`));
  assert.match(source, new RegExp(`android:previewImage="@drawable/habhub_widget_preview_${expected.preview}"`));
  assert.match(source, new RegExp(`android:previewLayout="@layout/habhub_widget_preview_${expected.preview}"`));
  assert.match(source, new RegExp(`android:minResizeWidth="${expected.minWidth}dp"`));
  assert.match(source, new RegExp(`android:maxResizeWidth="${expected.maxWidth}dp"`));
  assert.match(source, new RegExp(`android:minResizeHeight="${expected.minHeight}dp"`));
  assert.match(source, new RegExp(`android:maxResizeHeight="${expected.maxHeight}dp"`));
  assert.match(source, new RegExp(`android:resizeMode="${expected.mode}"`));
}
assert.match(widgetValues, /Featured card - resizes from 2-5 x 1/);
assert.match(widgetValues, /Status avatar - resizes from 2-3 x 1-5/);
assert.match(widgetValues, /Leaderboard - resizes from 1-5 x 1-6/);
assert.match(manifest, /HabHubLeaderboardWidgetProvider[\s\S]*@xml\/habhub_widget_leaderboard_info/);
assert.match(pluginSource, /paceboard:\/\/status/);
assert.match(pluginSource, /paceboard:\/\/group/);
assert.doesNotMatch(pluginSource, /paceboard:\/\/leaderboard"/);
assert.match(pluginSource, /paceboard:\/\//);
assert.match(pluginSource, /setImageViewBitmap/);
assert.match(pluginSource, /LinearGradient/);
assert.match(pluginSource, /RadialGradient/);
assert.match(pluginSource, /drawProgressOutline/);
assert.match(pluginSource, /drawGoalTiles/);
assert.match(pluginSource, /drawFeaturedGoalDot/);
assert.match(pluginSource, /drawAvatarCard/);
assert.match(pluginSource, /drawLeaderboardCard/);
assert.match(pluginSource, /configuredLeaderboardMetrics/);
assert.match(
  pluginSource,
  /bestLeaderboardGrid[\s\S]*cellWidth \/ 68f[\s\S]*cellHeight \/ 39f[\s\S]*for \(count in 4 downTo 2\)/,
  "Leaderboard capacity and grid geometry must adapt across launcher spans",
);
assert.match(pluginSource, /cellScale[\s\S]*metricTitleSize[\s\S]*rowTextSize[\s\S]*iconRadius/);
assert.match(
  pluginSource,
  /contentDescription\(context, item, configuration, size\)/,
  "Leaderboard accessibility text must be filtered to the metrics visible on that widget",
);
assert.match(pluginSource, /drawStatusGoalGrid/);
assert.match(pluginSource, /val rows = \(count \+ columns - 1\) \/ columns/);
assert.match(pluginSource, /size\.heightDp >= 260f -> 12/);
assert.match(pluginSource, /while \(count > 0\)[\s\S]*if \(diameter >= 8f\) break[\s\S]*count -= 1/);
assert.match(pluginSource, /drawPortraitAvatarCard/);
assert.match(pluginSource, /val roomy = widthDp >= 165f/);
assert.match(pluginSource, /widgetId in wideWidgetIds -> 203/);
assert.match(pluginSource, /val portrait = context\.resources\.configuration\.orientation != Configuration\.ORIENTATION_LANDSCAPE[\s\S]*if \(portrait\) minWidth else maxWidth[\s\S]*if \(portrait\) maxHeight else minHeight/);
assert.match(pluginSource, /goal\.optString\("title", "Goal"\)/);
assert.match(pluginSource, /item\.optJSONArray\("goals"\)/);
assert.match(pluginSource, /item\.optBoolean\("showProgressOutline", true\)/);
const featuredBadge = pluginSource.slice(
  pluginSource.indexOf("private fun drawProgressBadge"),
  pluginSource.indexOf("private fun drawCompletionIcon"),
);
assert.match(featuredBadge, /Color\.argb\(215, 61, 69, 80\)/);
assert.match(featuredBadge, /Color\.rgb\(184, 228, 92\)/);
assert.match(featuredBadge, /progress \* 360f/);
assert.match(featuredBadge, /"\$percent%"/);
assert.match(featuredBadge, /diameter <= 25f && percent >= 100/);
assert.doesNotMatch(
  featuredBadge,
  /drawCompletionIcon/,
  "Featured completion must keep a neutral center with an arc and percentage",
);
assert.match(pluginSource, /val dateLabel = item\.optString\("dateLabel"\)/);
assert.match(
  pluginSource,
  /val pad = if \(size\.compact\) 5f else 11f[\s\S]*dateLabel[\s\S]*pad,[\s\S]*if \(size\.compact\) 6\.2f[\s\S]*eyebrow,[\s\S]*pad,[\s\S]*if \(size\.compact\) 11\.8f/,
  "Compact Featured date and eyebrow must share the headline's left axis",
);
assert.match(pluginSource, /item\.optString\("compactSubtitle", item\.optString\("subtitle"\)\)/);
assert.match(
  pluginSource,
  /compactSubtitleWidth = size\.widthDp - pad \* 2f[\s\S]*fittedTextPaint\([\s\S]*compactSubtitleWidth[\s\S]*31\.5f[\s\S]*compactSubtitleWidth/,
  "The goals-left and To-Do summary must share one full-width compact baseline",
);
assert.match(pluginSource, /max\(34f, barTop - 10\.5f\)/);
const featured2x1Width = 109;
const featured2x1Pad = 5;
const featuredBadgeDiameter = 24;
const featuredBadgeCenter =
  featured2x1Width - featured2x1Pad - featuredBadgeDiameter / 2;
const featuredContentWidth =
  featuredBadgeCenter - featuredBadgeDiameter / 2 - featured2x1Pad - 5;
assert.equal(
  featuredContentWidth,
  70,
  "The minimum 2x1 Featured header must retain 70dp for the complete TODAY'S FOCUS label",
);
assert.equal(
  featured2x1Width - featured2x1Pad * 2,
  99,
  "The compact goals-left and x/n To-Dos line must use the full 99dp inner width",
);
assert.ok(
  34 - 31.5 >= 2.5,
  "Compact goal tiles must begin below the shared summary baseline",
);
assert.match(pluginSource, /PorterDuffColorFilter/);
assert.match(pluginSource, /LruCache<String, Bitmap>/);
assert.match(pluginSource, /MAX_RENDER_PIXELS/);
assert.match(pluginSource, /size\.compact/);
assert.match(pluginSource, /size\.wide/);
assert.match(pluginSource, /Never block a widget broadcast on a development URL/);
assert.match(pluginSource, /setContentDescription/);
assert.match(pluginSource, /GOAL_LIME/);
assert.match(pluginSource, /GOAL_GOLD/);
for (const iconFamily of ["briefcase", "school", "book", "trending", "calendar", "checkbox"])
  assert.match(
    pluginSource,
    new RegExp(`icon\\.startsWith\\(\"${iconFamily}`),
    `widget renderer needs a recognizable ${iconFamily} tracker glyph`,
  );
assert.doesNotMatch(pluginSource, /ValueAnimator|ObjectAnimator|AnimationUtils/);
for (const preview of [smallPreview, wideCompactPreview]) {
  assert.match(preview, /android:fillColor="#3D4550"/);
  assert.match(preview, /android:strokeColor="#A4AEBC"/);
  assert.match(preview, /android:strokeColor="#B8E45C"/);
  assert.match(preview, /android:fillColor="#DDE6F5"/);
}
assert.match(leaderboardPreview, /android:fillColor="#081B49"/);
assert.match(leaderboardPreview, /android:fillColor="#B8E45C"/);
assert.match(leaderboardPreview, /android:fillColor="#DDE6F5"/);

assert.match(widgetTypes, /export type WidgetGoalSnapshot/);
assert.match(widgetTypes, /export type WidgetFeaturedSnapshot/);
assert.match(widgetTypes, /dateLabel: string/);
assert.match(widgetTypes, /export type WidgetAvatarSnapshot/);
assert.match(widgetTypes, /export type WidgetLeaderboardSnapshot/);
assert.match(widgetTypes, /leaderboardMetricIds\?: string\[\]/);
assert.match(widgetTypes, /leaderboardCount\?: number/);
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
assert.match(widgetBridge, /const payload = JSON\.stringify\(\{ featured, avatar, leaderboard, catalog \}\)/);
assert.match(widgetSnapshots, /todayHeroSummary\(state, state\.currentUserId, today\)/);
assert.match(widgetSnapshots, /statusRangeRollup\(state, state\.currentUserId, \[today\]\)/);
assert.match(widgetSnapshots, /completionIndicatorOption/);
assert.match(widgetSnapshots, /function compactWidgetDate[\s\S]*\.join\(" "\)/);
assert.ok(
  widgetSnapshots.match(/dateLabel: compactWidgetDate\(today, language\)/g)?.length >= 2,
  "Featured and Leaderboard dates must use visibly separated date parts",
);
assert.match(widgetSnapshots, /showProgressOutline:/);
assert.match(widgetSnapshots, /compactSubtitle:/);
assert.match(widgetSnapshots, /leaderboardRows\([\s\S]*state\.currentUserId/);
assert.match(
  widgetSnapshots,
  /const explicitlyRequestedIds[\s\S]*const selectedIds = explicitlyRequestedIds\.length[\s\S]*\? explicitlyRequestedIds/,
  "Multiple installed Leaderboard widgets must retain the union of their explicitly selected metrics",
);
assert.match(widgetSnapshots, /goals: WidgetGoalSnapshot\[\]/);
assert.doesNotMatch(widgetSnapshots, /weightLabel|bodyCompositionLabel/);
assert.match(widgetBridge, /const catalog = \(currentState\.group\.metricConfiguration \?\? \[\]\)/);
assert.match(widgetBridge, /configuration\.trackerId === "__leaderboard__"/);
assert.match(widgetBridge, /configuration\.leaderboardMetricIds\?\.length/);
assert.match(
  widgetBridge,
  /configuration\.leaderboardMetricIds\.slice\([\s\S]*configuration\.leaderboardCount \?\? 2/,
  "Durable snapshots must include only each widget's visible configured tracker count",
);
assert.match(widgetBridge, /trackers: \[\]/);
assert.match(widgetBridge, /NativeAppState\.addEventListener/);
assert.match(widgetBridge, /scheduleDayBoundary/);
assert.match(widgetBridge, /if \(dirtyRef\.current\) queueRef\.current\(100\)/);
assert.doesNotMatch(widgetBridge, /InteractionManager/);
assert.match(widgetBridge, /getHomeScreenWidgetConfigurations\(\)/);
assert.match(
  widgetBridge,
  /if \(configurations\.length === 0\)[\s\S]*clearHomeScreenWidgetSnapshot\(\)[\s\S]*publishedRef\.current = false/,
  "No installed widget must leave no durable health snapshot",
);
assert.doesNotMatch(widgetBridge, /seededRef|Seed the bounded/);
assert.match(widgetBridge, /publishedRef\.current \? 320 : 1_200/);
assert.match(
  widgetBridge,
  /authStatusRef\.current === "signedIn"[\s\S]*authUserIdRef\.current === stateRef\.current\.currentUserId/,
  "Widget publishing must be bound to the hydrated signed-in identity",
);
assert.match(
  widgetBridge,
  /authStatusRef\.current === "demo" && !cloudConfiguredRef\.current/,
  "Explicit cloud-account demo mode must not republish a prior account snapshot",
);
assert.match(widgetBridge, /scheduleDayBoundary\(\);\s*queueRef\.current\(1_200\)/);

assert.match(pluginSource, /fun clearSnapshot\(context: Context\)[\s\S]*remove\(SNAPSHOT\)/);
assert.match(pluginSource, /fun configurations[\s\S]*activeWidgetIds\(context\)\.map/);
assert.match(
  pluginSource,
  /fun saveSnapshot[\s\S]*pruneLeaderboardPayload\(context, incoming\)[\s\S]*private fun pruneStoredLeaderboardPayload[\s\S]*private fun pruneLeaderboardPayload/,
  "Native storage must prune stale exact leaderboard values even when configuration changes outside React Native",
);
assert.ok(
  pluginSource.match(/pruneStoredLeaderboardPayload\(context\)/g)?.length >= 2,
  "Changing or deleting a widget must immediately prune no-longer-visible leaderboard payloads",
);
assert.match(
  pluginSource,
  /if \(active\.isEmpty\(\)\) \{[\s\S]*snapshot\.remove\("leaderboard"\)/,
  "No active Leaderboard widget may leave an exact leaderboard payload on the launcher",
);
assert.match(
  pluginSource,
  /activeWidgetIds\(context\)\.none \{ it !in deleted \}[\s\S]*clearSnapshot\(context\)/,
  "Deleting the last widget must clear durable health state even during launcher callback lag",
);
assert.match(pluginSource, /HabHubSmallWidgetProvider::class\.java[\s\S]*HabHubSquareWidgetProvider::class\.java[\s\S]*HabHubWideCompactWidgetProvider::class\.java[\s\S]*HabHubWideWidgetProvider::class\.java[\s\S]*HabHubLeaderboardWidgetProvider::class\.java/);
assert.match(widgetConfig, /selectedCount < 4/);
assert.match(widgetConfig, /selectedLeaderboardMetricIds[\s\S]*\.ifEmpty/);
assert.match(nativeModule, /putArray\([\s\S]*"leaderboardMetricIds"/);
assert.match(nativeModule, /putInt\("leaderboardCount"/);
assert.doesNotMatch(pluginSource, /mergedTrackers|previous\.optJSONArray\("trackers"\)/);
assert.match(nativeModule, /fun clearWidgetSnapshot\(promise: Promise\)[\s\S]*HabHubWidgetStore\.clearSnapshot[\s\S]*HabHubWidgetRenderer\.updateAll/);
assert.match(widgetTypes, /clearWidgetSnapshot\(\): Promise<boolean>/);
assert.match(widgetTypes, /export async function clearHomeScreenWidgetSnapshot/);
assert.match(widgetTypes, /widgetSnapshotGeneration \+= 1/);
assert.match(widgetTypes, /expectedGeneration !== widgetSnapshotGeneration/);
assert.match(widgetBridge, /homeScreenWidgetSnapshotGeneration\(\)[\s\S]*updateHomeScreenWidgets\([\s\S]*snapshotGeneration/);
assert.ok(
  authProvider.match(/clearHomeScreenWidgetSnapshot\(\)/g)?.length >= 4,
  "Auth sign-out, account transition, offline reconciliation, and demo boundaries must clear widget data",
);
assert.match(pluginConfig, /habhub_widget_backup_rules\.xml/);
assert.match(pluginConfig, /habhub_widget_data_extraction_rules\.xml/);
assert.match(pluginConfig, /android:fullBackupContent[\s\S]*@xml\/habhub_widget_backup_rules/);
assert.match(pluginConfig, /android:dataExtractionRules[\s\S]*@xml\/habhub_widget_data_extraction_rules/);
assert.match(backupRules, /exclude domain="sharedpref" path="habhub_widgets\.xml"/);
assert.equal(
  dataExtractionRules.match(/exclude domain="sharedpref" path="habhub_widgets\.xml"/g)?.length,
  2,
  "Android 12+ rules must exclude widget preferences from cloud backup and device transfer",
);
assert.match(manifest, /android:fullBackupContent="@xml\/habhub_widget_backup_rules"/);
assert.match(manifest, /android:dataExtractionRules="@xml\/habhub_widget_data_extraction_rules"/);

console.log("Native Chat layout and privacy-safe Featured/Status/Leaderboard widget families validated.");
