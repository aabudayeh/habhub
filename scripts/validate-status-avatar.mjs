import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sourcePath = path.join(root, "src", "domain", "statusAvatar.ts");
const source = fs.readFileSync(sourcePath, "utf8");
const componentSource = fs.readFileSync(
  path.join(root, "src", "components", "BodyProgressAvatar.tsx"),
  "utf8",
);
const atlasSource = fs.readFileSync(
  path.join(root, "src", "domain", "statusAvatarAtlas.ts"),
  "utf8",
);
const profileEditorSource = fs.readFileSync(
  path.join(root, "src", "components", "ProfileEditors.tsx"),
  "utf8",
);
const stateSource = fs.readFileSync(
  path.join(root, "src", "state", "AppProvider.tsx"),
  "utf8",
);
const statusSource = fs.readFileSync(
  path.join(root, "src", "domain", "status.ts"),
  "utf8",
);
const compiled = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022,
  },
  fileName: sourcePath,
  reportDiagnostics: true,
});
const diagnostics = compiled.diagnostics ?? [];
assert.equal(
  diagnostics.length,
  0,
  diagnostics.map((diagnostic) => diagnostic.messageText).join("\n"),
);
const compiledPath = path.join(
  os.tmpdir(),
  `habhub-status-avatar-${process.pid}-${Date.now()}.cjs`,
);
fs.writeFileSync(compiledPath, compiled.outputText, "utf8");
const require = createRequire(import.meta.url);
let avatarDomain;
try {
  avatarDomain = require(compiledPath);
} finally {
  fs.unlinkSync(compiledPath);
}
const {
  STATUS_AVATAR_VIEWBOX,
  STATUS_BODY_FAT_PERCENT_KNOTS,
  STATUS_BODY_MASS_BMI_KNOTS,
  STATUS_FAT_MASS_INDEX_KNOTS,
  STATUS_LEAN_MASS_INDEX_KNOTS,
  statusAdiposityForBodyFat,
  statusAdiposityForComposition,
  statusAvatarGeometry,
  statusBodyAppearance,
  statusLeanMassProgress,
  statusMuscleDoseResponse,
  statusMuscleProgressFromWeeks,
  statusMuscleWeeklyQuality,
} = avatarDomain;

