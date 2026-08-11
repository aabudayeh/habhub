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
const statusPageSource = fs.readFileSync(
  path.join(root, "app", "(tabs)", "status.tsx"),
  "utf8",
);

const {
  STATUS_AVATAR_SIMULATION_METRICS,
  statusAvatarSimulationBaseline,
  statusAvatarSimulationPreview,
  statusAvatarSimulationRange,
} = simulation.module;
const { statusBodyAppearance } = avatar.module;

assert.deepEqual(
  STATUS_AVATAR_SIMULATION_METRICS.map((item) => item.id),
  ["weight", "bmi", "body_fat", "lean_body_mass"],
  "the compact selector must expose exactly the four requested simulations",
);

const emptyInput = Object.freeze({});
const fallback = statusAvatarSimulationBaseline(emptyInput);
assert.equal(fallback.sex, "unspecified");
assert.ok(Number.isFinite(fallback.heightCm) && fallback.heightCm > 0);
assert.ok(Number.isFinite(fallback.weightKg) && fallback.weightKg > 0);
assert.ok(
  Number.isFinite(fallback.bodyFatPercent) && fallback.bodyFatPercent > 0,
);
assert.ok(
  Number.isFinite(fallback.leanBodyMassKg) && fallback.leanBodyMassKg > 0,
  "the simulator must not require logged composition data",
);

const baseline = statusAvatarSimulationBaseline({
  heightCm: 178,
  muscleProgress: 0.35,
  sex: "male",
  weightKg: 82,
});
for (const metric of STATUS_AVATAR_SIMULATION_METRICS.map((item) => item.id)) {
  const range = statusAvatarSimulationRange(metric, baseline);
  assert.ok(Number.isFinite(range.minimumValue));
  assert.ok(Number.isFinite(range.maximumValue));
  assert.ok(range.minimumValue < range.maximumValue);
  assert.ok(range.initialValue >= range.minimumValue);
  assert.ok(range.initialValue <= range.maximumValue);
  const preview = statusAvatarSimulationPreview(
    metric,
    range.initialValue,
    baseline,
  );
  assert.ok(Number.isFinite(preview.weightKg));
  assert.ok(Number.isFinite(preview.value));
}

for (const metric of ["weight", "bmi"]) {
  const range = statusAvatarSimulationRange(metric, baseline);
  const low = statusAvatarSimulationPreview(metric, range.minimumValue, baseline);
  const high = statusAvatarSimulationPreview(metric, range.maximumValue, baseline);
  assert.equal(low.calculationSource, "bmi");
  assert.equal(high.calculationSource, "bmi");
  assert.equal(low.bodyFatPercent, undefined);
  assert.equal(low.leanBodyMassKg, undefined);
  assert.ok(high.weightKg > low.weightKg);
  assert.ok(
    statusBodyAppearance(high.heightCm, high.weightKg, high.muscleProgress)
      .adiposity >
      statusBodyAppearance(low.heightCm, low.weightKg, low.muscleProgress)
        .adiposity,
    `${metric} must visibly drive the atlas adiposity axis`,
  );
}

const bodyFatRange = statusAvatarSimulationRange("body_fat", baseline);
const lowFat = statusAvatarSimulationPreview(
  "body_fat",
  bodyFatRange.minimumValue,
  baseline,
);
const highFat = statusAvatarSimulationPreview(
  "body_fat",
  bodyFatRange.maximumValue,
  baseline,
);
assert.equal(lowFat.calculationSource, "body_composition");
assert.equal(highFat.calculationSource, "body_composition");
assert.equal(lowFat.leanBodyMassKg, highFat.leanBodyMassKg);
assert.ok(highFat.bodyFatPercent > lowFat.bodyFatPercent);
assert.ok(
  statusBodyAppearance(
    highFat.heightCm,
    highFat.weightKg,
    highFat.muscleProgress,
    highFat,
  ).adiposity >
    statusBodyAppearance(
      lowFat.heightCm,
      lowFat.weightKg,
      lowFat.muscleProgress,
      lowFat,
    ).adiposity,
  "body-fat simulation must visibly traverse the atlas fatness states",
);

const leanRange = statusAvatarSimulationRange("lean_body_mass", baseline);
const lowLean = statusAvatarSimulationPreview(
  "lean_body_mass",
  leanRange.minimumValue,
  baseline,
);
const highLean = statusAvatarSimulationPreview(
  "lean_body_mass",
  leanRange.maximumValue,
  baseline,
);
assert.equal(lowLean.calculationSource, "body_composition");
assert.equal(highLean.calculationSource, "body_composition");
assert.ok(highLean.leanBodyMassKg > lowLean.leanBodyMassKg);
assert.ok(
  statusBodyAppearance(
    highLean.heightCm,
    highLean.weightKg,
    highLean.muscleProgress,
    highLean,
  ).muscleProgress >
    statusBodyAppearance(
      lowLean.heightCm,
      lowLean.weightKg,
      lowLean.muscleProgress,
      lowLean,
    ).muscleProgress,
  "lean-mass simulation must visibly traverse the atlas muscle states",
);

assert.match(
  componentSource,
  /export function StatusAvatarSimulator[\s\S]*<Modal[\s\S]*transparent[\s\S]*styles\.backdrop/,
  "the simulator must be a dimmed modal overlay",
);
assert.match(
  componentSource,
  /selectorMenuOpen[\s\S]*STATUS_AVATAR_SIMULATION_METRICS\.map/,
  "one compact selector must reveal the four-option menu only on demand",
);
assert.match(
  componentSource,
  /PanResponder\.create[\s\S]*onKeyDown[\s\S]*accessibilityActions=[\s\S]*accessibilityRole="adjustable"[\s\S]*responder\.panHandlers/,
  "the custom slider must support assistive increment/decrement and smooth dragging",
);
assert.match(
  componentSource,
  /Preview a change without saving it\./,
  "the visual-only boundary must be explicit in the UI",
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
  /if \(avatarLongPressRef\.current\) return;[\s\S]{0,180}setAvatarSimulatorOpen\(true\)/,
  "the normal avatar tap must open the simulator",
);
assert.match(
  statusPageSource,
  /onPressIn=[\s\S]{0,120}avatarLongPressRef\.current = false/,
  "every new gesture must clear the previous long-hold suppression flag",
);
assert.match(
  statusPageSource,
  /<StatusAvatarSimulator[\s\S]{0,900}visible=\{avatarSimulatorOpen\}/,
  "Status must mount the simulator with the current visual inputs",
);
assert.match(
  statusPageSource,
  /delayLongPress=\{420\}[\s\S]{0,350}avatarLongPressRef\.current = true[\s\S]{0,350}if \(avatarLongPressRef\.current\) return/,
  "a long hold must retain the source editor and suppress the release tap",
);

console.log("Status avatar simulator validation passed.");
