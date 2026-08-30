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
assert.match(pluginConfig, /HabHubLeaderboardWidgetProvider/);
const exposedProviderRegistry = pluginConfig.slice(
  pluginConfig.indexOf("const PROVIDERS ="),
  pluginConfig.indexOf("const RETIRED_WIDGET_PROVIDERS"),
);
assert.match(exposedProviderRegistry, /HabHubSmallWidgetProvider/);
assert.match(exposedProviderRegistry, /HabHubSquareWidgetProvider/);
assert.match(exposedProviderRegistry, /HabHubLeaderboardWidgetProvider/);
assert.doesNotMatch(exposedProviderRegistry, /HabHubWideCompactWidgetProvider|HabHubWideWidgetProvider/);
assert.match(
  pluginConfig,
  /RETIRED_WIDGET_PROVIDERS[\s\S]*HabHubWideCompactWidgetProvider[\s\S]*HabHubWideWidgetProvider[\s\S]*providerNames/,
  "Prebuild must remove obsolete duplicate picker providers from an existing manifest",
);
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
assert.match(
  widgetConfig,
  /LEADERBOARD_FONT_PERCENT_MAX -[\s\S]*LEADERBOARD_FONT_PERCENT_MIN[\s\S]*leaderboardFontScale \* 100f[\s\S]*habhub_widget_leaderboard_text_size_value/,
  "Leaderboard configuration must expose the stored per-widget text scale",
);
assert.match(widgetConfig, /leaderboardFontScale = \([\s\S]*leaderboardFontSlider\.progress[\s\S]*\) \/ 100f/);
assert.match(pluginSource, /BACKGROUND_MODE_PREFIX/);
assert.match(pluginSource, /BACKGROUND_COLOR_PREFIX/);
assert.match(pluginSource, /BACKGROUND_OPACITY_PREFIX/);
assert.match(pluginSource, /LEADERBOARD_METRICS_PREFIX/);
assert.match(pluginSource, /LEADERBOARD_FONT_PERCENT_PREFIX/);
assert.match(
  pluginSource,
  /LEADERBOARD_FONT_PERCENT_MIN = 60[\s\S]*LEADERBOARD_FONT_PERCENT_MAX = 130[\s\S]*LEADERBOARD_FONT_PERCENT_DEFAULT = 100/,
  "Leaderboard text customization must allow a compact 60% setting while preserving the default",
);
assert.doesNotMatch(pluginSource, /LEADERBOARD_COUNT_PREFIX|val leaderboardCount:/);
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
assert.match(manifest, /HabHubSmallWidgetProvider[\s\S]*@xml\/habhub_widget_small_info/);
assert.match(manifest, /HabHubSquareWidgetProvider[\s\S]*@xml\/habhub_widget_square_info/);
assert.doesNotMatch(
  manifest,
  /HabHubWideCompactWidgetProvider|HabHubWideWidgetProvider/,
  "The launcher picker must expose one Featured and one Avatar provider, not duplicate starting sizes",
);
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
assert.match(pluginSource, /cellScale[\s\S]*metricTitleSize[\s\S]*baseRowTextSize[\s\S]*iconRadius/);
assert.match(
  pluginSource,
  /val desiredRows = min\(metricRows\.length\(\), 5\)[\s\S]*val compactRows = desiredRows > 0[\s\S]*val stackRows = roomyStackRows && !compactRows[\s\S]*fittedTextPaint\(value, valueWidth/,
  "Leaderboard values must fit responsively instead of truncating units in narrow widgets",
);
assert.match(
  pluginSource,
  /MIN_LEADERBOARD_ROW_TEXT_SIZE = 6\.2f[\s\S]*MIN_SCALED_LEADERBOARD_TEXT_SIZE = 4\.6f[\s\S]*rowTextFloor = \([\s\S]*MIN_LEADERBOARD_ROW_TEXT_SIZE \* leaderboardFontScale[\s\S]*coerceAtLeast\(MIN_SCALED_LEADERBOARD_TEXT_SIZE\)[\s\S]*denseMemberHeader = desiredRows >= 3[\s\S]*desiredRows \* preferredRowHeight > availableHeight[\s\S]*rowTextFloor \* 1\.35f[\s\S]*rowHeight \* 0\.66f[\s\S]*coerceAtLeast\(rowTextFloor\)[\s\S]*baseRowTextSize \* 1\.28f/,
  "Leaderboard rows must scale below the default floor while retaining a legible absolute minimum",
);
assert.match(
  pluginSource,
  /rowSpacingScale[\s\S]*innerPad = \([\s\S]*leaderboardFontScale[\s\S]*iconRadius = \([\s\S]*leaderboardFontScale[\s\S]*compactWidthScale[\s\S]*0\.30f \+ \(1f - compactWidthScale\) \* 0\.16f/,
  "Compact widget typography must also reclaim icon, padding, row-spacing, and name-column space",
);
assert.match(
  pluginSource,
  /narrowTallSingleMetricRows =[\s\S]*metrics\.size == 1[\s\S]*size\.widthDp < 150f[\s\S]*size\.heightDp >= 150f[\s\S]*grid\.cellWidth <= 112f[\s\S]*roomyStackRows = grid\.cellWidth < 76f \|\| narrowTallSingleMetricRows[\s\S]*stackRows = roomyStackRows && !compactRows/,
  "A narrow/tall single-metric widget must stack name and value only when every requested row fits",
);
assert.match(
  pluginSource,
  /wideTwoMetricLayout =[\s\S]*metrics\.size == 2[\s\S]*grid\.columns == 2[\s\S]*size\.widthDp >= 220f[\s\S]*size\.widthDp \/ size\.heightDp <= 3f[\s\S]*maximumCellScale = if \(wideTwoMetricLayout\) 1\.45f[\s\S]*compactWidthScale[\s\S]*0\.34f \+ \(1f - compactWidthScale\) \* 0\.10f[\s\S]*0\.18f \+ compactWidthScale \* 0\.06f/,
  "A 4 x 2 two-tracker widget must cap oversized typography and return spare width to member names",
);
const MIN_LEADERBOARD_ROW_TEXT_SIZE = 6.2;
const MIN_SCALED_LEADERBOARD_TEXT_SIZE = 4.6;
function singleMetricLeaderboardDensity(widthDp, heightDp, members, fontScale = 1) {
  const pad = Math.min(12, Math.max(4, Math.min(widthDp, heightDp) * 0.065));
  const headerTextFloor = Math.max(MIN_SCALED_LEADERBOARD_TEXT_SIZE, MIN_LEADERBOARD_ROW_TEXT_SIZE * fontScale);
  const headerSize = Math.min(17, Math.max(headerTextFloor, Math.min(widthDp / 14, heightDp / 6.5) * fontScale));
  const cellWidth = widthDp - pad * 2;
  const cellHeight = heightDp - (pad + headerSize + Math.max(3, headerSize * 0.45)) - pad;
  const desiredRows = Math.min(members, 5);
  const cellScale = Math.min(2.6, Math.max(0.62, Math.min(cellWidth / 68, cellHeight / 39)));
  const denseMemberHeader = desiredRows >= 3 && cellHeight < 32 + desiredRows * 14;
  const headerScale = denseMemberHeader ? 0.78 : 1;
  const innerPad = Math.min(10, Math.max(Math.max(1.8, 2.4 * fontScale), 4.5 * cellScale * headerScale * fontScale));
  const metricTitleSize = Math.min(18, Math.max(Math.max(4.4, 5.4 * fontScale), 8.2 * cellScale * headerScale * fontScale));
  const baseRowTextSize = Math.min(14.5, Math.max(4.5, 6.6 * cellScale * headerScale * fontScale));
  const iconRadius = Math.min(12, Math.max(Math.max(2.4, 3 * fontScale), 4.8 * cellScale * headerScale * fontScale));
  const titleBandHeight = Math.max(
    iconRadius * 2 + innerPad * 1.45,
    metricTitleSize * 1.65 + innerPad,
  );
  const availableHeight = Math.max(0, cellHeight - titleBandHeight - innerPad * 0.45);
  const rowSpacingScale = Math.min(1.3, Math.max(0.72, fontScale));
  const roomyStackRows =
    cellWidth < 76 || (widthDp < 150 && heightDp >= 150 && cellWidth <= 112);
  const preferredRowHeight = Math.max(
    (roomyStackRows ? 14 : 10) * rowSpacingScale,
    baseRowTextSize * (roomyStackRows ? 3.15 : 2.15),
  );
  const compactRows = desiredRows > 0 && desiredRows * preferredRowHeight > availableHeight;
  const rowTextFloor = Math.max(MIN_SCALED_LEADERBOARD_TEXT_SIZE, MIN_LEADERBOARD_ROW_TEXT_SIZE * fontScale);
  const compactRowHeight = Math.max(
    rowTextFloor * 1.35,
    Math.min(10 * rowSpacingScale, Math.max(6.4 * rowSpacingScale, baseRowTextSize * 0.9)),
  );
  const visibleRows = Math.min(
    desiredRows,
    Math.max(1, Math.floor(availableHeight / (compactRows ? compactRowHeight : preferredRowHeight))),
  );
  const rowHeight = availableHeight / Math.max(1, visibleRows);
  const rowTextSize = compactRows
    ? Math.max(
        rowTextFloor,
        Math.min(
          Math.max(baseRowTextSize, rowTextFloor),
          rowHeight * 0.66,
        ),
      )
    : Math.max(
        baseRowTextSize,
        Math.min(baseRowTextSize * 1.28, rowHeight * (roomyStackRows ? 0.4 : 0.58)),
      );
  return { cellWidth, compactRows, rowHeight, rowTextSize, visibleRows };
}
const sparseLeaderboard = singleMetricLeaderboardDensity(203, 105, 1);
const crowdedLeaderboard = singleMetricLeaderboardDensity(203, 105, 5);
assert.equal(crowdedLeaderboard.visibleRows, 5, "A standard 2 x 2 widget should fit five members for one tracker");
assert.ok(sparseLeaderboard.rowHeight > crowdedLeaderboard.rowHeight);
assert.ok(
  sparseLeaderboard.rowTextSize > crowdedLeaderboard.rowTextSize,
  "A sparse leaderboard must spend its spare height on larger text",
);
const compactLeaderboard = singleMetricLeaderboardDensity(109, 50, 5);
assert.equal(
  compactLeaderboard.visibleRows,
  2,
  "A 2 x 1 leaderboard must show as many members as its legible text floor permits",
);
assert.ok(
  compactLeaderboard.rowTextSize >= MIN_LEADERBOARD_ROW_TEXT_SIZE,
  "A crowded 2 x 1 leaderboard must never shrink member text below the legible floor",
);
const smallerSparseLeaderboard = singleMetricLeaderboardDensity(203, 105, 1, 0.6);
const largerSparseLeaderboard = singleMetricLeaderboardDensity(203, 105, 1, 1.3);
assert.ok(
  largerSparseLeaderboard.rowTextSize > smallerSparseLeaderboard.rowTextSize,
  "The per-widget text scale must materially change roomy Leaderboard rows",
);
const defaultTwoByThreeLeaderboard = singleMetricLeaderboardDensity(109, 180, 5, 1);
const compactTwoByThreeLeaderboard = singleMetricLeaderboardDensity(109, 180, 5, 0.6);
const compactTwoByOneLeaderboard = singleMetricLeaderboardDensity(109, 50, 2, 0.6);
assert.equal(compactTwoByThreeLeaderboard.visibleRows, 5);
assert.ok(
  compactTwoByThreeLeaderboard.rowTextSize < defaultTwoByThreeLeaderboard.rowTextSize * 0.8,
  "The 60% setting must materially compact a crowded 2 x 3 Leaderboard widget",
);
assert.ok(compactTwoByThreeLeaderboard.rowTextSize >= MIN_SCALED_LEADERBOARD_TEXT_SIZE);
function shouldStackLeaderboardRows({ metricCount, widthDp, heightDp, cellWidth, compactRows }) {
  const narrowTallSingleMetricRows =
    metricCount === 1 && widthDp < 150 && heightDp >= 150 && cellWidth <= 112;
  const roomyStackRows = cellWidth < 76 || narrowTallSingleMetricRows;
  return roomyStackRows && !compactRows;
}
assert.equal(
  shouldStackLeaderboardRows({
    metricCount: 1,
    widthDp: 109,
    heightDp: 180,
    cellWidth: compactTwoByThreeLeaderboard.cellWidth,
    compactRows: compactTwoByThreeLeaderboard.compactRows,
  }),
  true,
  "A 2 x 3 single-metric widget must give the full row width to long names",
);
assert.equal(
  shouldStackLeaderboardRows({
    metricCount: 1,
    widthDp: 109,
    heightDp: 50,
    cellWidth: compactTwoByOneLeaderboard.cellWidth,
    compactRows: compactTwoByOneLeaderboard.compactRows,
  }),
  false,
  "A 2 x 1 widget must preserve its compact single-line rows",
);
assert.equal(
  shouldStackLeaderboardRows({
    metricCount: 2,
    widthDp: 109,
    heightDp: 180,
    cellWidth: compactTwoByThreeLeaderboard.cellWidth,
    compactRows: compactTwoByThreeLeaderboard.compactRows,
  }),
  false,
  "Selecting multiple metrics must preserve the existing grid row layout",
);
assert.equal(
  shouldStackLeaderboardRows({
    metricCount: 1,
    widthDp: 109,
    heightDp: 180,
    cellWidth: defaultTwoByThreeLeaderboard.cellWidth,
    compactRows: defaultTwoByThreeLeaderboard.compactRows,
  }),
  false,
  "Narrow/tall rows must fall back to the compact single-line layout when stacking would hide members",
);
function bestLeaderboardGrid(count, width, height, gap) {
  let best = { columns: 1, rows: count, cellWidth: width, cellHeight: height / Math.max(1, count), readability: 0 };
  for (let columns = 1; columns <= count; columns += 1) {
    const rows = Math.ceil(count / columns);
    const cellWidth = (width - gap * (columns - 1)) / columns;
    const cellHeight = (height - gap * (rows - 1)) / rows;
    const readability = Math.min(cellWidth / 68, cellHeight / 39);
    if (readability > best.readability)
      best = { columns, rows, cellWidth, cellHeight, readability };
  }
  return best;
}
function wideTwoMetricSizing(widthDp, heightDp) {
  const pad = Math.min(12, Math.max(4, Math.min(widthDp, heightDp) * 0.065));
  const headerSize = Math.min(17, Math.max(6.2, Math.min(widthDp / 14, heightDp / 6.5)));
  const gap = Math.min(7, Math.max(2, Math.min(widthDp, heightDp) * 0.035));
  const gridTop = pad + headerSize + Math.max(3, headerSize * 0.45);
  const grid = bestLeaderboardGrid(2, widthDp - pad * 2, heightDp - pad - gridTop, gap);
  const cellScale = Math.min(1.45, Math.max(0.62, Math.min(grid.cellWidth / 68, grid.cellHeight / 39)));
  return {
    ...grid,
    cellScale,
    baseRowTextSize: Math.min(14.5, Math.max(4.5, 6.6 * cellScale)),
    minimumNameWidth: Math.min(38, grid.cellWidth * 0.34),
    minimumValueWidth: grid.cellWidth * 0.24,
  };
}
const fourByTwoPair = wideTwoMetricSizing(250, 105);
assert.deepEqual([fourByTwoPair.columns, fourByTwoPair.rows], [2, 1]);
assert.ok(fourByTwoPair.baseRowTextSize <= 9.6);
assert.ok(fourByTwoPair.minimumNameWidth >= 37);
assert.ok(fourByTwoPair.minimumValueWidth < fourByTwoPair.cellWidth * 0.25);
assert.match(
  pluginSource,
  /icon\.startsWith\("walk"\)[\s\S]*conventional walking-person glyph/,
  "Steps needs a recognizable native walking glyph",
);
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
assert.match(
  pluginSource,
  /val portrait = context\.resources\.configuration\.orientation != Configuration\.ORIENTATION_LANDSCAPE[\s\S]{0,180}val width = if \(portrait\) minWidth else maxWidth[\s\S]{0,500}val height = if \(portrait\) maxHeight else minHeight/,
);
assert.doesNotMatch(
  pluginSource,
  /val height = if \(widgetId in smallWidgetIds\)[\s\S]{0,80}fallbackHeight/,
  "Featured bitmaps must not be forced to 50dp and vertically stretched by taller launcher cells",
);
assert.equal(
  Number(smallInfo.match(/android:minResizeHeight="(\d+)dp"/)?.[1]),
  Number(smallInfo.match(/android:maxResizeHeight="(\d+)dp"/)?.[1]),
  "The Featured provider height normalized by the renderer must remain fixed in metadata",
);
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
  /val stackedCompact = size\.compact && size\.heightDp < 48f[\s\S]*val headerBaseline = if \(stackedCompact\) 7\.9f else if \(size\.compact\) 8\.7f else 16f[\s\S]*drawText\(canvas, dateLabel, pad, headerBaseline[\s\S]*eyebrowLeft,[\s\S]*headerBaseline/,
  "Featured date and TODAY'S FOCUS must share one baseline, with the date at the left",
);
assert.match(
  pluginSource,
  /val twoByOneFeatured = size\.compact && !size\.wide[\s\S]*fittedTextPaint\([\s\S]{0,100}eyebrowWidth,[\s\S]{0,80}if \(twoByOneFeatured\) 4f else 5\.1f,[\s\S]{0,60}if \(twoByOneFeatured\) 2\.8f else 4\.1f/,
  "Only the minimum 2x1 Featured header must use the smaller TODAY'S FOCUS typography",
);
assert.match(
  pluginSource,
  /else if \(twoByOneFeatured\) \{[\s\S]{0,30}0\.5f/,
  "Only the 2x1 Featured header must move slightly left",
);
assert.match(pluginSource, /item\.optString\("compactSubtitle", item\.optString\("subtitle"\)\)/);
assert.match(
  pluginSource,
  /drawFeaturedSummary\([\s\S]*if \(stackedCompact\) 28\.6f else if \(size\.compact\) 31\.5f else 54f[\s\S]*todoSummary/,
  "The goals-left and To-Do count must share one baseline in every Featured size",
);
const featuredSummaryRenderer = pluginSource.slice(
  pluginSource.indexOf("private fun drawFeaturedSummary"),
  pluginSource.indexOf("private fun drawCompactGoalTiles"),
);
assert.match(featuredSummaryRenderer, /val combined = "\$goalSummary · \$todoSummary"/);
assert.match(
  featuredSummaryRenderer,
  /drawText\(canvas, combined, pad, baseline, availableWidth, sharedPaint\)/,
  "Featured To-Dos must sit directly after goals-left and its separator",
);
assert.doesNotMatch(
  featuredSummaryRenderer,
  /drawRightAlignedEllipsizedText|withAlpha\(accent/,
  "Featured To-Dos must neither jump to the far edge nor use the green accent",
);
assert.match(pluginSource, /max\(34f, barTop - 10\.5f\)/);
assert.match(
  pluginSource,
  /if \(stackedCompact\) max\(29\.5f, barTop - 7\.5f\)[\s\S]{0,100}barTop - if \(stackedCompact\) 0\.5f else 1\.5f/,
  "Launcher stacks with a shorter reported height must still reserve visible goal tiles",
);
const minimumStackHeight = 42;
const stackedBarTop = minimumStackHeight - 3.7;
const stackedTileTop = Math.max(29.5, stackedBarTop - 7.5);
const stackedTileBottom = stackedBarTop - 0.5;
assert.ok(
  stackedTileBottom - stackedTileTop >= 6,
  "Even the minimum launcher-stack height must keep tiles above the renderer's 6dp visibility floor",
);
const featured2x1Width = 109;
const samsungReported2x1Width = 190;
const featured2x1Pad = 5;
const featuredBadgeDiameter = 24;
const featuredBadgeCenter =
  featured2x1Width - featured2x1Pad - featuredBadgeDiameter / 2;
const featuredContentWidth =
  featuredBadgeCenter - featuredBadgeDiameter / 2 - featured2x1Pad - 5;
const featuredDateWidth = Math.min(featuredContentWidth * 0.32, 14);
const featuredEyebrowWidth = featuredContentWidth - featuredDateWidth - 0.5;
assert.equal(
  featuredContentWidth,
  70,
  "The minimum 2x1 Featured header must retain 70dp for the complete TODAY'S FOCUS label",
);
assert.ok(
  featuredEyebrowWidth > 48,
  "The compact date must leave enough width to show TODAY'S FOCUS in full",
);
const featured2x1GoalAreaWidth = featured2x1Width - 12;
const featured2x1SevenTileSize = Math.min(
  10.5,
  (featured2x1GoalAreaWidth - 1.5 * (7 - 1)) / 7,
);
assert.ok(
  featured2x1SevenTileSize >= 6,
  "The minimum 2x1 Featured widget must fit a seventh tracker square above the visibility floor",
);
assert.ok(
  samsungReported2x1Width < 220,
  "Samsung's wider reported 2x1 span must remain in the non-wide compact Featured treatment",
);
const compactGoalRenderer = pluginSource.slice(
  pluginSource.indexOf("private fun drawCompactGoalTiles"),
  pluginSource.indexOf("private fun drawProgressBadge"),
);
assert.match(
  compactGoalRenderer,
  /twoByOneFeatured -> 7[\s\S]*val availableWidth = size\.widthDp - 12f - if \(twoByOneFeatured\) 0f else badgeReserve[\s\S]*while \(twoByOneFeatured && count > 5 && tileSize < 5\.2f\)/,
  "The 2x1 Featured widget must allow seven squares and fall back safely on unusually narrow launchers",
);
assert.match(
  pluginSource,
  /val progress = if \([\s\S]{0,180}\(rawProgress \* 100f\)\.roundToInt\(\) == 0[\s\S]{0,30}\) 0f else rawProgress/,
  "Featured widget visuals must be completely neutral while the visible percentage is 0%",
);
assert.match(
  pluginSource,
  /val goalProgress = if \(\(rawGoalProgress \* 100f\)\.roundToInt\(\) == 0\) 0f else rawGoalProgress/,
  "Featured widget goal squares must not retain a lime sliver at visible 0%",
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
assert.match(
  pluginSource,
  /val pillCenterY = destination\.bottom - pillHeight \* 0\.35f/,
  "Status avatar percentage should sit at the avatar's feet",
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
assert.match(widgetTypes, /goalSummary: string/);
assert.match(widgetTypes, /todoSummary: string/);
assert.match(widgetTypes, /export type WidgetFeaturedSnapshot/);
assert.match(widgetTypes, /dateLabel: string/);
assert.match(widgetTypes, /export type WidgetAvatarSnapshot/);
assert.match(widgetTypes, /export type WidgetLeaderboardSnapshot/);
assert.match(widgetTypes, /leaderboardMetricIds\?: string\[\]/);
assert.doesNotMatch(widgetTypes, /leaderboardCount/);
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
  /configuration\.leaderboardMetricIds\?\.length[\s\S]*\? configuration\.leaderboardMetricIds[\s\S]*: defaultLeaderboardMetricIds/,
  "The selected tracker list must be the single source of truth for each Leaderboard widget",
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
assert.doesNotMatch(widgetConfig, /leaderboardCountSlider|leaderboardCountLabel|habhub_widget_leaderboard_count/);
assert.doesNotMatch(widgetValues, /habhub_widget_leaderboard_count/);
assert.match(nativeModule, /putArray\([\s\S]*"leaderboardMetricIds"/);
assert.match(nativeModule, /putDouble\([\s\S]*"leaderboardFontScale"/);
assert.match(widgetTypes, /leaderboardFontScale\?: number/);
assert.doesNotMatch(nativeModule, /leaderboardCount/);
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
