import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function compilePureDomain(relativePath, label) {
  const sourcePath = path.join(root, relativePath);
  const source = fs.readFileSync(sourcePath, "utf8");
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
    fileName: sourcePath,
    reportDiagnostics: true,
  });
  assert.equal(
    compiled.diagnostics?.length ?? 0,
    0,
    `${label} must transpile without diagnostics`,
  );
  const compiledPath = path.join(
    os.tmpdir(),
    `habhub-${label}-${process.pid}-${Date.now()}.cjs`,
  );
  fs.writeFileSync(compiledPath, compiled.outputText, "utf8");
  try {
    return { module: createRequire(import.meta.url)(compiledPath), source };
  } finally {
    fs.unlinkSync(compiledPath);
  }
}

const simulation = compilePureDomain(
  "src/domain/statusAvatarSimulation.ts",
  "avatar-simulation",
);
const avatar = compilePureDomain("src/domain/statusAvatar.ts", "avatar-domain");
const componentSource = fs.readFileSync(
  path.join(root, "src", "components", "StatusAvatarSimulator.tsx"),
  "utf8",
);
const bodyComponentSource = fs.readFileSync(
  path.join(root, "src", "components", "BodyProgressAvatar.tsx"),
  "utf8",
);
const statusPageSource = fs.readFileSync(
  path.join(root, "app", "(tabs)", "status.tsx"),
  "utf8",
);

const {
  STATUS_AVATAR_SIMULATION_METRICS,
  statusAvatarSimulationBaseline,
  statusAvatarSimulationInitialState,
  statusAvatarSimulationMarkers,
  statusAvatarSimulationPreview,
  statusAvatarSimulationRange,
  statusAvatarSimulationSetEnabled,
  statusAvatarSimulationSetValue,
} = simulation.module;
const { statusBodyAppearance } = avatar.module;

assert.deepEqual(
  STATUS_AVATAR_SIMULATION_METRICS.map((item) => item.id),
  ["weight", "bmi", "body_fat", "lean_body_mass"],
  "the simulation model must retain the four body-composition signals",
);

const fallback = statusAvatarSimulationBaseline(Object.freeze({}));
assert.equal(fallback.sex, "unspecified");
assert.equal(fallback.bodyFatWasLogged, false);
assert.equal(fallback.leanMassWasLogged, false);
assert.ok(Number.isFinite(fallback.heightCm) && fallback.heightCm > 0);
assert.ok(Number.isFinite(fallback.weightKg) && fallback.weightKg > 0);
assert.ok(Number.isFinite(fallback.bodyFatPercent));
assert.ok(Number.isFinite(fallback.leanBodyMassKg));
const fallbackState = statusAvatarSimulationInitialState(fallback, "bmi");
assert.deepEqual(
  fallbackState.enabled,
  { bmi: true, body_fat: false, lean_body_mass: false, weight: true },
  "unlogged composition must begin off while weight and its derived BMI stay available",
);

const baseline = statusAvatarSimulationBaseline({
  age: 35,
  bodyFatPercent: 18,
  heightCm: 178,
  leanBodyMassKg: 67,
  muscleProgress: 0.35,
  sex: "male",
  weightKg: 82,
});
assert.equal(baseline.bodyFatWasLogged, true);
assert.equal(baseline.leanMassWasLogged, true);
assert.equal(baseline.weightWasLogged, true);
const compositionState = statusAvatarSimulationInitialState(
  baseline,
  "body_composition",
);
assert.equal(compositionState.enabled.bmi, true);
assert.equal(compositionState.enabled.body_fat, true);
assert.equal(compositionState.enabled.lean_body_mass, true);

for (const metric of STATUS_AVATAR_SIMULATION_METRICS.map((item) => item.id)) {
  const range = statusAvatarSimulationRange(metric, baseline);
  assert.ok(Number.isFinite(range.minimumValue));
  assert.ok(Number.isFinite(range.maximumValue));
  assert.ok(range.minimumValue < range.maximumValue);
  assert.ok(range.initialValue >= range.minimumValue);
  assert.ok(range.initialValue <= range.maximumValue);
}

const markers = statusAvatarSimulationMarkers(baseline);
const healthyBmiMidpoint = (18.5 + 24.9) / 2;
const expectedReferenceWeight = healthyBmiMidpoint * (178 / 100) ** 2;
const expectedReferenceBodyFat =
  1.2 * healthyBmiMidpoint + 0.23 * 35 - 10.8 - 5.4;
