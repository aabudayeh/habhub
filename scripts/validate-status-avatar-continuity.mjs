import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
function loadDomain(name) {
  const source = fs.readFileSync(path.join(root, "src/domain", name + ".ts"), "utf8");
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } });
  const temporary = path.join(os.tmpdir(), `habhub-${name}-${process.pid}.cjs`);
  fs.writeFileSync(temporary, compiled.outputText);
  try { return require(temporary); } finally { fs.unlinkSync(temporary); }
}
const { statusBodyAppearance, statusAvatarGeometry } = loadDomain("statusAvatar");
const { statusAvatarSilhouettePath } = loadDomain("statusAvatarOutline");
function model(height, weight, sex, composition = {}, training = 0.2) {
  const appearance = statusBodyAppearance(height, weight, training, { ...composition, sex });
  const geometry = statusAvatarGeometry(sex, appearance.bodyMass, appearance.muscleProgress, appearance.adiposity);
  return { appearance, geometry, outline: statusAvatarSilhouettePath(geometry) };
}
for (const sex of ["male", "female", "unspecified"]) {
  for (const height of [135, 170, 215]) {
    let previous;
    for (let weight = 35; weight <= 250; weight += 1) {
      const current = model(height, weight, sex);
      assert.ok(!current.outline.includes("NaN") && !current.outline.includes("Infinity"));
      if (previous) {
        assert.notEqual(current.outline, previous.outline, `${sex}/${height}: a 1 kg change at ${weight} must not round to the same body`);
        assert.ok(current.geometry.body.waistHalf > previous.geometry.body.waistHalf);
        assert.ok(current.geometry.body.waistHalf - previous.geometry.body.waistHalf < 2.5, "weight morph must not jump between poses");
      }
      previous = current;
    }
  }
  for (const input of ["bodyFatPercent", "leanBodyMassKg"]) {
    let previous;
    const end = input === "bodyFatPercent" ? 75 : 120;
    const start = input === "bodyFatPercent" ? 1 : 25;
    for (let value = start; value <= end; value += 1) {
      const current = model(170, 200, sex, { [input]: value });
      if (previous) assert.notEqual(current.outline, previous.outline, `${sex}: ${input} must remain sensitive at ${value}`);
      previous = current;
    }
  }
  const extreme = model(170, 250, sex, { bodyFatPercent: 70 }, 1).geometry.body;
  assert.ok(extreme.upperArmOuterHalf - extreme.upperArmInnerHalf > 24, "full bodies need proportionate upper arms");
  assert.ok(extreme.elbowInnerHalf >= extreme.waistHalf + 3, "forearms must stay outside the waist");
  assert.ok(extreme.wristInnerHalf >= extreme.hipHalf + 3, "hands must not intersect the hips");
  for (const value of Object.values(extreme)) assert.ok(Number.isFinite(value) && value > 0 && value < 94);
}
const conflict = model(178, 82, "male", { bodyFatPercent: 50, leanBodyMassKg: 80 });
const reconciled = model(178, 82, "male", { bodyFatPercent: 50, leanBodyMassKg: 41 });
assert.equal(conflict.appearance.compositionAdjusted, true);
assert.equal(reconciled.appearance.compositionAdjusted, false);
assert.equal(conflict.outline, reconciled.outline, "impossible composition must use the bounded non-fat compartment");

if (process.argv.includes("--contact-sheet")) {
  const cells = [];
  for (const [row, sex] of ["male", "female"].entries()) {
    for (const [column, weight] of [50, 80, 120, 180, 250].entries()) {
      const { outline } = model(170, weight, sex);
      cells.push(`<g transform="translate(${column * 280 + 40},${row * 540 + 78})"><text x="100" y="-30" text-anchor="middle" fill="#DDE8F2" font-family="Arial" font-size="18">${sex} · ${weight} kg</text><path d="${outline}" fill="url(#body)" stroke="#A4B8C9" stroke-width="0.7"/></g>`);
    }
  }
  const output = path.join(root, "store/exports/qa/avatar-continuity.svg");
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, `<svg xmlns="http://www.w3.org/2000/svg" width="1400" height="1080" viewBox="0 0 1400 1080"><defs><linearGradient id="body"><stop stop-color="#3A4D62"/><stop offset="27%" stop-color="#8295A9"/><stop offset="46%" stop-color="#CAD5E0"/><stop offset="62%" stop-color="#ADBDCC"/><stop offset="100%" stop-color="#40546A"/></linearGradient></defs><rect width="1400" height="1080" fill="#071426"/>${cells.join("")}</svg>`);
  console.log(`Visual fixture: ${output}`);
}
console.log("Continuous avatar: 1 kg / 1% sensitivity, extreme limb clearance and composition consistency validated.");
