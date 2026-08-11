import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import ts from "typescript";

const root = path.resolve(import.meta.dirname, "..");
const sourcePath = path.join(root, "src", "domain", "progressGrid.ts");
const source = fs.readFileSync(sourcePath, "utf8");
const output = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022,
  },
}).outputText;
const exports = {};
const module = { exports };
vm.runInNewContext(`(function (module, exports) { ${output}\n})(module, exports);`, {
  module,
  exports,
});

const { progressGridNavigationSettings, yearHeatmapDateAtPoint } =
  module.exports;

for (const range of ["week", "month", "year"]) {
  assert.deepEqual(
    { ...progressGridNavigationSettings("2026-08-03", range) },
    {
      progressViewMode: "goal_maps",
      progressHistoryRange: range,
      progressHistoryAnchor: "2026-08-03",
    },
  );
}

const cells = [
  null,
  null,
  "2026-01-01",
  "2026-01-02",
  "2026-01-03",
  "2026-01-04",
  "2026-01-05",
  "2026-01-06",
];
assert.equal(yearHeatmapDateAtPoint(cells, 2, 14, 5, 5, 1), "2026-01-01");
assert.equal(yearHeatmapDateAtPoint(cells, 7, 2, 5, 5, 1), "2026-01-06");
assert.equal(yearHeatmapDateAtPoint(cells, 2, 2, 5, 5, 1), undefined);
assert.equal(yearHeatmapDateAtPoint(cells, -1, 2, 5, 5, 1), undefined);
assert.equal(yearHeatmapDateAtPoint(cells, 2, 50, 5, 5, 1), undefined);

const todaySource = fs.readFileSync(
  path.join(root, "app", "(tabs)", "index.tsx"),
  "utf8",
);
assert.match(todaySource, /onSelect=\{onHistoryDateSelect\}/);
assert.match(todaySource, /router\.navigate\("\/insights" as never\)/);
assert.doesNotMatch(todaySource, /label="Open recap"/);
assert.match(
  todaySource,
  /calendarPeriodRange\(\s*today,\s*todayHistoryRange,/,
  "Today history must stay anchored to today before a square is selected",
);

const progressSource = fs.readFileSync(
  path.join(root, "app", "(tabs)", "insights.tsx"),
  "utf8",
);
assert.match(progressSource, /selectedDate=\{anchor\}/);
assert.match(progressSource, /onSelect=\{editing \? undefined : onSelectDate\}/);
assert.match(
  progressSource,
  /onPress=\{\(\) => onOpenDay\(anchor\)\}/,
  "The tracked-goals card itself must keep its existing day-detail route",
);
assert.ok(
  (progressSource.match(/accessibilityLabel=\{t\("Open recap"\)\}/g) ?? [])
    .length >= 2,
  "Recap must remain available in both Progress layouts",
);

const heatmapSource = fs.readFileSync(
  path.join(root, "src", "components", "GoalHeatmap.tsx"),
  "utf8",
);
assert.match(
  heatmapSource,
  /function YearHeatmapGrid[\s\S]*?const onPress[\s\S]*?event\.stopPropagation\(\);[\s\S]*?yearHeatmapDateAtPoint/,
  "A year-cell tap must not reach the outer tracker-card navigation",
);
assert.match(
  heatmapSource,
  /pointerEvents="none"/,
  "Year cells must leave hit testing to the delegated grid press target",
);

console.log("Progress grid navigation validation passed (week, month, year).");
