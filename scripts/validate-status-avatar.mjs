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
  STATUS_LEAN_MASS_INDEX_KNOTS,
  statusAdiposityForBodyFat,
  statusAvatarGeometry,
  statusBodyAppearance,
  statusLeanMassProgress,
  statusMuscleDoseResponse,
  statusMuscleProgressFromWeeks,
  statusMuscleWeeklyQuality,
} = avatarDomain;

assert.match(
  componentSource,
  /d=\{bodyPath\}[\s\S]*fill=\{`url\(#\$\{gradientId\}\)`\}[\s\S]*stroke=\{colors\.ink\}/,
  "the same single silhouette path must own both lime fill and outline",
);
assert.doesNotMatch(
  componentSource,
  /ClipPath|clipPath/,
  "the body must not be duplicated behind a clipping mask",
);
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

// Representative real profile calibration. At 170 cm, 70/80/90/120 kg must
// remain visibly distinct instead of saturating early at the full silhouette.
const profileFixtures = [
  { sex: "male", heightCm: 170, weightsKg: [55, 70, 80, 90, 120] },
  { sex: "female", heightCm: 165, weightsKg: [48, 60, 75, 90, 115] },
];
for (const fixture of profileFixtures) {
  const masses = fixture.weightsKg.map(
    (weightKg) => statusBodyAppearance(fixture.heightCm, weightKg, 0).bodyMass,
  );
  strictlyIncreasing(masses, `${fixture.sex} body mass`);
}
const male170 = [70, 80, 90, 120].map(
  (weightKg) => statusBodyAppearance(170, weightKg, 0).bodyMass,
);
closeTo(male170[0], -0.058);
closeTo(male170[1], 0.199);
closeTo(male170[2], 0.427);
closeTo(male170[3], 0.866);

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
