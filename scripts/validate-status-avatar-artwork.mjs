import assert from "node:assert/strict";
import crypto from "node:crypto";
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
const { statusBodyAppearance } = loadDomain("statusAvatar");
const { statusAvatarAtlasBlend } = loadDomain("statusAvatarAtlas");
function model(height, weight, sex, composition = {}, training = 0.2) {
  const appearance = statusBodyAppearance(height, weight, training, { ...composition, sex });
  return { appearance, blend: statusAvatarAtlasBlend(sex, appearance.adiposity, appearance.muscleProgress) };
}
for (const sex of ["male", "female", "unspecified"]) {
  for (const height of [135, 170, 215]) {
    let previous;
    const selections = new Set();
    for (let weight = 35; weight <= 250; weight += 1) {
      const current = model(height, weight, sex);
      const sample = current.blend.samples[0];
      assert.equal(current.blend.samples.length, 1, "One established contour, never a ghost cross-fade");
      assert.ok(sample.column >= 0 && sample.column < 20 && sample.row >= 0 && sample.row < 10);
      selections.add(`${sample.row}:${sample.column}`);
      if (previous) assert.ok(current.appearance.bodyMass > previous.appearance.bodyMass,
        "Keep one-unit input sensitivity in calculations without inventing anatomical precision between artwork states");
      previous = current;
    }
    assert.ok(selections.size >= 8, "Weight customization must still select a meaningful range of existing artwork");
  }
  for (const input of ["bodyFatPercent", "leanBodyMassKg"]) {
    const selections = new Set();
    for (let value = input === "bodyFatPercent" ? 1 : 25; value <= (input === "bodyFatPercent" ? 75 : 120); value++) {
      const { blend } = model(170, 200, sex, { [input]: value });
      const sample = blend.samples[0];
      selections.add(`${sample.row}:${sample.column}`);
    }
    assert.ok(selections.size >= 5, `${input} must customize the preserved art`);
  }
}
const conflict = model(178, 82, "male", { bodyFatPercent: 50, leanBodyMassKg: 80 });
const reconciled = model(178, 82, "male", { bodyFatPercent: 50, leanBodyMassKg: 41 });
assert.equal(conflict.appearance.compositionAdjusted, true);
assert.equal(reconciled.appearance.compositionAdjusted, false);
assert.deepEqual(conflict.blend, reconciled.blend, "Incompatible composition uses bounded rendering inputs, not altered logged values");

// User-requested artwork from b4a19cf, verified byte-for-byte before recording
// this fingerprint. Changing the art requires an explicit visual decision;
// source/domain tests must not silently bless another reconstructed outline.
const artworkHash = crypto.createHash("sha256");
let count = 0;
for (const sex of ["female", "male"])
  for (const file of fs.readdirSync(path.join(root, "assets/images/status-avatar-v2", sex)).sort()) {
    assert.match(file, /^m\d{2}-a\d{2}\.png$/);
    artworkHash.update(`${sex}/${file}\n`);
    artworkHash.update(fs.readFileSync(path.join(root, "assets/images/status-avatar-v2", sex, file)));
    count++;
  }
assert.equal(count, 400);
assert.equal(artworkHash.digest("hex"), "13d8b2d884cad876559b00eb9887459e0c29c4b9135a74e05ca95db581f0f98e",
  "Preserve the user's previous human artwork; do not introduce a replacement shape without visual review");
const component = fs.readFileSync(path.join(root, "src/components/BodyProgressAvatar.tsx"), "utf8");
assert.match(component, /STATUS_AVATAR_SPRITES[\s\S]*resizeMethod="scale"[\s\S]*resizeMode="contain"/);
assert.match(component, /testID="status-avatar-artwork"/);
assert.doesNotMatch(component, /ContinuousBodyFigure|statusAvatarGeometry|react-native-svg|scaleX|scaleY/);
assert.match(component, /opacityScale=\{bodyModel \? 0\.38 : 1\}/, "Detailed progress must preserve the underlying artwork");
console.log("Avatar artwork passed: 400 unchanged human shapes, one-sprite rendering, preserved profile customization, full-resolution decode and restrained detail tint. Artwork states are illustrative, not per-unit anatomical predictions.");
