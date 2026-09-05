import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  adjacentPhotoVideoSpeed,
  chronologicalProgressPhotos,
  fullPhotoDate,
  nearestPhotoMeasurement,
  photoFrameDurationMs,
  photoIndexAtOffset,
  photoVideoSpeedAtOffset,
  photoWeightLabel,
  PHOTO_VIDEO_SPEEDS,
} from "../src/domain/photoProgress.ts";
import { refreshDefaultDemoFixtures } from "../src/domain/demoFixtures.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (relativePath) =>
  fs.readFileSync(path.join(root, relativePath), "utf8");

const photos = [
  { id: "later", localDate: "2026-08-30", createdAt: "2026-08-30T12:00:00Z" },
  { id: "earlier", localDate: "2026-08-01", createdAt: "2026-08-01T12:00:00Z" },
];
assert.deepEqual(
  chronologicalProgressPhotos(photos).map((photo) => photo.id),
  ["earlier", "later"],
  "Photo playback must remain chronological.",
);
assert.match(fullPhotoDate("2026-08-30", "en-GB"), /2026/);
assert.doesNotMatch(
  fullPhotoDate("2026-08-30", "en-GB"),
  /today/i,
  "Comparison dates must never become relative Today labels.",
);

const measurements = [
  {
    id: "weight-far",
    userId: "me",
    metricId: "weight",
    localDate: "2026-08-01",
    recordedAt: "2026-08-01T09:00:00Z",
    value: 80,
  },
  {
    id: "weight-near",
    userId: "me",
    metricId: "weight",
    localDate: "2026-08-20",
    recordedAt: "2026-08-20T09:00:00Z",
    value: 78,
  },
];
assert.equal(
  nearestPhotoMeasurement(measurements, "me", "2026-08-30", "weight")?.value,
  78,
  "A photo must use the nearest canonical weight measurement.",
);
assert.match(
  photoWeightLabel(measurements, "me", "2026-08-30", "en-GB") ?? "",
  /measured.*2026.*10d away/i,
  "A nearest measurement more than seven days away must disclose its date.",
);
assert.equal(photoFrameDurationMs(2), 500);
assert.equal(photoFrameDurationMs(20), 50);
assert.deepEqual(
  [...PHOTO_VIDEO_SPEEDS],
  [0.5, ...Array.from({ length: 20 }, (_, index) => index + 1)],
  "Slideshow speed must retain half-speed and expose every whole speed from 1x through 20x.",
);
assert.equal(adjacentPhotoVideoSpeed(12, 1), 13);
assert.equal(adjacentPhotoVideoSpeed(19, 1), 20);
assert.equal(adjacentPhotoVideoSpeed(0.5, -1), 0.5);
assert.equal(photoVideoSpeedAtOffset(0, 100), 0.5);
assert.equal(photoVideoSpeedAtOffset(50, 100), 10);
assert.equal(photoVideoSpeedAtOffset(100, 100), 20);
assert.equal(photoIndexAtOffset(50, 100, 5), 2);

