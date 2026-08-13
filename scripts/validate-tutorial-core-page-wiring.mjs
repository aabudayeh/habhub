import fs from "node:fs";
import Module, { createRequire } from "node:module";
import path from "node:path";
import process from "node:process";
import ts from "typescript";

const root = process.cwd();
const read = (file) =>
  fs.readFileSync(path.join(root, ...file.split("/")), "utf8");
const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};

const require = createRequire(import.meta.url);
const originalResolveFilename = Module._resolveFilename;
Module._resolveFilename = function resolveTutorialModule(
  request,
  parent,
  isMain,
  options,
) {
  const resolvedRequest = request.startsWith("@/")
    ? path.join(root, request.slice(2))
    : request;
  return originalResolveFilename.call(
    this,
    resolvedRequest,
    parent,
    isMain,
    options,
  );
};
const compileTypeScript = (module, filename) => {
  const source = fs.readFileSync(filename, "utf8");
  const output = ts.transpileModule(source, {
    fileName: filename,
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.CommonJS,
      moduleResolution: ts.ModuleResolutionKind.Node10,
      esModuleInterop: true,
      jsx: ts.JsxEmit.ReactJSX,
    },
  }).outputText;
  module._compile(output, filename);
};
require.extensions[".ts"] = compileTypeScript;
require.extensions[".tsx"] = compileTypeScript;

const { BASIC_TUTORIAL_GUIDE, FULL_TUTORIAL_GUIDE } = require(
  path.join(root, "src/tutorial/guides.ts"),
);

const guides = read("src/tutorial/guides.ts");
const basicGuide = read("src/tutorial/basicGuide.ts");
const curriculum = `${guides}\n${basicGuide}`;
const targetFiles = {
  "today-hero": ["app/(tabs)/index.tsx"],
  "today-tracker-list": ["app/(tabs)/index.tsx"],
  "today-todo-list": ["app/(tabs)/index.tsx"],
  "today-edit": ["app/(tabs)/index.tsx"],
  "today-goal-flag": ["app/(tabs)/index.tsx"],
  "today-tracked-goals": ["app/(tabs)/index.tsx"],
  "today-reorder": ["app/(tabs)/index.tsx"],
  "today-edit-menu": ["app/(tabs)/index.tsx"],
  "today-filter": ["app/(tabs)/index.tsx"],
  "today-view-filter-list": ["app/view-filters.tsx"],
  "today-all-complete": ["app/(tabs)/index.tsx"],
  "status-avatar": ["app/(tabs)/status.tsx"],
  "status-avatar-source": ["app/(tabs)/status.tsx"],
  "schedule-grid": ["app/(tabs)/calendar.tsx"],
  "schedule-all-slot": ["app/(tabs)/calendar.tsx"],
  "schedule-hour-slot": ["app/(tabs)/calendar.tsx"],
  "schedule-edit": ["app/(tabs)/calendar.tsx"],
  "schedule-view": ["app/(tabs)/calendar.tsx"],
  "todo-timing": ["app/todo-editor.tsx"],
  "todo-repeat-reminders": ["app/todo-editor.tsx"],
  "reminder-editor": ["app/reminder-editor.tsx"],
  "log-header": ["app/(tabs)/log.tsx"],
  "log-date-time": ["app/(tabs)/log.tsx"],
  "log-food-search": ["app/(tabs)/log.tsx"],
  "food-search-results": ["app/food-search.tsx"],
  "log-visibility": ["app/(tabs)/log.tsx"],
  "timer-setup": ["app/timer.tsx"],
  "timer-active": ["app/timer.tsx"],
  "progress-modes": ["app/(tabs)/insights.tsx"],
  "progress-range": ["app/(tabs)/insights.tsx"],
  "progress-overview-card": ["app/(tabs)/insights.tsx"],
  "progress-grid-cell": [
    "app/(tabs)/insights.tsx",
    "src/components/MonthCalendar.tsx",
  ],
  "daily-detail-summary": ["app/day/[date].tsx"],
  "daily-detail-filter": ["app/day/[date].tsx"],
  "progress-edit": ["app/(tabs)/insights.tsx"],
  "performance-range": ["app/(tabs)/performance.tsx"],
  "performance-filters": ["app/(tabs)/performance.tsx"],
  "performance-edit": ["app/(tabs)/performance.tsx"],
};

const scopedSections = new Set([
  "today",
  "status",
  "schedule",
  "todo",
  "log",
  "food",
  "timer",
  "progress",
  "daily-detail",
  "performance",
]);
const scopedSteps = FULL_TUTORIAL_GUIDE.steps.filter((item) =>
  scopedSections.has(item.sectionId),
);
const scopedTargets = new Set(
  scopedSteps.flatMap((item) => (item.target ? [item.target] : [])),
);
for (const item of BASIC_TUTORIAL_GUIDE.steps) {
  if (item.target && targetFiles[item.target]) scopedTargets.add(item.target);
}
for (const target of scopedTargets) {
  assert(
    targetFiles[target],
    `Scoped curriculum target is missing from the real-source map: ${target}`,
  );
}
for (const target of Object.keys(targetFiles)) {
  assert(
    scopedTargets.has(target),
    `Real-source map contains a target outside the scoped curriculum: ${target}`,
  );
}

