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

const { progressGridNavigationSettings } = module.exports;

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
assert.doesNotMatch(
  progressSource,
  /selectedDate=\{anchor\}/,
  "Progress squares should not gain a selection-only outline",
);
assert.ok(
  (progressSource.match(/onSelect=\{editing \? undefined : onOpenDay\}/g) ?? [])
    .length >= 2,
  "Tracked and individual goal-map squares must open daily detail directly",
);
assert.doesNotMatch(
  progressSource,
  /selectGridDate|onSelectDate/,
  "Progress must not retain the old selection-only square behavior",
);
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
  /function YearHeatmapGrid[\s\S]*?<View[\s\S]*?\{children\}[\s\S]*?<\/View>/,
  "the year grid wrapper must leave exact day interaction to its cells",
);
assert.match(
  heatmapSource,
  /range === "year"[\s\S]{0,900}width: cellWidth[\s\S]{0,180}height: cellHeight[\s\S]{0,1800}<Pressable[\s\S]{0,900}onPress=\{\(event\) => \{[\s\S]{0,180}event\.stopPropagation\(\);[\s\S]{0,120}onSelect\?\.\(date\)/,
  "every exact-size year square must be its own day action without expanding its geometry",
);
assert.match(
  heatmapSource,
  /pointerEvents="none"/,
  "Year cells must leave hit testing to the delegated grid press target",
);

console.log("Progress grid navigation validation passed (week, month, year).");