assert.ok(
  Math.abs(markers.weight.recommendedValue - expectedReferenceWeight) <= 0.26,
  "the adult weight tick must use the midpoint of the healthy-BMI reference range",
);
assert.ok(
  Math.abs(markers.body_fat.recommendedValue - expectedReferenceBodyFat) <= 0.26,
  "the body-fat tick must use the adult BMI/age/sex population equation",
);
assert.ok(
  Math.abs(
    markers.lean_body_mass.recommendedValue -
      expectedReferenceWeight * (1 - expectedReferenceBodyFat / 100),
  ) <= 0.51,
  "the lean-mass tick must remain consistent with the same reference profile",
);
assert.equal(markers.weight.currentValue, 82);
assert.equal(markers.body_fat.currentValue, 18);
assert.equal(markers.lean_body_mass.currentValue, 67);
assert.deepEqual(markers.bmi, {});

const adolescentMarkers = statusAvatarSimulationMarkers(
  statusAvatarSimulationBaseline({
    age: 17,
    bodyFatPercent: 18,
    heightCm: 178,
    leanBodyMassKg: 67,
    sex: "male",
    weightKg: 82,
  }),
);
for (const metric of ["weight", "body_fat", "lean_body_mass"])
  assert.ok(
    Number.isFinite(adolescentMarkers[metric].recommendedValue),
    "the explicitly adult R guide must remain visible when an adult profile is unavailable",
  );
const unspecifiedMarkers = statusAvatarSimulationMarkers(
  statusAvatarSimulationBaseline({ age: 35, heightCm: 178, sex: "unspecified", weightKg: 82 }),
);
assert.ok(Number.isFinite(unspecifiedMarkers.weight.recommendedValue));
assert.ok(Number.isFinite(unspecifiedMarkers.body_fat.recommendedValue));
assert.ok(Number.isFinite(unspecifiedMarkers.lean_body_mass.recommendedValue));
assert.equal(unspecifiedMarkers.body_fat.currentValue, undefined);
assert.equal(unspecifiedMarkers.lean_body_mass.currentValue, undefined);
const emptyProfileMarkers = statusAvatarSimulationMarkers(fallback);
for (const metric of ["weight", "body_fat", "lean_body_mass"])
  assert.ok(
    Number.isFinite(emptyProfileMarkers[metric].recommendedValue),
    "R must always be available even when no body measurement or profile detail was logged",
  );
assert.equal(emptyProfileMarkers.weight.currentValue, undefined);
assert.equal(emptyProfileMarkers.body_fat.currentValue, undefined);
assert.equal(emptyProfileMarkers.lean_body_mass.currentValue, undefined);

const heightSquared = (baseline.heightCm / 100) ** 2;
let linkedState = statusAvatarSimulationInitialState(baseline, "bmi");
linkedState = statusAvatarSimulationSetEnabled(linkedState, "weight", true);
assert.equal(linkedState.enabled.weight, true);
assert.equal(linkedState.enabled.bmi, true);
linkedState = statusAvatarSimulationSetValue(
  linkedState,
  "weight",
  120,
  baseline,
);
assert.ok(Math.abs(linkedState.values.bmi - 120 / heightSquared) <= 0.51);
assert.equal(statusAvatarSimulationPreview(linkedState, baseline).weightKg, 120);
linkedState = statusAvatarSimulationSetEnabled(linkedState, "bmi", true);
assert.equal(linkedState.enabled.bmi, true);
assert.equal(linkedState.enabled.weight, true);
linkedState = statusAvatarSimulationSetValue(linkedState, "bmi", 30, baseline);
const bmiPreview = statusAvatarSimulationPreview(linkedState, baseline);
assert.ok(Math.abs(bmiPreview.weightKg - 30 * heightSquared) <= 0.6);
assert.ok(
  Math.abs(linkedState.values.weight - 30 * heightSquared) <= 0.6,
  "dragging BMI must move the linked weight value",
);
linkedState = statusAvatarSimulationSetEnabled(linkedState, "bmi", false);
linkedState = statusAvatarSimulationSetValue(
  linkedState,
  "weight",
  95,
  baseline,
);
assert.equal(linkedState.enabled.weight, true);
assert.equal(linkedState.enabled.bmi, false);
assert.ok(
  Math.abs(linkedState.values.bmi - 95 / heightSquared) <= 0.51,
  "a disabled linked display must still stay synchronized for when it is turned back on",
);
assert.equal(statusAvatarSimulationPreview(linkedState, baseline).weightKg, 95);