for (const [target, files] of Object.entries(targetFiles)) {
  assert(
    curriculum.includes(`target: "${target}"`),
    `Core target is not referenced by the curriculum: ${target}`,
  );
  const sources = files.map(read);
  assert(
    sources.some((source) => source.includes(`"${target}"`)),
    `Core target has no real screen/component registration: ${target}`,
  );
  assert(
    sources.some(
      (source) =>
        source.includes(`id="${target}"`) ||
        source.includes(`tutorialId="${target}"`) ||
        source.includes(`tutorialDayTarget="${target}"`) ||
        source.includes(`? "${target}"`),
    ),
    `Core target is only present as inert text: ${target}`,
  );
}

const actionWiring = {
  "tutorial.today.complete-todo": {
    file: "app/(tabs)/index.tsx",
    prerequisite: "todoId === \"tutorial-todo-groceries\"",
  },
  "tutorial.today.enter-edit": {
    file: "app/(tabs)/index.tsx",
    prerequisite: "setEditing(true)",
  },
  "tutorial.today.toggle-tracked": {
    file: "app/(tabs)/index.tsx",
    prerequisite: "setTrackedGoal(item.id",
  },
  "tutorial.today.reorder": {
    file: "app/(tabs)/index.tsx",
    prerequisite: "reorderMetric(item.id",
  },
  "tutorial.status.open-simulator": {
    file: "app/(tabs)/status.tsx",
    prerequisite: "setAvatarSimulatorOpen(true)",
  },
  "tutorial.schedule.open-all": {
    file: "app/(tabs)/calendar.tsx",
    prerequisite: "setSlotMenu({ date, hour: null, events })",
  },
  "tutorial.schedule.open-slot-menu": {
    file: "app/(tabs)/calendar.tsx",
    prerequisite: "createInSlot(",
  },
  "tutorial.log.visibility": {
    file: "app/(tabs)/log.tsx",
    prerequisite: "setVisibility(option.value)",
  },
  "tutorial.timer.start": {
    file: "app/timer.tsx",
    prerequisite: "setActivityTimer({",
  },
  "tutorial.progress.open-day": {
    file: "app/(tabs)/insights.tsx",
    prerequisite: "router.navigate({",
  },
};

const scopedActions = new Set(
  scopedSteps.flatMap((item) =>
    item.interaction?.actionId ? [item.interaction.actionId] : [],
  ),
);
for (const actionId of scopedActions) {
  assert(
    actionWiring[actionId],
    `Scoped curriculum action is missing from the real-handler map: ${actionId}`,
  );
}
for (const actionId of Object.keys(actionWiring)) {
  assert(
    scopedActions.has(actionId),
    `Real-handler map contains an action outside the scoped curriculum: ${actionId}`,
  );
}

for (const [actionId, wiring] of Object.entries(actionWiring)) {
  assert(
    curriculum.includes(`actionId: "${actionId}"`),
    `Core practice action is missing from the curriculum: ${actionId}`,
  );
  const source = read(wiring.file);
  const actionAt = source.indexOf(`actionId: "${actionId}"`);
  assert(actionAt >= 0, `Core practice action is not reported: ${actionId}`);
  const precedingHandler = source.slice(Math.max(0, actionAt - 1800), actionAt);
  assert(
    precedingHandler.includes(wiring.prerequisite),
    `Core practice action is not downstream of its successful handler: ${actionId}`,
  );
  const reportBlock = source.slice(actionAt, actionAt + 180);
  assert(
    reportBlock.includes('scope: "isolated-preview"'),
    `Core practice action is not isolated to tutorial preview state: ${actionId}`,
  );
}

const todoList = read("src/components/TodoTodayList.tsx");
assert(
  /toggleTodo\(todo\.id, localDate\);\s*if \(completing\) onComplete\?\.\(todo\.id\);/.test(
    todoList,
  ),
  "Today practice completion must be emitted only after the demo to-do toggles.",
);

const demo = read("src/data/tutorialDemo.ts");
assert(
  demo.includes('id: "tutorial-todo-groceries"') &&
    /id: "tutorial-todo-groceries"[\s\S]{0,500}completedDates: \[\]/.test(demo),
  "The grocery practice to-do must begin incomplete.",
);
assert(
  /id: "tutorial-view-basics"[\s\S]{0,400}"tutorial_meditation"/.test(demo),
  "The Meditation flag practice target must be visible in the tutorial Today view.",
);

console.log(
  `Tutorial core-page wiring validated: ${Object.keys(targetFiles).length} targets and ${Object.keys(actionWiring).length} isolated practice actions.`,
);
