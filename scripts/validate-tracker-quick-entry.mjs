import assert from "node:assert/strict";
import fs from "node:fs";

import {
  adjustQuickEntryValue,
  isQuickEntryAligned,
  normalizedQuickEntry,
  quickEntryLabel,
  quickEntryStepCount,
} from "../src/domain/quickEntry.ts";

globalThis.require = (source) => source;
const { DEFAULT_METRICS } = await import("../src/data/seed.ts");

const water = DEFAULT_METRICS.find((metric) => metric.id === "water");
assert.ok(water, "the default Water tracker must exist");
const configuration = normalizedQuickEntry(water);
assert.ok(configuration, "Water must declare its reusable quick-entry style");
assert.equal(configuration.step, 0.25);
assert.equal(adjustQuickEntryValue(0.25, configuration, 1), 0.5);
assert.equal(adjustQuickEntryValue(0.25, configuration, -1), 0.25);
assert.equal(adjustQuickEntryValue(10, configuration, 1), 10);
assert.equal(isQuickEntryAligned(0.75, configuration), true);
assert.equal(isQuickEntryAligned(0.8, configuration), false);
assert.equal(quickEntryStepCount(0.75, configuration.step), 3);
assert.equal(quickEntryLabel(1, configuration), "cup");
assert.equal(quickEntryLabel(2, configuration), "cups");
assert.equal(
  adjustQuickEntryValue(0.0000001, { kind: "stepper", step: 0.0000001 }, 1),
  0.0000002,
  "scientific-notation steps must keep their precision",
);

const malformedBounds = normalizedQuickEntry({
  dataType: "number",
  quickEntry: {
    kind: "stepper",
    step: 0.3,
    minimum: 0.2,
    maximum: 1,
  },
});
assert.equal(
  malformedBounds?.minimum,
  0.3,
  "legacy minimums that are not aligned to the step must fall back safely",
);
assert.equal(
  malformedBounds?.maximum,
  undefined,
  "legacy maximums that are not aligned to the step must not create an unsavable clamp value",
);

const studyCopy = {
  ...water,
  id: "study_blocks",
  name: "Study",
  unit: "hr",
  healthMapping: undefined,
  gymMapping: undefined,
};
assert.deepEqual(
  normalizedQuickEntry(studyCopy),
  configuration,
  "a renamed tracker copy must retain the same ID-independent interaction",
);

const editor = fs.readFileSync("app/metric-editor.tsx", "utf8");
const log = fs.readFileSync("app/(tabs)/log.tsx", "utf8");
assert.match(editor, /Duplicate tracker style/);
assert.match(editor, /Plus\/minus quick entry/);
assert.match(editor, /quickEntry:/);
assert.match(
  editor,
  /healthMapping:\s*isDuplicate \? undefined : item\.healthMapping,[\s\S]{0,100}linkedMetricId:\s*isDuplicate \? undefined : item\.linkedMetricId/,
  "a copied compound tracker must not write into the source tracker's linked metrics",
);
assert.match(
  editor,
  /isQuickEntryAligned\(quickMaximum, \{[\s\S]{0,120}step: quickStep,[\s\S]{0,80}minimum: quickMinimum/,
  "the editor must reject a maximum that is not aligned to the configured step",
);
assert.match(log, /normalizedQuickEntry\(selected\)/);
assert.match(
  log,
  /\[params\.metric, params\.value, quickEntryInitialValue, selectedId\]/,
  "an equivalent metric-array refresh must not overwrite a typed stepper draft",
);
assert.match(
  log,
  /onChange=\{\(ids\) => \{[\s\S]{0,420}clearEntry\(\);[\s\S]{0,80}setValue\(""\);[\s\S]{0,80}setSelectedId\(next\)/,
  "switching trackers must not carry a stepper's visible default into a normal log",
);
assert.doesNotMatch(
  log,
  /selected\.id === ["']water["'].*waterStepper/s,
  "the stepper must be driven by configuration rather than Water's ID",
);

console.log("Tracker duplication and reusable quick-entry validation passed.");