let independentState = statusAvatarSimulationInitialState(baseline, "bmi");
independentState = statusAvatarSimulationSetEnabled(
  independentState,
  "body_fat",
  true,
);
independentState = statusAvatarSimulationSetEnabled(
  independentState,
  "lean_body_mass",
  true,
);
independentState = statusAvatarSimulationSetValue(
  independentState,
  "lean_body_mass",
  67,
  baseline,
);
const lowFatState = statusAvatarSimulationSetValue(
  independentState,
  "body_fat",
  10,
  baseline,
);
const highFatState = statusAvatarSimulationSetValue(
  independentState,
  "body_fat",
  40,
  baseline,
);
const lowFat = statusAvatarSimulationPreview(lowFatState, baseline);
const highFat = statusAvatarSimulationPreview(highFatState, baseline);
assert.equal(lowFat.leanBodyMassKg, highFat.leanBodyMassKg);
const lowFatAppearance = statusBodyAppearance(
  lowFat.heightCm,
  lowFat.weightKg,
  lowFat.muscleProgress,
  lowFat,
);
const highFatAppearance = statusBodyAppearance(
  highFat.heightCm,
  highFat.weightKg,
  highFat.muscleProgress,
  highFat,
);
assert.ok(highFatAppearance.adiposity > lowFatAppearance.adiposity);
assert.equal(
  highFatAppearance.muscleProgress,
  lowFatAppearance.muscleProgress,
  "changing body fat must not synthesize or alter lean-muscle appearance",
);

const lowLeanState = statusAvatarSimulationSetValue(
  independentState,
  "lean_body_mass",
  50,
  baseline,
);
const highLeanState = statusAvatarSimulationSetValue(
  independentState,
  "lean_body_mass",
  80,
  baseline,
);
const lowLean = statusAvatarSimulationPreview(lowLeanState, baseline);
const highLean = statusAvatarSimulationPreview(highLeanState, baseline);
assert.equal(lowLean.bodyFatPercent, highLean.bodyFatPercent);
const lowLeanAppearance = statusBodyAppearance(
  lowLean.heightCm,
  lowLean.weightKg,
  lowLean.muscleProgress,
  lowLean,
);
const highLeanAppearance = statusBodyAppearance(
  highLean.heightCm,
  highLean.weightKg,
  highLean.muscleProgress,
  highLean,
);
assert.equal(
  lowLeanAppearance.adiposity,
  highLeanAppearance.adiposity,
  "changing lean mass must not synthesize or alter fat appearance",
);
assert.ok(highLeanAppearance.muscleProgress > lowLeanAppearance.muscleProgress);

const conflictState = statusAvatarSimulationSetValue(
  statusAvatarSimulationSetValue(
    independentState,
    "body_fat",
    50,
    baseline,
  ),
  "lean_body_mass",
  80,
  baseline,
);
const conflict = statusAvatarSimulationPreview(conflictState, baseline);
assert.equal(conflict.consistency.status, "conflict");
assert.equal(conflict.bodyFatPercent, 50);
assert.equal(conflict.leanBodyMassKg, 80);
assert.ok(
  Math.abs(conflict.weightKg - baseline.weightKg) <= 0.51,
  "conflicts must be surfaced without silently changing another slider",
);

