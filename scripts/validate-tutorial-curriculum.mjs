import assert from "node:assert/strict";
import fs from "node:fs";
import Module, { createRequire } from "node:module";
import path from "node:path";
import process from "node:process";
import ts from "typescript";

const root = process.cwd();
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
for (const extension of [".jpg", ".jpeg", ".png", ".webp"])
  require.extensions[extension] = (module, filename) => {
    module.exports = filename;
  };

const guideSource = fs.readFileSync("src/tutorial/guides.ts", "utf8");
const demoSource = fs.readFileSync("src/data/tutorialDemo.ts", "utf8");
const joinedSource = `${guideSource}\n${demoSource}`;
assert.doesNotMatch(
  joinedSource,
  /\u00E2|\u00F0|\u00C2/,
  "Tutorial curriculum and demo data must be clean UTF-8 without mojibake.",
);
assert.doesNotMatch(
  demoSource,
  /sb_(?:publishable|secret)_|service_role|SUPABASE_|FATSECRET_|AI_API_KEY|BEGIN (?:RSA |EC )?PRIVATE KEY/i,
  "Tutorial data must not contain credentials or vendor secrets.",
);
assert.doesNotMatch(
  demoSource,
  /Date\.now\(\)|new Date\(\s*\)/,
  "Tutorial data must derive every date and id from its explicit anchor.",
);
assert.doesNotMatch(
  guideSource,
  /\/day\/\d{4}-\d{2}-\d{2}/,
  "Tutorial routes must resolve the active sandbox date instead of a fixture date.",
);

const {
  BASIC_TUTORIAL_GUIDE,
  FULL_TUTORIAL_GUIDE,
  MODULE_TUTORIAL_GUIDES,
  TUTORIAL_ANCHOR_INVENTORY,
  TUTORIAL_GUIDES,
  TUTORIAL_ROUTE_INVENTORY,
} = require(path.join(root, "src/tutorial/guides.ts"));
const {
  createTutorialDemoState,
  TUTORIAL_DEMO_ANCHOR_DATE,
  TUTORIAL_DEMO_GROUP_ID,
  TUTORIAL_DEMO_SCHEMA_VERSION,
  TUTORIAL_DEMO_USER_ID,
} = require(path.join(root, "src/data/tutorialDemo.ts"));
const {
  TUTORIAL_DATE_ROUTE_TOKEN,
  TUTORIAL_DAY_ROUTE,
  resolveTutorialRoute,
} = require(path.join(root, "src/tutorial/routes.ts"));
const {
  TUTORIAL_TRANSLATION_CATALOGS,
  localizedTutorialGuide,
} = require(path.join(root, "src/i18n/tutorial/index.ts"));
const { resolvedGroupChallengeWins } = require(
  path.join(root, "src/domain/groupChallenges.ts"),
);
const { buildBadges } = require(path.join(root, "src/domain/badges.ts"));
const { trackedGoalSummary } = require(path.join(root, "src/domain/metrics.ts"));

assert.equal(TUTORIAL_GUIDES[0], BASIC_TUTORIAL_GUIDE);
assert.equal(TUTORIAL_GUIDES[1], FULL_TUTORIAL_GUIDE);
assert.deepEqual(
  TUTORIAL_GUIDES.slice(2),
  MODULE_TUTORIAL_GUIDES,
  "Focused modules must follow Basic and Full in the guide catalog.",
);
assert.equal(FULL_TUTORIAL_GUIDE.id, "full-app");
assert.ok(
  FULL_TUTORIAL_GUIDE.steps.length >= 70,
  "The full guide must remain an exhaustive curriculum, not a short tour.",
);
assert.ok(
  FULL_TUTORIAL_GUIDE.sections.length >= 25,
  "Every major page and requested specialized tracker needs a visible module.",
);