const seed = read("src/data/seed.ts");
const demoAssets = read("src/data/demoAssets.ts");
const demoFixtures = read("src/domain/demoFixtures.ts");
const appProvider = read("src/state/AppProvider.tsx");
const migration = read("src/domain/stateMigration.ts");
const studio = read("src/components/PhotoComparisonStudio.tsx");
const weightSlider = read("src/components/WeightQuickSlider.tsx");
const nativeVideo = read("plugins/habhub-android/java/HabHubPhotoVideoExporter.kt");
const nativeModule = read("plugins/habhub-android/java/HabHubNativeModule.kt");
const androidPlugin = read("plugins/withHabHubAndroid.js");
const metricDetail = read("app/metric-detail.tsx");
const logScreen = read("app/(tabs)/log.tsx");
const memberComparison = read("app/member/[id].tsx");
assert.match(seed, /id: "progress_photo",[\s\S]{0,80}name: "Photo progress"/);
for (let index = 1; index <= 5; index += 1) {
  const filename = `assets/demo/progress-${String(index).padStart(2, "0")}.jpg`;
  const size = fs.statSync(path.join(root, filename)).size;
  assert.ok(size > 50_000 && size < 500_000, `${filename} must be a production-sized bundled JPEG`);
  assert.match(demoAssets, new RegExp(`progress-${String(index).padStart(2, "0")}\\.jpg`));
}
assert.doesNotMatch(demoAssets, /progress-[abc]\.jpg/);
assert.match(demoAssets, /DEMO_MEAL_URI[\s\S]{0,100}meal-breakfast\.jpg/);
assert.match(demoAssets, /DEMO_WORKOUT_SHARE_URI[\s\S]{0,100}workout-share\.jpg/);
assert.match(
  seed,
  /imageUri: DEMO_MEAL_URI/,
  "The demo food log must use dedicated meal media.",
);
assert.match(
  seed,
  /imageUri: DEMO_WORKOUT_SHARE_URI/,
  "The demo chat must use dedicated workout-share media.",
);
assert.doesNotMatch(
  seed,
  /imageUri: DEMO_PROGRESS_URIS/,
  "Progress photos must never be reused as food, journal, or chat attachments.",
);
assert.match(
  seed,
  /function demoPhotos\(\)[\s\S]{0,900}userId: "ahmad"/,
  "The one-person demo photo sequence must belong only to the matching demo profile.",
);
assert.match(seed, /demoContentVersion: 5/);
assert.match(
  appProvider,
  /const refreshDefaultDemo =[\s\S]{0,260}demoContentVersion/,
  "Existing disposable demo snapshots must refresh to the production fixture without touching account groups.",
);
assert.match(
  appProvider,
  /isMissingDefaultDemoStatus[\s\S]{0,900}restoredDemoStatusKeys/,
  "A partially upgraded demo snapshot must self-heal missing leaderboard projections.",
);
assert.match(
  appProvider,
  /const refreshedDemoFixtures = refreshDefaultDemo[\s\S]{0,120}refreshDefaultDemoFixtures\(restored, defaults\)/,
);
assert.match(appProvider, /entries:\s*refreshedDemoFixtures[\s\S]{0,80}refreshedDemoFixtures\.entries/);
assert.match(appProvider, /photos:\s*refreshedDemoFixtures[\s\S]{0,80}refreshedDemoFixtures\.photos/);
assert.match(
  appProvider,
  /dailyMetricStatuses:\s*refreshedDemoFixtures[\s\S]{0,100}refreshedDemoFixtures\.dailyMetricStatuses/,
  "A demo fixture upgrade must install privacy-safe group projections for the showcase leaderboard.",
);
assert.match(demoFixtures, /function replaceDemoStatuses/);
assert.match(
  seed,
  /function demoSharedStatuses[\s\S]{0,2400}privacyProjectionVersion: 2/,
  "Shared demo values must use the same explicit privacy projection contract as cloud leaderboard data.",
);
assert.doesNotMatch(
  appProvider,
  /refreshDefaultDemo\s*\?\s*defaults\.(?:entries|photos|todos|journalNotes|calendarReminders|gymPlans|gymSessions|messages|energyProfiles)/,
  "A demo-version bump must never replace an entire account-owned collection.",
);
assert.match(demoFixtures, /DEFAULT_DEMO_ENTRY_ID/);
assert.match(demoFixtures, /DEFAULT_DEMO_PHOTO_ID/);