const bodyFatOff = statusAvatarSimulationPreview(
  statusAvatarSimulationSetEnabled(independentState, "body_fat", false),
  baseline,
);
assert.equal(bodyFatOff.bodyFatPercent, undefined);
const leanOff = statusAvatarSimulationPreview(
  statusAvatarSimulationSetEnabled(independentState, "lean_body_mass", false),
  baseline,
);
assert.equal(leanOff.leanBodyMassKg, undefined);
assert.equal(
  bodyFatOff.leanBodyMassKg,
  independentState.values.lean_body_mass,
  "turning body fat off must not disable or change lean mass",
);
assert.equal(
  leanOff.bodyFatPercent,
  independentState.values.body_fat,
  "turning lean mass off must not disable or change body fat",
);
const compositionOffState = statusAvatarSimulationSetEnabled(
  statusAvatarSimulationSetEnabled(independentState, "body_fat", false),
  "lean_body_mass",
  false,
);
const compositionOff = statusAvatarSimulationPreview(
  compositionOffState,
  baseline,
);
assert.equal(compositionOff.calculationSource, "bmi");
assert.equal(compositionOff.bodyFatPercent, undefined);
assert.equal(compositionOff.leanBodyMassKg, undefined);
const compositionOffAppearance = statusBodyAppearance(
  compositionOff.heightCm,
  compositionOff.weightKg,
  compositionOff.muscleProgress,
  compositionOff,
);
const bmiOnlyAppearance = statusBodyAppearance(
  compositionOff.heightCm,
  compositionOff.weightKg,
  compositionOff.muscleProgress,
  { sex: compositionOff.sex },
);
assert.deepEqual(
  compositionOffAppearance,
  bmiOnlyAppearance,
  "with body fat and lean mass off, the avatar must use the BMI/weight fallback only",
);
const bodyFatOffAppearance = statusBodyAppearance(
  bodyFatOff.heightCm,
  bodyFatOff.weightKg,
  bodyFatOff.muscleProgress,
  bodyFatOff,
);
assert.equal(
  bodyFatOffAppearance.adiposity,
  bmiOnlyAppearance.adiposity,
  "missing body fat must independently fall back to BMI adiposity",
);
const leanOffAppearance = statusBodyAppearance(
  leanOff.heightCm,
  leanOff.weightKg,
  leanOff.muscleProgress,
  leanOff,
);
assert.equal(
  leanOffAppearance.muscleProgress,
  baseline.muscleProgress,
  "missing lean mass must independently fall back to gym progress",
);