assert.match(
  componentSource,
  /statusAvatarAtlasBlend\([\s\S]{0,160}appearance\.adiposity[\s\S]{0,160}appearance\.muscleProgress/,
  "the avatar must map measured adiposity and muscularity onto the atlas",
);
assert.match(
  componentSource,
  /styles\.avatarViewport[\s\S]*styles\.progressClip[\s\S]*GOAL_COMPLETE_COLOR/,
  "one clipped avatar viewport must own the bottom-up lime progress layer",
);
assert.match(
  componentSource,
  /bodyModel \? \([\s\S]{0,450}opacityScale=\{0\.36\}[\s\S]{0,180}tintColor=\{colors\.ink\}/,
  "the detailed atlas must retain a theme-visible contour in dark and light modes",
);
assert.doesNotMatch(
  componentSource,
  /AvatarHair|bodySilhouettePath|side-parted haircut/,
  "the atlas contour must not be distorted by a second vector head or haircut",
);
assert.match(
  componentSource,
  /const sourceBodyHeight = config\.bodyHeights\[sample\.row\][\s\S]{0,220}const sourceBodyTop = config\.bodyTops\[sample\.row\][\s\S]{0,220}const sourceBodyCenter = config\.bodyCenters\[sample\.row\]\[sample\.column\][\s\S]{0,220}const scale = height \/ sourceBodyHeight/,
  "every atlas state must normalize its measured body bounds with one uniform scale",
);
assert.match(
  componentSource,
  /left: width \/ 2 - sourceBodyCenter \* scale[\s\S]{0,240}top: -sourceBodyTop \* scale[\s\S]{0,240}width: config\.atlasWidth \* scale/,
  "every atlas state must share one centered head-to-foot viewport",
);
assert.doesNotMatch(
  componentSource,
  /scaleX|scaleY|resizeMode=["']stretch["'][\s\S]{0,300}cropWidth/,
  "the body must not be independently stretched across the two axes",
);
assert.match(
  componentSource,
  /function MindAccessories[\s\S]{0,3500}mindTier >= 3/,
  "mind progression accessories must remain anchored to the atlas face",
);
assert.doesNotMatch(
  componentSource,
  /tmp\/imagegen|https?:\/\//,
  "runtime avatar assets must be local final assets rather than drafts or downloads",
);
assert.match(
  atlasSource,
  /bodyCenters:[\s\S]*bodyHeights:[\s\S]*bodyTops:[\s\S]*Math\.round\([\s\S]*samples: \[\{ column, row, opacity: 1 \}\]/,
  "the dense atlas must select exactly one normalized crisp body state",
);
assert.doesNotMatch(
  atlasSource,
  /horizontalMix|verticalMix|new Map/,
  "whole-body crossfades must not create duplicate or ghost contours",
);
for (const file of [
  "status-avatar-male-atlas-v1.png",
  "status-avatar-female-atlas-v1.png",
]) {
  const assetPath = path.join(root, "assets", "images", file);
  assert.ok(fs.existsSync(assetPath), `${file} must be bundled locally`);
  assert.ok(
    fs.statSync(assetPath).size < 900_000,
    `${file} should remain a compact mobile asset`,
  );
}
assert.doesNotMatch(
  statusSource,
  /earliestWeight|earliestBodyFat|earliestLean/i,
  "historical avatar dates must not borrow the earliest future measurement",
);
assert.match(
  statusSource,
  /entry\.localDate > anchorDate/,
  "selected-date composition must reject measurements after the anchor",
);
assert.match(
  statusSource,
  /entry\.sourceUpdatedAt \?\? entry\.recordedAt/,
  "selected-date composition must use the real source update time",
);
assert.match(
  statusSource,
  /isCurrentDate \? profile\.weightKg : undefined[\s\S]{0,180}latestMeasurementAtOrBefore\(state, "weight"/,
  "today's avatar must use the canonical profile updated by logs and imports",
);
assert.match(
  stateSource,
  /function entryOrder\(entry: MetricEntry\) \{[\s\S]*?return `\$\{entry\.localDate\}:\$\{entry\.sourceUpdatedAt \?\? entry\.recordedAt\}`;/,
  "same-day body composition must be ordered by its real update time",
);
assert.match(
  stateSource,
  /case "log"[\s\S]{0,7000}bodyProfileMapping[\s\S]{0,700}withEnergyProfile/,
  "a current-day manual body-composition log must refresh the profile",
);
assert.match(
  stateSource,
  /case "importHealth"[\s\S]{0,2200}withLatestBodyProfileMeasurements/,
  "a current-day imported body-composition reading must refresh the profile",
);
for (const field of ["bodyFatPercent", "leanBodyMassKg"]) {
  assert.match(
    profileEditorSource,
    new RegExp(`allowEmpty[\\s\\S]{0,120}value=\\{profile\\.${field}\\}`),
    `${field} must remain an optional input in the existing profile card`,
  );
  assert.match(
    stateSource,
    new RegExp(`field: "${field}"[\\s\\S]{0,100}metricId:`),
    `${field} profile changes must be logged through their canonical metric`,
  );
}

const closeTo = (actual, expected, epsilon = 0.015) =>
  assert.ok(
    Math.abs(actual - expected) <= epsilon,
    `${actual} is not within ${epsilon} of ${expected}`,
  );
const strictlyIncreasing = (values, label) => {
  values.slice(1).forEach((value, index) =>
    assert.ok(
      value > values[index],
      `${label} must increase at checkpoint ${index + 1}`,
    ),
  );
};
const nonDecreasing = (values, label) => {
  values.slice(1).forEach((value, index) =>
    assert.ok(
      value >= values[index],
      `${label} must not decrease at checkpoint ${index + 1}`,
    ),
  );
};

// Representative rendering calibration. These are not body predictions: at a
// fixed height, the weights only verify that the total-size fallback remains
// continuous and does not saturate before common high-weight profiles differ.
const profileFixtures = [
  { sex: "male", heightCm: 170, weightsKg: [50, 70, 80, 100, 120, 150] },
  { sex: "female", heightCm: 165, weightsKg: [50, 70, 80, 100, 120, 150] },
];
for (const fixture of profileFixtures) {
  const masses = fixture.weightsKg.map(
    (weightKg) => statusBodyAppearance(fixture.heightCm, weightKg, 0).bodyMass,
  );
  strictlyIncreasing(masses, `${fixture.sex} body mass`);
}
const male170 = [50, 70, 80, 100, 120, 150].map(
  (weightKg) => statusBodyAppearance(170, weightKg, 0).bodyMass,
);
closeTo(male170[0], -0.967);
closeTo(male170[1], -0.128);
closeTo(male170[2], 0.147);
closeTo(male170[3], 0.5);
closeTo(male170[4], 0.746);
closeTo(male170[5], 0.949);
assert.ok(
  male170.at(-1) - male170.at(-2) > 0.15,
  "120 kg and 150 kg at 170 cm must not collapse into one high-mass shape",
);

const shortAppearance = statusBodyAppearance(155, 70, 0);
const tallAppearance = statusBodyAppearance(195, 70, 0);
assert.ok(
  shortAppearance.bodyMass > tallAppearance.bodyMass,
  "the same weight must resolve through height rather than an absolute-kg tier",
);
assert.ok(
  shortAppearance.heightScale < tallAppearance.heightScale,
  "height must also affect presentation scale without changing the pose",
);

const massCheckpoints = STATUS_BODY_MASS_BMI_KNOTS.map(
  (checkpoint) => checkpoint.bodyMass,
);

for (const sex of ["male", "female", "unspecified"]) {
  assert.equal(
    STATUS_BODY_FAT_PERCENT_KNOTS[sex].length,
    10,
    `${sex} must retain ten body-fat review checkpoints`,
  );
  assert.equal(
    STATUS_FAT_MASS_INDEX_KNOTS[sex].length,
    10,
    `${sex} must retain ten fat-mass review checkpoints`,
  );
  assert.equal(
    STATUS_LEAN_MASS_INDEX_KNOTS[sex].length,
    10,
    `${sex} must retain ten lean-mass review checkpoints`,
  );
  strictlyIncreasing(
    STATUS_BODY_FAT_PERCENT_KNOTS[sex].map((percentage) =>
      statusAdiposityForBodyFat(percentage, sex),
    ),
    `${sex} adiposity across body-fat checkpoints`,
  );
  strictlyIncreasing(
    STATUS_LEAN_MASS_INDEX_KNOTS[sex].map((index) =>
      statusLeanMassProgress(170, index * 1.7 ** 2, sex),
    ),
    `${sex} tone across lean-mass checkpoints`,
  );
}

const samePercentLighter = statusAdiposityForComposition(170, 70, 30, "male");
const samePercentHeavier = statusAdiposityForComposition(170, 110, 30, "male");
assert.ok(
  samePercentHeavier > samePercentLighter,
  "measured adiposity must retain absolute fat-mass evidence at a fixed height",
);
const weightOnly = statusBodyAppearance(178, 100, 0.2, { sex: "male" });
const leanMassOnly = statusBodyAppearance(178, 100, 0.2, {
  leanBodyMassKg: 88,
  sex: "male",
});
assert.ok(
  leanMassOnly.adiposity < weightOnly.adiposity &&
    leanMassOnly.muscleProgress > weightOnly.muscleProgress,
  "lean mass alone must separate fat and lean signals instead of looking like weight alone",
);

const leanMale = statusBodyAppearance(178, 82, 0.2, {
  bodyFatPercent: 11,
  leanBodyMassKg: 73,
  sex: "male",
});
const fullerMale = statusBodyAppearance(178, 82, 0.2, {
  bodyFatPercent: 32,
  leanBodyMassKg: 55,
  sex: "male",
});
assert.equal(
  leanMale.bodyMass,
  fullerMale.bodyMass,
  "equal height and weight must keep the same total-size signal",
);
assert.ok(
  leanMale.adiposity < fullerMale.adiposity,
  "body-fat input must independently change fat distribution",
);
assert.ok(
  leanMale.muscleProgress > fullerMale.muscleProgress,
  "lean-mass evidence must independently change tone",
);
assert.equal(leanMale.bodyShape, "average");
assert.equal(fullerMale.bodyShape, "full");
const contradictoryComposition = statusBodyAppearance(170, 70, 1, {
  bodyFatPercent: 65,
  leanBodyMassKg: 120,
  sex: "female",
});
assert.ok(
  contradictoryComposition.muscleProgress >= 0 &&
    contradictoryComposition.muscleProgress <= 1 &&
    contradictoryComposition.adiposity >= -1 &&
    contradictoryComposition.adiposity <= 1,
  "inconsistent composition inputs must remain bounded",
);
const muscleCheckpoints = Array.from(
  { length: 10 },
  (_, index) => index / 9,
);

for (const sex of ["male", "female"]) {
  // Ten QA checkpoints on the thin-to-full axis. These are calibration points,
  // not runtime sprites; every value between them uses the same interpolation.
  const massGeometries = massCheckpoints.map((mass) =>
    statusAvatarGeometry(sex, mass, 0.45),
  );
  for (const key of ["waistHalf", "hipHalf", "thighHalf", "calfHalf"])
    strictlyIncreasing(
      massGeometries.map((geometry) => geometry.body[key]),
      `${sex} ${key} across body-mass checkpoints`,
    );
  nonDecreasing(
    massGeometries.map((geometry) => geometry.body.shoulderHalf),
    `${sex} shoulder across body-mass checkpoints`,
  );

  const compositionGeometries = STATUS_BODY_FAT_PERCENT_KNOTS[sex].map(
    (percentage) =>
      statusAvatarGeometry(
        sex,
        0.2,
        0.45,
        statusAdiposityForBodyFat(percentage, sex),
      ),
  );
  strictlyIncreasing(
    compositionGeometries.map((geometry) => geometry.body.waistHalf),
    `${sex} waist across body-fat checkpoints`,
  );
  strictlyIncreasing(
    compositionGeometries.map((geometry) => geometry.body.hipHalf),
    `${sex} hip across body-fat checkpoints`,
  );
  assert.ok(
    compositionGeometries.every(
      (geometry) =>
        geometry.body.shoulderHalf ===
        compositionGeometries[0].body.shoulderHalf,
    ),
    `${sex} body-fat changes must not distort the shoulder pose`,
  );
  assert.ok(
    compositionGeometries.at(-1).body.waistHalf -
      compositionGeometries[0].body.waistHalf >=
      18,
    `${sex} high and low adiposity must be visibly different at equal mass`,
  );

  // Ten independent muscle checkpoints. Head/accessory anchors stay fixed;
  // shoulders, chest and arms progressively gain volume at every step.
  const muscleGeometries = muscleCheckpoints.map((muscle) =>
    statusAvatarGeometry(sex, 0.2, muscle),
  );
  strictlyIncreasing(
    muscleGeometries.map((geometry) => geometry.body.shoulderHalf),
    `${sex} shoulder across muscle checkpoints`,
  );
  strictlyIncreasing(
    muscleGeometries.map((geometry) => geometry.body.chestHalf),
    `${sex} chest across muscle checkpoints`,
  );
  strictlyIncreasing(
    muscleGeometries.map((geometry) => geometry.body.upperArmOuterHalf),
    `${sex} upper arm across muscle checkpoints`,
  );
  assert.ok(
    muscleGeometries.at(-1).body.waistHalf <
      muscleGeometries[0].body.waistHalf,
    `${sex} muscularity should not thicken the waist`,
  );

  for (const mass of massCheckpoints) {
    for (const muscle of muscleCheckpoints) {
      const geometry = statusAvatarGeometry(sex, mass, muscle);
      const values = [
        ...Object.values(geometry.body),
        ...Object.values(geometry.accessory),
      ];
      assert.ok(values.every(Number.isFinite), `${sex} geometry must be finite`);
      assert.ok(
        geometry.body.elbowOuterHalf < STATUS_AVATAR_VIEWBOX.centerX - 20,
        `${sex} combined body must remain inside the viewBox`,
      );
      assert.ok(
        geometry.accessory.eyeOffset + geometry.accessory.lensRadius <=
          geometry.body.headHalf + 1,
        `${sex} glasses must stay across the face`,
      );
      assert.equal(
        geometry.accessory.capTopY,
        STATUS_AVATAR_VIEWBOX.headTopY - 8,
        `${sex} cap must remain seated on the head`,
      );
    }
  }

  const stableFace = [-1, -0.3, 0.4, 1].map((mass) =>
    statusAvatarGeometry(sex, mass, mass < 0 ? 0 : mass, -mass),
  );
  const headWidths = stableFace.map((geometry) => geometry.body.headHalf);
  assert.ok(
    headWidths.every((value) => value === headWidths[0]),
    `${sex} head/face proportions must not change between morph states`,
  );
  for (const key of ["eyeY", "eyeOffset", "lensRadius"]) {
    const values = stableFace.map((geometry) => geometry.accessory[key]);
    assert.ok(
      values.every((value) => value === values[0]),
      `${sex} ${key} must stay aligned to the same face`,
    );
  }

  const leanUntrained = statusAvatarGeometry(sex, 0, 0.05, -0.8);
  const fullMuscular = statusAvatarGeometry(sex, 0, 0.9, 0.8);
  assert.ok(
    fullMuscular.body.waistHalf > leanUntrained.body.waistHalf &&
      fullMuscular.body.shoulderHalf > leanUntrained.body.shoulderHalf,
    `${sex} adiposity and muscularity must remain visible together`,
  );
}

const totalHeight =
  STATUS_AVATAR_VIEWBOX.baselineY - STATUS_AVATAR_VIEWBOX.headTopY;
const legRatio =
  (STATUS_AVATAR_VIEWBOX.baselineY - STATUS_AVATAR_VIEWBOX.crotchY) /
  totalHeight;
assert.ok(legRatio >= 0.44 && legRatio <= 0.5, "legs should be about half the body");
assert.ok(
  STATUS_AVATAR_VIEWBOX.handTipY > STATUS_AVATAR_VIEWBOX.crotchY &&
    STATUS_AVATAR_VIEWBOX.handTipY < STATUS_AVATAR_VIEWBOX.kneeY - 25,
  "hands should end at the upper thigh",
);

closeTo(statusMuscleDoseResponse(0), 0, 0.0001);
closeTo(statusMuscleDoseResponse(10), 1, 0.0001);
assert.ok(statusMuscleDoseResponse(20) < 1.15, "20 sets must be near the dose plateau");
assert.equal(
  statusMuscleDoseResponse(200),
  statusMuscleDoseResponse(20),
  "excess weekly volume must be capped",
);
assert.equal(
  statusMuscleWeeklyQuality([20, 20, 20, 20, 20, 20, 20]),
  1,
  "weekly quality must remain bounded",
);
const oneMaximalWeek = statusMuscleProgressFromWeeks([
  { quality: 1, weeksAgo: 0 },
]);
assert.ok(
  oneMaximalWeek < 1 / 9,
  "one unusually large week must not jump a visual checkpoint",
);
const consistentProgress = (weekCount, quality = 0.75, offset = 0) =>
  statusMuscleProgressFromWeeks(
    Array.from({ length: weekCount }, (_, weeksAgo) => ({
      quality,
      weeksAgo: weeksAgo + offset,
    })),
  );
const week8 = consistentProgress(8);
const week16 = consistentProgress(16);
const week24 = consistentProgress(24);
assert.ok(week8 >= 1 / 9, "consistent early training should reach tier one by week eight");
assert.ok(week16 >= 2 / 9, "consistent training should reach tier two near week sixteen");
assert.ok(
  week24 - week16 < week16 - week8,
  "visual progression should slow as training age grows",
);
const activeLongTerm = consistentProgress(80, 0.8);
const inactiveLongTerm = consistentProgress(80, 0.8, 10);
assert.ok(
  inactiveLongTerm >= activeLongTerm * 0.85,
  "recent inactivity may soften tone but must preserve lifetime adaptation",
);

process.stdout.write(
  `Status avatar calibration passed (${profileFixtures.length} profiles, ` +
    `${massCheckpoints.length} mass tiers, ${muscleCheckpoints.length} muscle tiers).\n`,
);
