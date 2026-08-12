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
  statusAvatarSimulationPreview,
  statusAvatarSimulationRange,
  statusAvatarSimulationSetEnabled,
  statusAvatarSimulationSetValue,
} = simulation.module;
const { statusBodyAppearance } = avatar.module;

assert.deepEqual(
  STATUS_AVATAR_SIMULATION_METRICS.map((item) => item.id),
  ["weight", "bmi", "body_fat", "lean_body_mass"],
  "the simulator must expose exactly the four requested controls",
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
  "unlogged composition must begin off while linked weight and BMI stay available",
);

const baseline = statusAvatarSimulationBaseline({
  bodyFatPercent: 18,
  heightCm: 178,
  leanBodyMassKg: 67,
  muscleProgress: 0.35,
  sex: "male",
  weightKg: 82,
});
assert.equal(baseline.bodyFatWasLogged, true);
assert.equal(baseline.leanMassWasLogged, true);
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
  /styles\.linkedSizeGroup[\s\S]*label="Weight"[\s\S]*changeMetric\("weight"[\s\S]*label="BMI"[\s\S]*changeMetric\("bmi"[\s\S]*secondary[\s\S]*STATUS_AVATAR_SIMULATION_METRICS\.slice\(2\)\.map/,
  "Weight and secondary BMI must share one group while both composition sliders remain visible",
);
assert.match(
  componentSource,
  /metricRowSecondary[\s\S]*metricLabelSecondary[\s\S]*sliderTrackSecondary[\s\S]*sliderThumbSecondary/,
  "BMI must use a compact secondary row and visual slider treatment",
);
assert.doesNotMatch(
  componentSource,
  /<ScrollView|styles\.scroll|metricCard/,
  "the four controls must fit one modal page without a scroll view or per-slider cards",
);
assert.match(
  componentSource,
  /useWindowDimensions\(\)[\s\S]*windowHeight < 620[\s\S]*styles\.metricList/,
  "the single-page simulator must scale its avatar for compact phone heights",
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
  /accessibilityRole="adjustable"[\s\S]*accessibilityState=\{\{ disabled \}\}/,
  "each slider must expose its enabled state and accessible adjustment actions",
);
assert.match(
  componentSource,
  /Weight and BMI are linked through this height[\s\S]*allowPartialComposition/,
  "the preview must use independent signals and retain the profile-height linkage in its info disclosure",
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