const guideIds = new Set();
for (const guide of TUTORIAL_GUIDES) {
  assert.ok(!guideIds.has(guide.id), `Duplicate guide id: ${guide.id}`);
  guideIds.add(guide.id);
  assert.ok(Number.isInteger(guide.version) && guide.version > 0);
  const sectionIds = new Set(guide.sections.map((section) => section.id));
  const stepIds = new Set();
  const actionIds = new Set();
  assert.equal(sectionIds.size, guide.sections.length, `${guide.id} has duplicate sections`);
  for (const [stepIndex, tutorialStep] of guide.steps.entries()) {
    assert.ok(!stepIds.has(tutorialStep.id), `Duplicate step id: ${tutorialStep.id}`);
    stepIds.add(tutorialStep.id);
    assert.ok(sectionIds.has(tutorialStep.sectionId), `${tutorialStep.id} uses an unknown section`);
    assert.match(tutorialStep.path, /^\/(?:[^?#]*)$/);
    assert.ok(tutorialStep.title.trim().length >= 4);
    assert.ok(tutorialStep.copy.trim().length >= 20);
    if (tutorialStep.target) {
      assert.equal(tutorialStep.anchor?.required !== undefined, true);
      assert.ok(TUTORIAL_ANCHOR_INVENTORY.includes(tutorialStep.target));
    }
    if (tutorialStep.interaction?.mode === "practice") {
      assert.match(tutorialStep.interaction.actionId ?? "", /^tutorial\./);
      assert.ok(tutorialStep.interaction.instruction?.trim());
      assert.ok(
        !actionIds.has(tutorialStep.interaction.actionId),
        `Duplicate practice action id: ${tutorialStep.interaction.actionId}`,
      );
      actionIds.add(tutorialStep.interaction.actionId);
      if (tutorialStep.interaction.autoAdvance) {
        assert.equal(
          tutorialStep.interaction.completion,
          "observed-action",
          `${tutorialStep.id} auto-advances without an observed app action`,
        );
        assert.ok(
          stepIndex < guide.steps.length - 1,
          `${tutorialStep.id} cannot auto-advance from the last guide step`,
        );
      }
    }
  }
}
assert.equal(
  TUTORIAL_ANCHOR_INVENTORY.length,
  new Set(TUTORIAL_ANCHOR_INVENTORY).size,
);
assert.equal(
  TUTORIAL_ROUTE_INVENTORY.length,
  new Set(TUTORIAL_ROUTE_INVENTORY).size,
);
assert.equal(TUTORIAL_DATE_ROUTE_TOKEN, ":tutorial-date");
assert.equal(TUTORIAL_DAY_ROUTE, "/day/:tutorial-date");
assert.ok(TUTORIAL_ROUTE_INVENTORY.includes(TUTORIAL_DAY_ROUTE));
for (const route of TUTORIAL_ROUTE_INVENTORY) {
  assert.doesNotMatch(
    route,
    /\/day\/\d{4}-\d{2}-\d{2}/,
    `Literal dated tutorial route: ${route}`,
  );
  const resolved = resolveTutorialRoute(route, TUTORIAL_DEMO_ANCHOR_DATE);
  assert.ok(resolved);
  assert.ok(!resolved.includes(TUTORIAL_DATE_ROUTE_TOKEN));
  if (route.includes(TUTORIAL_DATE_ROUTE_TOKEN))
    assert.equal(resolved, `/day/${TUTORIAL_DEMO_ANCHOR_DATE}`);
}
assert.equal(
  resolveTutorialRoute(TUTORIAL_DAY_ROUTE, "2042-03-09"),
  "/day/2042-03-09",
  "The same curriculum must follow any deterministic sandbox anchor.",
);
assert.throws(
  () => resolveTutorialRoute(TUTORIAL_DAY_ROUTE, "03/09/2042"),
  /Invalid tutorial anchor date/,
);

const expectedEnglish = new Map();
function addExpectedTranslation(key, value) {
  if (!value) return;
  const current = expectedEnglish.get(key);
  assert.ok(
    current === undefined || current === value,
    `Stable tutorial key maps to conflicting English copy: ${key}`,
  );
  expectedEnglish.set(key, value);
}
for (const guide of TUTORIAL_GUIDES) {
  addExpectedTranslation(`guide.${guide.id}.title`, guide.title);
  addExpectedTranslation(`guide.${guide.id}.detail`, guide.detail);
  for (const section of guide.sections ?? []) {
    addExpectedTranslation(`section.${section.id}.title`, section.title);
    addExpectedTranslation(`section.${section.id}.detail`, section.detail);
  }
  for (const tutorialStep of guide.steps) {
    addExpectedTranslation(`step.${tutorialStep.id}.title`, tutorialStep.title);
    addExpectedTranslation(`step.${tutorialStep.id}.copy`, tutorialStep.copy);
    addExpectedTranslation(
      `step.${tutorialStep.id}.primaryLabel`,
      tutorialStep.primaryLabel,
    );
    addExpectedTranslation(
      `step.${tutorialStep.id}.instruction`,
      tutorialStep.interaction?.instruction,
    );
  }
}

const tutorialLanguages = ["en", "ar", "es", "zh-Hans", "sv", "de", "ru", "fr"];
assert.deepEqual(
  Object.keys(TUTORIAL_TRANSLATION_CATALOGS).sort(),
  [...tutorialLanguages].sort(),
  "Tutorial catalogs must cover every AppLanguage.",
);
const expectedTranslationKeys = [...expectedEnglish.keys()].sort();
const englishCatalog = TUTORIAL_TRANSLATION_CATALOGS.en;
assert.deepEqual(
  Object.keys(englishCatalog).sort(),
  expectedTranslationKeys,
  "The canonical English catalog must exactly match every rendered curriculum field.",
);
for (const [key, value] of expectedEnglish) assert.equal(englishCatalog[key], value);

const suspiciousEncoding =
  /\uFFFD|Ã.|Â(?:\u00A0|©|®)|â(?:€|™|œ|ž|“|”|–|—)|ðŸ/u;
for (const language of tutorialLanguages) {
  const catalog = TUTORIAL_TRANSLATION_CATALOGS[language];
  assert.deepEqual(
    Object.keys(catalog).sort(),
    expectedTranslationKeys,
    `${language} tutorial keys must have exact parity with English.`,
  );
  for (const key of expectedTranslationKeys) {
    const value = catalog[key];
    assert.equal(typeof value, "string", `${language} is missing ${key}`);
    assert.ok(value.trim(), `${language} has blank tutorial copy at ${key}`);
    assert.doesNotMatch(value, /__HABHUB_TUTORIAL_SPLIT_/);
    assert.doesNotMatch(value, suspiciousEncoding, `${language} has mojibake at ${key}`);
    if (language !== "en")
      assert.notEqual(
        value,
        englishCatalog[key],
        `${language} silently falls back to English at ${key}`,
      );
  }

  for (const guide of TUTORIAL_GUIDES) {
    const localized = localizedTutorialGuide(guide, language);
    assert.equal(localized.id, guide.id);
    assert.equal(localized.version, guide.version);
    assert.equal(localized.icon, guide.icon);
    assert.equal(localized.path, guide.path);
    assert.equal(localized.title, catalog[`guide.${guide.id}.title`]);
    assert.equal(localized.detail, catalog[`guide.${guide.id}.detail`]);
    assert.equal(localized.sections?.length ?? 0, guide.sections?.length ?? 0);
    for (let index = 0; index < (guide.sections?.length ?? 0); index += 1) {
      const sourceSection = guide.sections[index];
      const localizedSection = localized.sections[index];
      assert.equal(localizedSection.id, sourceSection.id);
      assert.equal(
        localizedSection.title,
        catalog[`section.${sourceSection.id}.title`],
      );
      assert.equal(
        localizedSection.detail,
        sourceSection.detail
          ? catalog[`section.${sourceSection.id}.detail`]
          : undefined,
      );
    }
    assert.equal(localized.steps.length, guide.steps.length);
    for (let index = 0; index < guide.steps.length; index += 1) {
      const sourceStep = guide.steps[index];
      const localizedStep = localized.steps[index];
      assert.equal(localizedStep.id, sourceStep.id);
      assert.equal(localizedStep.sectionId, sourceStep.sectionId);
      assert.equal(localizedStep.path, sourceStep.path);
      assert.equal(localizedStep.target, sourceStep.target);
      assert.deepEqual(localizedStep.anchor, sourceStep.anchor);
      assert.deepEqual(localizedStep.navigation, sourceStep.navigation);
      assert.equal(
        localizedStep.interaction?.actionId,
        sourceStep.interaction?.actionId,
      );
      assert.equal(
        localizedStep.interaction?.mode,
        sourceStep.interaction?.mode,
      );
      assert.equal(
        localizedStep.interaction?.completion,
        sourceStep.interaction?.completion,
      );
      assert.equal(localizedStep.title, catalog[`step.${sourceStep.id}.title`]);
      assert.equal(localizedStep.copy, catalog[`step.${sourceStep.id}.copy`]);
      assert.equal(
        localizedStep.primaryLabel,
        sourceStep.primaryLabel
          ? catalog[`step.${sourceStep.id}.primaryLabel`]
          : undefined,
      );
      assert.equal(
        localizedStep.interaction?.instruction,
        sourceStep.interaction?.instruction
          ? catalog[`step.${sourceStep.id}.instruction`]
          : undefined,
      );
    }
  }
}

for (const requiredSection of [
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
  "leaderboard",
  "challenges",
  "comparison",
  "badges",
  "groups",
  "workout",
  "chat",
  "journal",
  "menu",
  "settings",
  "notifications",
  "display",
  "metric-detail",
  "screen-time",
  "fasting",
  "custom-metric",
])
  assert.ok(
    FULL_TUTORIAL_GUIDE.sections.some((section) => section.id === requiredSection),
    `Missing tutorial module: ${requiredSection}`,
  );
assert.equal(
  MODULE_TUTORIAL_GUIDES.length,
  FULL_TUTORIAL_GUIDE.sections.length,
  "Every full-guide section needs its own replayable focused module.",
);
for (const section of FULL_TUTORIAL_GUIDE.sections) {
  const moduleGuide = MODULE_TUTORIAL_GUIDES.find(
    (guide) => guide.id === `module:${section.id}`,
  );
  assert.ok(moduleGuide, `Missing replayable guide for ${section.id}`);
  assert.deepEqual(moduleGuide.sections, [section]);
  assert.deepEqual(
    moduleGuide.steps,
    FULL_TUTORIAL_GUIDE.steps.filter((step) => step.sectionId === section.id),
  );
  assert.ok(moduleGuide.steps.length > 0, `Empty replayable guide: ${moduleGuide.id}`);
  assert.equal(
    moduleGuide.path,
    moduleGuide.steps[0].navigation?.before ?? moduleGuide.steps[0].path,
  );
}

for (const term of [
  "tracked goal",
  "general tracker",
  "apply",
  "pin",
  "reorder",
  "filter",
  "all-goals",
  "ALL slot",
  "deadline",
  "planned",
  "privacy",
  "daily averages",
  "year cells",
  "challenge",
  "showcase",
  "superset",
  "calories",
  "lock the phone",
  "hashtag",
  "drawing",
  "battery-optimization",
  "Screen Time",
  "Family Controls",
  "fasting",
  "submetrics",
  "CLAMP",
  "safe",
])
  assert.ok(
    FULL_TUTORIAL_GUIDE.steps.some((tutorialStep) =>
      `${tutorialStep.title} ${tutorialStep.copy}`.toLocaleLowerCase().includes(
        term.toLocaleLowerCase(),
      ),
    ),
    `Curriculum lost requested coverage for: ${term}`,
  );

const first = createTutorialDemoState(TUTORIAL_DEMO_ANCHOR_DATE);
const second = createTutorialDemoState(TUTORIAL_DEMO_ANCHOR_DATE);
assert.deepEqual(first, second, "The same anchor must produce byte-stable tutorial state.");
assert.deepEqual(first, createTutorialDemoState(TUTORIAL_DEMO_ANCHOR_DATE));
assert.equal(first.schemaVersion, TUTORIAL_DEMO_SCHEMA_VERSION);
assert.equal(first.anchorDate, TUTORIAL_DEMO_ANCHOR_DATE);
assert.equal(first.appState.currentUserId, TUTORIAL_DEMO_USER_ID);
assert.equal(first.appState.group.id, TUTORIAL_DEMO_GROUP_ID);
assert.equal(first.appState.groups.length, 1);
assert.equal(first.appState.group.members.length, 4);
assert.equal(first.appState.group.pendingMembers?.length, 1);
assert.ok(first.appState.entries.length >= 2_000);
assert.ok(first.appState.gymPlans?.length >= 2);
assert.ok(first.appState.gymSessions?.length >= 5);
assert.ok(first.appState.todos?.length >= 4);
assert.ok(first.appState.journalNotes?.length >= 2);
assert.ok(first.appState.calendarReminders?.length >= 4);
assert.ok(first.appState.activityTimers?.length >= 2);
assert.ok(first.groupChallenges.length >= 4);
const completeDaySummary = trackedGoalSummary(
    first.appState,
    first.appState.currentUserId,
    TUTORIAL_DEMO_ANCHOR_DATE,
  );
assert.equal(
  completeDaySummary.allMet,
  true,
  "The complete-day step must render its real all-goals visual",
);

const metricIds = new Set(first.appState.metrics.map((metric) => metric.id));
assert.equal(metricIds.size, first.appState.metrics.length, "Tutorial metrics need unique ids.");
for (const requiredMetric of [
  "steps",
  "food",
  "screen_time",
  "intermittent_fasting",
  "tutorial_meditation",
  "tutorial_wellbeing",
  "tutorial_focus_score",
])
  assert.ok(metricIds.has(requiredMetric), `Missing demo tracker: ${requiredMetric}`);

const focus = first.appState.metrics.find((metric) => metric.id === "tutorial_focus_score");
assert.equal(focus?.dataType, "calculated");
assert.match(focus?.formula ?? "", /CLAMP\(reading \+ study \+ work/);
const wellbeing = first.appState.metrics.find((metric) => metric.id === "tutorial_wellbeing");
assert.equal(wellbeing?.submetrics?.length, 3);
assert.equal(wellbeing?.submetricDisplay?.mode, "merged");
const fasting = first.appState.metrics.find((metric) => metric.id === "intermittent_fasting");
assert.equal(fasting?.fastingSettings?.automaticFoodBreak, true);
const screenTime = first.appState.metrics.find((metric) => metric.id === "screen_time");
assert.equal(screenTime?.rankingDirection, "lower");
assert.equal(screenTime?.defaultVisibility, "private");

const entryIds = new Set();
for (const entry of first.appState.entries) {
  assert.ok(!entryIds.has(entry.id), `Duplicate tutorial entry: ${entry.id}`);
  entryIds.add(entry.id);
  assert.ok(metricIds.has(entry.metricId), `Entry references missing metric: ${entry.metricId}`);
  assert.ok(first.appState.group.members.some((member) => member.id === entry.userId));
}
const todoIds = new Set(first.appState.todos?.map((todo) => todo.id));
assert.equal(todoIds.size, first.appState.todos?.length);
for (const reminder of first.appState.calendarReminders ?? []) {
  if (reminder.metricId) assert.ok(metricIds.has(reminder.metricId));
  if (reminder.todoId) assert.ok(todoIds.has(reminder.todoId));
}
for (const challenge of first.groupChallenges) {
  assert.equal(challenge.groupId, TUTORIAL_DEMO_GROUP_ID);
  assert.ok(metricIds.has(challenge.metricId));
  assert.ok(challenge.participantIds.length >= 2);
  assert.ok(
    challenge.participantIds.every((participant) =>
      first.appState.group.members.some((member) => member.id === participant),
    ),
  );
}
assert.equal(
  first.groupChallenges.filter(
    (challenge) =>
      challenge.localDate < first.anchorDate &&
      challenge.participantIds.includes(TUTORIAL_DEMO_USER_ID),
  ).length,
  3,
  "The cabinet demo needs repeated completed challenge opportunities.",
);
const resolvedTutorialWins = resolvedGroupChallengeWins(
  first.appState,
  first.groupChallenges,
  first.anchorDate,
  first.anchorDate,
).filter((win) => win.winnerIds.includes(TUTORIAL_DEMO_USER_ID));
assert.equal(
  resolvedTutorialWins.length,
  3,
  "The demo user must actually win three finalized challenges for the multi-win badge lesson.",
);
const tutorialBadges = buildBadges(
  first.appState,
  first.anchorDate,
  first.groupChallenges,
  first.anchorDate,
);
const showcaseIds =
  first.appState.settings.badgeShowcaseByGroup[TUTORIAL_DEMO_GROUP_ID] ?? [];
assert.ok(showcaseIds.length >= 3 && showcaseIds.length <= 5);
for (const badgeId of showcaseIds) {
  const badge = tutorialBadges.find(
    (candidate) =>
      candidate.id === badgeId && candidate.memberId === TUTORIAL_DEMO_USER_ID,
  );
  assert.ok(badge, `Showcase references a missing demo-user badge: ${badgeId}`);
  assert.equal(badge.status, "earned", `Showcase badge is not earned: ${badgeId}`);
}
assert.equal(
  tutorialBadges.find(
    (badge) => badge.id === `challenge-wins:${TUTORIAL_DEMO_USER_ID}`,
  )?.earnedCount,
  3,
);

const imageAssets = new Set(
  require(path.join(root, "src/data/demoAssets.ts")).DEMO_PROGRESS_URIS,
);
const usedImages = [
  ...first.appState.photos.map((photo) => photo.uri),
  ...first.appState.entries.flatMap((entry) => entry.imageUri ? [entry.imageUri] : []),
  ...(first.appState.journalNotes ?? []).flatMap((note) => note.imageUri ? [note.imageUri] : []),
  ...first.appState.messages.flatMap((message) => message.imageUri ? [message.imageUri] : []),
];
assert.ok(usedImages.length >= 5);
assert.ok(
  usedImages.every((image) => imageAssets.has(image)),
  "Every tutorial image must come from bundled demo assets.",
);

const screenTimeTotal = first.screenTimeReport.apps.reduce(
  (sum, app) => sum + app.foregroundMs,
  0,
);
assert.equal(first.screenTimeReport.screenTimeMs, screenTimeTotal);
assert.equal(first.screenTimeReport.approximate, true);
assert.ok(first.screenTimeReport.apps.length >= 5);
assert.ok(
  first.screenTimeReport.apps.every((app) => app.packageName.startsWith("app.demo.")),
);

const serialized = JSON.stringify(first);
assert.doesNotMatch(serialized, /supabase\.co|sb_publishable|service_role|@gmail\.|@outlook\./i);
assert.match(serialized, /\*\*Win:\*\*/);
assert.match(serialized, /\[Open the food tracker\]\(/);
assert.ok((first.appState.journalNotes ?? []).some((note) => note.drawing?.strokes.length));
assert.ok((first.appState.gymSessions ?? []).some((session) =>
  session.exercises.some((exercise) => exercise.sets.some((set) => set.superset)),
));

console.log(
  `Tutorial curriculum validated: ${TUTORIAL_GUIDES.length} guides, ${FULL_TUTORIAL_GUIDE.sections.length} full modules, ${FULL_TUTORIAL_GUIDE.steps.length} full steps, ${TUTORIAL_ANCHOR_INVENTORY.length} anchors, ${first.appState.entries.length} demo entries.`,
);
