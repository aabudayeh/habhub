import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { metricVisualization } from "../src/domain/visualization.ts";

const base = {
  id: "ordinary",
  dataType: "number",
};

assert.equal(
  metricVisualization(base).detailRange,
  "both",
  "ordinary numeric trackers should default to combined line and bars",
);
assert.equal(
  metricVisualization({ ...base, dataType: "calculated" }).detailRange,
  "both",
  "ordinary calculated trackers should default to combined line and bars",
);
assert.equal(
  metricVisualization({ ...base, id: "food" }).detailRange,
  "both",
  "Food range charts should use the combined line and bars view",
);

for (const metric of [
  { ...base, id: "intermittent_fasting" },
  { ...base, id: "fast", fastingSettings: {} },
  { ...base, id: "weekly_deficit_balance", dataType: "calculated" },
  { ...base, id: "weekly_deficit", dataType: "calculated" },
  { ...base, id: "boolean", dataType: "boolean" },
  { ...base, id: "text", dataType: "text" },
  { ...base, id: "photo", dataType: "photo" },
]) {
  assert.equal(
    metricVisualization(metric).detailRange,
    "bar",
    `${metric.id} should retain its existing special/non-numeric range default`,
  );
}

assert.equal(
  metricVisualization({ ...base, id: "weight" }).detailRange,
  "line",
  "weight should retain its journey line",
);
assert.equal(
  metricVisualization({ ...base, goalProgressMode: "journey" }).detailRange,
  "line",
  "custom journeys should retain their line",
);
assert.equal(
  metricVisualization({
    ...base,
    healthMapping: { dataType: "blood_pressure", field: "systolic" },
  }).detailRange,
  "line",
  "blood pressure should retain its purpose-built line",
);

for (const style of ["bar", "line", "both", "completion"]) {
  assert.equal(
    metricVisualization({
      ...base,
      visualization: { detailRange: style },
    }).detailRange,
    style,
    `explicit ${style} configuration must remain authoritative`,
  );
}
assert.equal(
  metricVisualization({
    ...base,
    visualization: { detailRange: "auto" },
  }).detailRange,
  "both",
  "Automatic should resolve to the new compatible default",
);
assert.equal(
  metricVisualization({
    ...base,
    visualization: { progressOverview: "both" },
  }).progressOverview,
  "bar",
  "Progress overview must retain its established per-day bars",
);

const editor = await readFile(new URL("../app/metric-editor.tsx", import.meta.url), "utf8");
assert.match(
  editor,
  /detailRange:\s*"auto"\s+as const/,
  "new trackers must defer their range default until their final type is known",
);

const detail = await readFile(new URL("../app/metric-detail.tsx", import.meta.url), "utf8");
assert.match(
  detail,
  /showBars=\{chartStyle === "both"\}/,
  "the combined style must render both the line and its bars",
);

console.log("Metric visualization defaults validation passed.");
