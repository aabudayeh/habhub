import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import pngjs from "pngjs";
import ts from "typescript";

const { PNG } = pngjs;

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
const spriteManifestSource = fs.readFileSync(
  path.join(root, "src", "generated", "statusAvatarSprites.ts"),
  "utf8",
);
const spriteGeneratorSource = fs.readFileSync(
  path.join(root, "scripts", "build-status-avatar-sprites.mjs"),
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
const statusPageSource = fs.readFileSync(
  path.join(root, "app", "(tabs)", "status.tsx"),
  "utf8",
);
const uiSource = fs.readFileSync(
  path.join(root, "src", "components", "ui.tsx"),
  "utf8",
);
const seedSource = fs.readFileSync(
  path.join(root, "src", "data", "seed.ts"),
  "utf8",
);
const typesSource = fs.readFileSync(
  path.join(root, "src", "types.ts"),
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
const atlasCompiled = ts.transpileModule(atlasSource, {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022,
  },
  fileName: "statusAvatarAtlas.ts",
  reportDiagnostics: true,
});
assert.equal(atlasCompiled.diagnostics?.length ?? 0, 0);
const atlasCompiledPath = path.join(
  os.tmpdir(),
  `habhub-status-avatar-grid-${process.pid}-${Date.now()}.cjs`,
);
fs.writeFileSync(atlasCompiledPath, atlasCompiled.outputText, "utf8");
let atlasDomain;
try {
  atlasDomain = require(atlasCompiledPath);
} finally {
  fs.unlinkSync(atlasCompiledPath);
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
  statusBodyCompositionForSource,
  statusLeanMassProgress,
  statusMuscleDoseResponse,
  statusMuscleProgressFromWeeks,
  statusMuscleWeeklyQuality,
} = avatarDomain;
const { STATUS_AVATAR_SPRITE_GRIDS, statusAvatarAtlasBlend } = atlasDomain;

for (const variant of ["female", "male"]) {
  assert.equal(STATUS_AVATAR_SPRITE_GRIDS[variant].adiposityStates, 20);
  assert.equal(STATUS_AVATAR_SPRITE_GRIDS[variant].muscleStates, 10);
  assert.equal(STATUS_AVATAR_SPRITE_GRIDS[variant].bodyHeight, 500);
}
for (const sex of ["female", "male"]) {
  const leanUntrained = statusAvatarAtlasBlend(sex, -1, 0).samples[0];
  const middle = statusAvatarAtlasBlend(sex, 0, 0.5).samples[0];
  const fullMuscular = statusAvatarAtlasBlend(sex, 1, 1).samples[0];
  assert.deepEqual(leanUntrained, { column: 0, opacity: 1, row: 0 });
  assert.deepEqual(middle, { column: 6, opacity: 1, row: 5 });
  assert.deepEqual(fullMuscular, { column: 19, opacity: 1, row: 9 });
}

assert.match(
  componentSource,
  /statusAvatarAtlasBlend\([\s\S]{0,160}appearance\.adiposity[\s\S]{0,160}appearance\.muscleProgress/,
  "the avatar must map measured adiposity and muscularity onto the atlas",
);
assert.match(
  componentSource,
  /calculationSource = "bmi"[\s\S]*statusBodyCompositionForSource\([\s\S]{0,80}calculationSource/,
  "missing avatar source preferences must follow the BMI calculation path",
);
assert.match(
  typesSource,
  /StatusAvatarCalculationSource = "bmi" \| "body_composition"[\s\S]*statusAvatarCalculationSource\?: StatusAvatarCalculationSource/,
  "the persisted settings type must expose exactly the two calculation sources",
);
assert.match(
  seedSource,
  /statusAvatarCalculationSource: "bmi"/,
  "new users must default the avatar calculation source to BMI",
);
assert.match(
  typesSource,
  /statusDateNavigatorCollapsed\?: boolean/,
  "the Status date disclosure must be a persisted personal setting",
);
assert.match(
  seedSource,
  /statusDateNavigatorCollapsed: false/,
  "new users must start with the Status date controls visible",
);
assert.match(
  statusPageSource,
  /const dateNavigatorOpen =\s*state\.settings\.statusDateNavigatorCollapsed !== true/,
  "Status must restore the user's date-control disclosure",
);
assert.match(
  statusPageSource,
  /onToggleDateView=\{\(\) => \{[\s\S]{0,300}statusDateNavigatorCollapsed: dateNavigatorOpen/,
  "Status must persist the user's date-control disclosure",
);
assert.match(
  statusPageSource,
  /const FLANK_RING_SIZE = 68;\s*const RING_SIZE = FLANK_RING_SIZE;/,
  "the lower Status tracker circles must match the preferred flank-circle size",
);
assert.match(
  statusPageSource,
  /<Screen minimumBottomPadding=\{16\}>/,
  "Status must not retain the global oversized scroll tail below its final card",
);
assert.match(
  uiSource,
  /minimumBottomPadding\?: number[\s\S]{0,900}typeof minimumBottomPadding === "number"/,
  "Screen must expose a bounded per-page bottom-padding override",
);
assert.match(
  statusPageSource,
  /delayLongPress=\{420\}[\s\S]*onLongPress=[\s\S]*statusAvatarCalculationSource[\s\S]*"body_composition"/,
  "holding the Status avatar must reveal the compact persisted source selector",
);
assert.match(
  componentSource,
  /styles\.avatarViewport[\s\S]*styles\.progressClip[\s\S]*GOAL_COMPLETE_COLOR/,
  "one clipped avatar viewport must own the bottom-up lime progress layer",
);
assert.match(
  componentSource,
  /showProgressLabel = true[\s\S]*showProgressLabel \? \([\s\S]{0,700}styles\.percentPill/,
  "the reusable avatar may render its progress label when requested",
);
assert.match(
  componentSource,
  /numberOfLines=\{1\}[\s\S]{0,180}styles\.percent[\s\S]*percentPill:[\s\S]{0,180}left: "50%"[\s\S]{0,180}width: 60[\s\S]{0,100}translateX: -30/,
  "the avatar percentage must keep 100% on one centered line",
);
assert.match(
  statusPageSource,
  /<BodyProgressAvatar[\s\S]{0,600}showProgressLabel=\{false\}[\s\S]{0,2600}<StatusBodyFact[\s\S]{0,350}label="Weight"[\s\S]{0,1000}styles\.completionFact[\s\S]{0,500}\{completionPercent\}%[\s\S]{0,1000}<StatusBodyFact[\s\S]{0,300}label=\{bodyCompositionStat\.label\}/,
  "Status must place one-line completion percent between Weight and Body fat instead of over the avatar",
);
assert.match(
  statusPageSource,
  /styles\.avatarColumn[\s\S]{0,650}styles\.personHeading[\s\S]{0,500}firstDisplayName\(memberDisplayName\(state, member\)\)[\s\S]{0,900}<BodyProgressAvatar[\s\S]{0,1100}styles\.personWeightPlan/,
  "Status must center the first name above the avatar and its optional weight plan below it",
);
assert.doesNotMatch(
  statusPageSource,
  /summary\.completed\}\/\$\{summary\.opportunities|goal opportunities completed in this range/,
  "Status must not repeat the avatar percentage in a separate completion sentence",
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
  /const scale = height \/ config\.bodyHeight/,
  "every atlas state must normalize its measured body bounds with one uniform scale",
);
assert.match(
  componentSource,
  /left: width \/ 2 - config\.bodyCenter \* scale[\s\S]{0,240}top: -config\.bodyTop \* scale[\s\S]{0,240}width: config\.spriteWidth \* scale/,
  "every atlas state must share one centered head-to-foot viewport",
);
assert.doesNotMatch(
  componentSource,
  /scaleX|scaleY|resizeMode=["']stretch["'][\s\S]{0,300}cropWidth/,
  "the body must not be independently stretched across the two axes",
);
assert.doesNotMatch(
  componentSource,
  /MindAccessories|react-native-svg|<Circle\b|<Polygon\b|mindTier/,
  "the visible avatar renderer must not draw glasses, a monocle, or a hat",
);
assert.doesNotMatch(
  statusSource,
  /<BodyProgressAvatar[\s\S]{0,700}mindTier=/,
  "Status must not pass a removed accessory tier into the avatar renderer",
);
assert.doesNotMatch(
  componentSource,
  /tmp\/imagegen|https?:\/\//,
  "runtime avatar assets must be local final assets rather than drafts or downloads",
);
assert.match(
  atlasSource,
  /adiposityStates:[\s\S]*bodyHeight: 500[\s\S]*muscleStates:[\s\S]*Math\.round\([\s\S]*samples: \[\{ column, row, opacity: 1 \}\]/,
  "the dense atlas must select exactly one normalized crisp body state",
);
assert.doesNotMatch(
  atlasSource,
  /horizontalMix|verticalMix|new Map/,
  "whole-body crossfades must not create duplicate or ghost contours",
);
assert.match(
  componentSource,
  /STATUS_AVATAR_SPRITES\[variant\]\[sample\.row\][\s\S]{0,40}sample\.column/,
  "the renderer must decode only the selected normalized sprite",
);
assert.doesNotMatch(
  componentSource,
  /status-avatar-(?:male|female)-atlas-v1/,
  "the approved low-resolution atlases must be generator inputs, not runtime assets",
);
assert.match(
  spriteGeneratorSource,
  /BODY_HEIGHT = 500[\s\S]*ADIPOSITY_STATES = 20[\s\S]*MUSCLE_STATES = 10/,
  "the reproducible generator must keep 500px bodies and the dense two-axis grid",
);
assert.match(
  spriteGeneratorSource,
  /Premultiplied-alpha separable Lanczos[\s\S]*midpointSprite[\s\S]*horizontalScale/,
  "the generator must supersample approved anchors and bake geometric midpoints",
);
assert.match(
  spriteGeneratorSource,
  /centralTaper[\s\S]{0,500}upperBodyGuard[\s\S]{0,300}extensionWeight/,
  "extended adiposity must widen the central body without dragging forearms away from elbows",
);
assert.doesNotMatch(
  spriteGeneratorSource,
  /tmp[/\\]|https?:\/\//,
  "the generator must use only project-local source art and final paths",
);

const spriteCounts = { female: 20 * 10, male: 20 * 10 };
let spriteBytes = 0;
for (const variant of ["female", "male"]) {
  const directory = path.join(
    root,
    "assets",
    "images",
    "status-avatar-v2",
    variant,
  );
  const files = fs
    .readdirSync(directory)
    .filter((file) => file.endsWith(".png"))
    .sort();
  assert.equal(
    files.length,
    spriteCounts[variant],
    `${variant} must expose twenty adiposity by ten muscle states`,
  );
  const hashes = new Set();
  const alphaAreas = new Map();
  const lowerArmBounds = new Map();
  for (const file of files) {
    const filePath = path.join(directory, file);
    const buffer = fs.readFileSync(filePath);
    spriteBytes += buffer.length;
    const image = PNG.sync.read(buffer);
    assert.deepEqual(
      [image.width, image.height],
      [328, 512],
      `${variant}/${file} must retain its normalized supersampled canvas`,
    );
    let left = image.width;
    let right = -1;
    let top = image.height;
    let bottom = -1;
    let alphaArea = 0;
    for (let y = 0; y < image.height; y += 1) {
      for (let x = 0; x < image.width; x += 1) {
        if (image.data[(y * image.width + x) * 4 + 3] <= 16) continue;
        alphaArea += 1;
        left = Math.min(left, x);
        right = Math.max(right, x);
        top = Math.min(top, y);
        bottom = Math.max(bottom, y);
      }
    }
    assert.ok(right > left && bottom > top, `${variant}/${file} must not be empty`);
    assert.ok(
      bottom - top + 1 >= 490,
      `${variant}/${file} must retain at least 490px of alpha body height`,
    );
    assert.ok(
      Math.abs((left + right) / 2 - 164) <= 4,
      `${variant}/${file} must stay centered on the shared body axis`,
    );
    assert.ok(
      left >= 4 && right <= image.width - 5,
      `${variant}/${file} must retain transparent side safety and never clip`,
    );
    alphaAreas.set(file, alphaArea);
    lowerArmBounds.set(
      file,
      [206, 231, 256].map((y) => {
        let rowLeft = image.width;
        let rowRight = -1;
        for (let x = 0; x < image.width; x += 1) {
          if (image.data[(y * image.width + x) * 4 + 3] <= 16) continue;
          rowLeft = Math.min(rowLeft, x);
          rowRight = Math.max(rowRight, x);
        }
        return [rowLeft, rowRight];
      }),
    );
    hashes.add(crypto.createHash("sha256").update(image.data).digest("hex"));
  }
  assert.equal(
    hashes.size,
    files.length,
    `${variant} intermediate states must be real distinct sprites`,
  );
  for (let row = 0; row < 10; row += 1) {
    const extensionAreas = Array.from({ length: 8 }, (_, offset) => {
      const file = `m${String(row).padStart(2, "0")}-a${String(offset + 12).padStart(2, "0")}.png`;
      return alphaAreas.get(file);
    });
    extensionAreas.slice(1).forEach((area, index) =>
      assert.ok(
        area >= extensionAreas[index] * 0.99,
        `${variant} extended adiposity area must remain visually progressive at muscle row ${row}, column ${index + 13}`,
      ),
    );
    assert.ok(
      extensionAreas.at(-1) >= extensionAreas[0] * 1.08,
      `${variant} a19 must be visibly fuller than the approved a12 endpoint`,
    );
    const approvedArmBounds = lowerArmBounds.get(
      `m${String(row).padStart(2, "0")}-a12.png`,
    );
    for (let column = 13; column < 20; column += 1) {
      const extendedArmBounds = lowerArmBounds.get(
        `m${String(row).padStart(2, "0")}-a${column}.png`,
      );
      extendedArmBounds.forEach(([left, right], index) => {
        const [approvedLeft, approvedRight] = approvedArmBounds[index];
        assert.ok(
          left >= approvedLeft - 3 && right <= approvedRight + 3,
          `${variant} extended lower arms must stay tucked at muscle row ${row}, column ${column}`,
        );
      });
    }
  }
  const manifestRequires = [
    ...spriteManifestSource.matchAll(
      new RegExp(`status-avatar-v2/${variant}/`, "g"),
    ),
  ].length;
  assert.equal(
    manifestRequires,
    files.length,
    `${variant} manifest must statically bundle every generated state once`,
  );
}
assert.ok(
  spriteBytes < 12 * 1_048_576,
  `runtime avatar sprite payload must stay below 12 MiB (received ${spriteBytes})`,
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
  /session\.localDate > anchorDate[\s\S]{0,1800}recentWeekSessions:[\s\S]{0,220}daysAgo <= 6[\s\S]{0,220}recentMonthSessions:[\s\S]{0,220}daysAgo <= 27/,
  "muscle fallback must use anchor-safe week and month resistance frequency",
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
const importHealthCaseStart = stateSource.indexOf('case "importHealth"');
const importHealthCaseEnd = stateSource.indexOf(
  'case "reset"',
  importHealthCaseStart,
);
assert.ok(
  importHealthCaseStart >= 0 && importHealthCaseEnd > importHealthCaseStart,
  "the Health import reducer case must remain present",
);
const importHealthCase = stateSource.slice(
  importHealthCaseStart,
  importHealthCaseEnd,
);
assert.match(
  importHealthCase,
  /withLatestBodyProfileMeasurements/,
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
const male120Column = statusAvatarAtlasBlend("male", male170[4], 0).samples[0]
  .column;
const male150Column = statusAvatarAtlasBlend("male", male170[5], 0).samples[0]
  .column;
assert.ok(
  male150Column >= male120Column + 5 && male150Column > 12,
  "the extreme extension must keep 120 kg and 150 kg visibly separated",
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
assert.equal(
  weightOnly.adiposity,
  weightOnly.bodyMass,
  "when body fat and lean mass are absent, BMI must drive avatar adiposity",
);
assert.deepEqual(
  statusBodyCompositionForSource(undefined, {
    bodyFatPercent: 18,
    leanBodyMassKg: 72,
    sex: "male",
  }),
  { sex: "male" },
  "an existing user without the new preference must default to BMI",
);
assert.deepEqual(
  statusBodyCompositionForSource("body_composition", {
    bodyFatPercent: 18,
    sex: "male",
  }),
  { sex: "male" },
  "composition mode must fall back cleanly when lean mass is missing",
);
assert.deepEqual(
  statusBodyCompositionForSource("body_composition", {
    bodyFatPercent: 18,
    leanBodyMassKg: 72,
    sex: "male",
  }),
  { bodyFatPercent: 18, leanBodyMassKg: 72, sex: "male" },
  "composition mode must preserve both measurements when they are available",
);
const selectedDateBmiFallback = statusBodyAppearance(165, 100, 0, {
  sex: "female",
});
assert.ok(
  selectedDateBmiFallback.adiposity > weightOnly.adiposity,
  "BMI fallback must use the supplied selected-date height and weight",
);
const leanMassOnly = statusBodyAppearance(178, 100, 0.2, {
  leanBodyMassKg: 88,
  sex: "male",
});
assert.ok(
  leanMassOnly.adiposity === weightOnly.adiposity &&
    leanMassOnly.muscleProgress > weightOnly.muscleProgress,
  "lean mass alone must change muscle without silently assuming body fat",
);
const bodyFatWithoutLean = statusBodyAppearance(178, 82, 0.42, {
  bodyFatPercent: 18,
  sex: "male",
});
closeTo(bodyFatWithoutLean.muscleProgress, 0.42, 0.0001);

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
const firstFrequentWeek = statusMuscleProgressFromWeeks([], {
  recentWeekSessions: 3,
  recentMonthSessions: 3,
  lifetimeSessions: 3,
});
const consistentFrequencyMonth = statusMuscleProgressFromWeeks([], {
  recentWeekSessions: 3,
  recentMonthSessions: 12,
  lifetimeSessions: 12,
});
assert.ok(
  firstFrequentWeek > 0 && firstFrequentWeek < 1 / 9,
  "one frequent gym week should count without causing an abrupt muscle tier",
);
assert.ok(
  consistentFrequencyMonth > firstFrequentWeek,
  "month-scale resistance frequency must progressively strengthen the fallback",
);
assert.ok(
  statusMuscleProgressFromWeeks([], {
    recentWeekSessions: 300,
    recentMonthSessions: 300,
    lifetimeSessions: 30_000,
  }) <= 1,
  "gym frequency fallback must remain bounded",
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