const profile = (weightKg) => ({
  age: 30,
  sex: "male",
  heightCm: 178,
  weightKg,
  targetWeightKg: 80,
  activityLevel: "light",
  desiredWeeklyLossKg: 0.5,
});
const personalRecords = {
  entries: { id: "entry-1720000000000-personal" },
  photos: { id: "photo-1720000000000-personal" },
  todos: { id: "todo-1720000000000-personal" },
  journalNotes: { id: "note-1720000000000-personal" },
  calendarReminders: { id: "calendar-1720000000000-personal" },
  gymPlans: { id: "plan-1720000000000-personal" },
  gymSessions: { id: "session-1720000000000-personal" },
  messages: { id: "message-1720000000000-personal" },
};
const currentFixtures = {
  entries: { id: "2026-09-04-ahmad-steps", fixtureVersion: 2 },
  photos: { id: "demo-photo-ahmad-2026-09-04", fixtureVersion: 2 },
  todos: { id: "demo-todo-morning-walk", fixtureVersion: 2 },
  journalNotes: { id: "demo-journal-weekly-review", fixtureVersion: 2 },
  calendarReminders: { id: "demo-reminder-water", fixtureVersion: 2 },
  gymPlans: { id: "demo-plan-full-body", fixtureVersion: 2 },
  gymSessions: { id: "demo-session-2026-09-04", fixtureVersion: 2 },
  messages: { id: "welcome", fixtureVersion: 2 },
};
const legacyFixtures = {
  entries: { id: "2026-07-01-ahmad-steps", fixtureVersion: 1 },
  photos: { id: "demo-photo-maya-2026-07-01", fixtureVersion: 1 },
  todos: { id: "demo-todo-retired", fixtureVersion: 1 },
  journalNotes: { id: "demo-journal-retired", fixtureVersion: 1 },
  calendarReminders: { id: "demo-reminder-retired", fixtureVersion: 1 },
  gymPlans: { id: "demo-plan-retired", fixtureVersion: 1 },
  gymSessions: { id: "demo-session-2026-07-01", fixtureVersion: 1 },
  messages: { id: "sarah-message", fixtureVersion: 1 },
};
const customizedProfile = profile(87.3);
const customMemberProfile = profile(91.2);
const customExerciseGoal = { targetWeightKg: 127.5, targetReps: 5 };
const restoredDemoState = {
  currentUserId: "ahmad",
  settings: { energyProfile: customizedProfile },
  energyProfiles: {
    ahmad: profile(89.9),
    "custom-member": customMemberProfile,
  },
  gymExerciseGoals: {
    back_squat: customExerciseGoal,
    custom_lift: { targetReps: 12 },
  },
  ...Object.fromEntries(
    Object.keys(personalRecords).map((key) => [
      key,
      [legacyFixtures[key], currentFixtures[key], personalRecords[key]],
    ]),
  ),
};
const defaultDemoState = {
  currentUserId: "ahmad",
  settings: { energyProfile: profile(88.1) },
  energyProfiles: { ahmad: profile(88.1), sarah: profile(68) },
  gymExerciseGoals: {
    back_squat: { targetWeightKg: 82.5, targetReps: 8 },
  },
  ...Object.fromEntries(
    Object.keys(currentFixtures).map((key) => [key, [currentFixtures[key]]]),
  ),
};
const refreshedFixtures = refreshDefaultDemoFixtures(
  restoredDemoState,
  defaultDemoState,
);
for (const [key, personalRecord] of Object.entries(personalRecords)) {
  assert.strictEqual(
    refreshedFixtures[key].find((item) => item.id === personalRecord.id),
    personalRecord,
    `${key} must preserve the exact user-created record during a demo refresh.`,
  );
  assert.deepEqual(
    refreshedFixtures[key].filter((item) => item.fixtureVersion).map((item) => item.fixtureVersion),
    [2],
    `${key} must replace known current/legacy fixture ids with only the latest fixture.`,
  );
}
assert.strictEqual(refreshedFixtures.energyProfiles.ahmad, customizedProfile);
assert.strictEqual(
  refreshedFixtures.energyProfiles["custom-member"],
  customMemberProfile,
);
assert.ok(refreshedFixtures.energyProfiles.sarah);
assert.strictEqual(
  refreshedFixtures.gymExerciseGoals.back_squat,
  customExerciseGoal,
  "A user-edited goal on a seeded exercise must win over the new fixture.",
);
assert.deepEqual(refreshedFixtures.gymExerciseGoals.custom_lift, {
  targetReps: 12,
});
assert.match(migration, /metric\.id === "progress_photo"[\s\S]{0,120}name: "Photo progress"/);
assert.match(
  seed,
  /id: "progress_photo"[\s\S]{0,300}goalEnabled: false/,
  "Photo progress must be goal-free by default.",
);
assert.match(
  migration,
  /metric\.id === "progress_photo"[\s\S]{0,500}goalEnabled: metric\.goalEnabled \?\? false/,
  "Legacy Photo progress defaults must become goal-free without overwriting an explicit user choice.",
);
assert.match(metricDetail, /tracker\.id === "progress_photo"[\s\S]{0,180}<PhotoComparisonStudio/);
assert.match(
  logScreen,
  /selected\.dataType === "photo"[\s\S]{0,1800}bodyCompositionMetrics[\s\S]{0,1600}logMetric\(\s*measurement\.id/,
  "Photo progress logging must persist optional body measurements to their canonical trackers.",
);
assert.match(
  weightSlider,
  /const normalizedValue = value\.trim\(\)\.replace\(",", "\."\);[\s\S]{0,100}normalizedValue \? Number\(normalizedValue\) : Number\.NaN/,
  "An untouched Weight input must anchor the slider at the last logged value instead of treating an empty string as zero.",
);
assert.match(
  logScreen,
  /selected\.dataType === "photo"[\s\S]{0,4000}Optional body measurements[\s\S]{0,1200}bodyCompositionMetrics/,
  "Photo progress logging must expose compact optional Weight, Body fat, and Lean mass inputs.",
);
assert.match(
  logScreen,
  /selected\.id === "weight"[\s\S]{0,1500}primaryMeasurementInput[\s\S]{0,300}accessibilityLabel="Weight"[\s\S]{0,1000}Body composition \(optional\)/,
  "Weight must remain the visually primary measurement in its multi-metric log.",
);
assert.match(
  logScreen,
  /primaryMeasurementText:\s*\{[\s\S]{0,160}\.\.\.typography\.body[\s\S]{0,120}fontWeight:\s*"800"/,
  "The highlighted Weight input must use the standard app input type scale.",
);
assert.match(
  logScreen,
  />Progress photo<[\s\S]{0,800}accessibilityLabel=\{entryImage \? "Change progress photo" : "Attach a progress photo"\}[\s\S]{0,4000}Optional body measurements/,
  "Photo progress must make the required photo visually primary before optional measurements.",
);
assert.match(metricDetail, /entryRangeView = \["week", "month", "year", "overall"\]\.includes/);
assert.match(metricDetail, /entriesSectionOpen = entriesOpenOverride \?\? !entryRangeView/);
assert.match(metricDetail, /setCollapsedEntryDates\(new Set\(entryRangeView \? dates : \[\]\)\)/);
assert.match(metricDetail, /accessibilityState=\{\{ expanded: entriesSectionOpen \}\}/);
assert.match(metricDetail, /\{entriesSectionOpen \? <View style=\{styles\.entries\}>/);
assert.match(metricDetail, /function WeeklyDetail[\s\S]{0,1500}entriesOpen = entriesOpenOverride \?\? !entryRangeView/);
assert.match(metricDetail, /function WeeklyDetail[\s\S]{0,1500}setOpenEntryDates\(new Set\(\)\)/);
assert.match(studio, /MediaRecorder\.isTypeSupported/);
assert.match(studio, /mimeType\.startsWith\("video\/mp4"\) \? "mp4" : "webm"/);
assert.doesNotMatch(
  studio,
  /Promise\.all\([\s\S]{0,300}ordered\.map[\s\S]{0,300}loadWebImage/,
  "Video export must not retain a full history of decoded phone photos.",
);
assert.match(
  studio,
  /currentImage = await loadWebImage\(ordered\[0\]\)[\s\S]{0,1800}drawVideoFrame\([\s\S]{0,500}activeRecorder\.start\(1_000\)/,
  "The first slideshow photo must decode and render before timed recording starts.",
);
assert.match(
  studio,
  /const nextImageResult = nextIndex < ordered\.length[\s\S]{0,300}loadWebImage\(ordered\[nextIndex\]\)[\s\S]{0,500}transitionWebRecorder\(activeRecorder, "pause"\)[\s\S]{0,1000}releaseWebImage\(previousImage\)[\s\S]{0,300}transitionWebRecorder\(activeRecorder, "resume"\)/,
  "Video export must use bounded look-ahead and pause encoding around slow image transitions.",
);
assert.match(studio, /PHOTO_VIDEO_SPEEDS\.at\(-1\)/);
assert.match(studio, /adjacentPhotoVideoSpeed\(current, 1\)/);
assert.doesNotMatch(studio, />Slideshow speed</);
assert.doesNotMatch(studio, /speedTrackTouchTarget/);
assert.match(
  studio,
  /onResponderGrant=\{\(event\) => \{[\s\S]{0,220}pageX - event\.nativeEvent\.locationX[\s\S]{0,200}onResponderMove=\{\(event\) =>[\s\S]{0,100}pageX - trackPageXRef\.current/,
  "Photo seeking must use stable page coordinates throughout a drag.",
);
assert.match(studio, /accessibilityLabel="Save slideshow video locally"/);
assert.match(studio, /accessibilityLabel="Share slideshow video with another app"/);
assert.match(studio, /Alert\.alert\([\s\S]{0,80}"Video saved"/);
assert.match(studio, /await shareWebFile\(/);
assert.match(studio, /createNativePhotoProgressVideo\(/);
assert.match(studio, /saveNativePhotoProgressVideo\(/);
assert.match(
  studio,
  /measurements: bodyEntries\.map[\s\S]{0,260}recordedAt: entry\.recordedAt/,
  "Cached videos must invalidate when their displayed body measurements change.",
);
assert.match(studio, /Sharing\.shareAsync\(artifact\.uri,[\s\S]{0,160}mimeType: "video\/mp4"/);
assert.match(nativeVideo, /MediaCodec\.createEncoderByType/);
assert.match(nativeVideo, /MediaMuxer\.OutputFormat\.MUXER_OUTPUT_MPEG_4/);
assert.match(nativeVideo, /MediaStore\.Video\.Media\.RELATIVE_PATH/);
assert.match(
  nativeVideo,
  /encodingCompleted[\s\S]{0,900}muxerStopFailure[\s\S]{0,500}output\.delete\(\)[\s\S]{0,120}Android could not finalize the MP4 file/,
  "Android video export must reject and remove an MP4 when muxer finalization fails.",
);
assert.match(
  nativeVideo,
  /bitmapToYuv420\(bitmap\)[\s\S]{0,100}finally[\s\S]{0,80}bitmap\.recycle\(\)/,
  "Android video export must recycle each rendered bitmap even when color conversion fails.",
);
assert.match(nativeModule, /fun createPhotoProgressVideo\(/);
assert.match(nativeModule, /fun savePhotoProgressVideo\(/);
assert.match(androidPlugin, /"HabHubPhotoVideoExporter\.kt"/);
assert.doesNotMatch(studio, /Save or share slideshow video/);
assert.match(studio, /minimumSelected=\{2\}/);
assert.match(studio, /onDeletePhoto\(active\.id\)/);
assert.match(studio, /showBodyFat/);
assert.match(studio, /showLeanMass/);
assert.match(memberComparison, /photoComparisonSection: \{ gap: 8, marginTop: 12 \}/);
assert.match(memberComparison, /fullPhotoDate\(primary\.localDate, locale\)/);
assert.match(metricDetail, /const canOpenPhotoProgress =[\s\S]{0,180}tracker\.id === "weight"/);
assert.match(metricDetail, /accessibilityLabel="Open Photo progress"/);

console.log("Photo comparison checks passed.");