assert.match(
  componentSource,
  /export function StatusAvatarSimulator[\s\S]*<Modal[\s\S]*transparent[\s\S]*styles\.backdrop/,
  "the simulator must remain a dimmed modal overlay",
);
assert.match(
  componentSource,
  /label="Weight"[\s\S]*changeMetric\("weight"[\s\S]*toggleable=\{false\}[\s\S]*STATUS_AVATAR_SIMULATION_METRICS\.slice\(2\)\.map/,
  "Weight must remain the single total-size control while both composition sliders stay visible",
);
assert.doesNotMatch(
  componentSource,
  /label="BMI"|changeMetric\("bmi"/,
  "BMI must remain derived from weight and profile height rather than appear as a second slider",
);
assert.doesNotMatch(
  componentSource,
  /<ScrollView|styles\.scroll|metricCard/,
  "the three visible controls must fit one modal page without a scroll view or per-slider cards",
);
assert.match(
  componentSource,
  /useWindowDimensions\(\)[\s\S]*windowHeight < 620[\s\S]*styles\.metricList/,
  "the single-page simulator must scale its avatar for compact phone heights",
);
assert.match(
  componentSource,
  /windowHeight < 620 \? 0\.64 : windowHeight < 720 \? 0\.72 : 0\.8/,
  "the simulator avatar must use the available whitespace at compact, regular, and tall phone heights",
);
assert.match(
  componentSource,
  /currentValue=\{marker\.currentValue\}[\s\S]*recommendedValue=\{marker\.recommendedValue\}/,
  "every visible slider must receive fixed current and recommended reference markers",
);
assert.match(
  componentSource,
  /styles\.sliderMarkerCodeCurrent[\s\S]*>\s*C\s*<\/Text>[\s\S]*styles\.sliderMarkerCodeRecommended[\s\S]*>\s*R\s*<\/Text>/,
  "compact C and R ticks must share the existing slider track footprint",
);
assert.match(
  componentSource,
  /markersOverlap[\s\S]*translateX: markersOverlap \? -2 : 0[\s\S]*translateX: markersOverlap \? 2 : 0/,
  "overlapping current and reference ticks must remain visually distinguishable",
);
assert.match(
  componentSource,
  /accessibilityHint=\{markerHint \|\| undefined\}/,
  "screen readers must identify the current and adult-reference marker values",
);
assert.match(
  componentSource,
  /configurationRef\.current\.disabled[\s\S]*markerAtPointRef\.current[\s\S]*onPanResponderRelease[\s\S]*onMarkerPress/,
  "a disabled no-data slider must still claim an exact R-marker tap without enabling value adjustment",
);
assert.match(
  componentSource,
  /Math\.max\(Math\.abs\(gestureState\.dx\), Math\.abs\(gestureState\.dy\)\) > 6/,
  "marker taps must cancel into the existing drag stream once the gesture moves",
);
assert.doesNotMatch(
  componentSource,
  /sliderMarkerAnchor[\s\S]{0,160}<Pressable/,
  "marker info must not add a child Pressable that steals slider pointer capture",
);
assert.match(
  componentSource,
  /markerHint \? `\$\{accessibilityLabel\}\. \$\{markerHint\}` : accessibilityLabel/,
  "web slider names must retain marker meaning even where accessibility hints are not exposed",
);
assert.match(
  simulation.source,
  /ADULT_HEALTHY_BMI_MIDPOINT[\s\S]*WHO adult healthy-BMI reference[\s\S]*Deurenberg/,
  "the pure-domain marker method must document its adult reference evidence",
);
assert.doesNotMatch(
  componentSource,
  /selectorMenuOpen|Choose what to change|selectorOption/,
  "the old single-metric dropdown must not hide the other controls",
);
assert.match(
  componentSource,
  /responderRef = useRef[\s\S]*onStartShouldSetPanResponderCapture[\s\S]*dragStartXRef\.current \+ gestureState\.dx/,
  "direct horizontal dragging must retain one responder and one gesture coordinate system",
);
assert.match(
  componentSource,
  /pointerEvents="none"[\s\S]*styles\.sliderTrack/,
  "slider children must not change the origin of direct press coordinates",
);
assert.match(
  simulation.source,
  /enabled: \{ \.\.\.state\.enabled, \[metric\]: enabled \}/,
  "availability toggles must never switch another metric off",
);
assert.match(
  componentSource,
  /accessibilityActions = \[[\s\S]*disabled[\s\S]*increment[\s\S]*show-recommended-marker[\s\S]*accessibilityRole=\{disabled \? "button" : "adjustable"\}/,
  "an off track must expose marker info without advertising unavailable adjustment actions",
);
assert.match(
  componentSource,
  /Weight uses your profile height for total size[\s\S]*allowPartialComposition/,
  "the preview must retain the profile-height linkage in its compact info disclosure",
);
assert.doesNotMatch(
  componentSource,
  /Profile height|These values do not describe one possible body/,
  "the compact simulator must not show a numeric height row or composition-conflict warning",
);
assert.match(
  componentSource,
  /information-circle-outline[\s\S]*Estimate only\./,
  "a compact info control must disclose that the avatar is an estimate",
);
assert.match(
  componentSource,
  /<BodyProgressAvatar[\s\S]*showProgressLabel=\{false\}/,
  "the simulator preview must not overlay the tracked-goal percentage",
);
assert.match(
  bodyComponentSource,
  /allowPartialComposition[\s\S]*statusBodyCompositionForSource\([\s\S]*allowPartialComposition/,
  "the shared renderer must opt into partial composition only when requested",
);
assert.doesNotMatch(
  componentSource,
  /useApp\(|updateSettings|AsyncStorage|supabase|insert\(|upsert\(/,
  "the simulator component must have no persistence or health-log write path",
);
assert.doesNotMatch(
  simulation.source,
  /AsyncStorage|updateSettings|supabase|fetch\(|insert\(|upsert\(/,
  "the pure simulation domain must remain write-free",
);
assert.match(
  statusPageSource,
  /<StatusAvatarSimulator[\s\S]{0,500}calculationSource=\{avatarCalculationSource\}[\s\S]{0,900}visible=\{avatarSimulatorOpen\}/,
  "Status must initialize the simulator from the current avatar source",
);
assert.match(
  statusPageSource,
  /if \(avatarLongPressRef\.current\) return;[\s\S]{0,180}setAvatarSimulatorOpen\(true\)/,
  "the normal avatar tap must open the simulator",
);
assert.match(
  statusPageSource,
  /onPressIn=[\s\S]{0,120}avatarLongPressRef\.current = false/,
  "every new gesture must clear the previous long-hold suppression flag",
);

console.log("Status avatar simulator validation passed.");
