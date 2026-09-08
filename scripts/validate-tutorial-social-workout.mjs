import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (file) =>
  readFileSync(path.join(root, ...file.split("/")), "utf8");

const targetsByFile = {
  "app/(tabs)/group.tsx": [
    "leaderboard-cards",
    "leaderboard-edit",
    "leaderboard-create-challenge",
  ],
  "app/leaderboard-detail.tsx": ["leaderboard-detail-chart"],
  "app/member/[id].tsx": ["comparison-stats"],
  "app/member-profile/[id].tsx": ["badge-showcase-picker"],
  "app/badges.tsx": ["badge-cabinet"],
  "app/groups.tsx": ["groups-list"],
  "app/group-settings.tsx": ["group-settings"],
  "app/(tabs)/gym.tsx": [
    "workout-modes",
    "workout-templates",
    "workout-session-details",
    "workout-exercises",
    "workout-guided-timer",
    "workout-save",
  ],
  "app/gym-exercise.tsx": ["gym-exercise-progress"],
  "app/(tabs)/chat.tsx": ["chat-header", "chat-composer"],
  "app/(tabs)/journal.tsx": ["journal-notes"],
  "app/note-editor.tsx": [
    "note-trackers-labels",
    "note-formatting",
    "note-drawing",
  ],
  "app/menu.tsx": ["menu-profile"],
};

const guides = read("src/tutorial/guides.ts");
const spotlight = read("src/components/TutorialSpotlight.tsx");
let targetCount = 0;
for (const [file, targets] of Object.entries(targetsByFile)) {
  const source = read(file);
  for (const target of targets) {
    const directTarget = new RegExp(
      `(?:<TutorialTarget\\s+[^>]*id|tutorialId)=["']${target}["']`,
    );
    const conditionalTarget = new RegExp(
      `<TutorialTarget[\\s\\S]{0,180}["']${target}["']`,
    );
    assert.ok(
      directTarget.test(source) || conditionalTarget.test(source),
      `${target} is not wired to a real TutorialTarget in ${file}`,
    );
    assert.ok(
      guides.includes(`target: "${target}"`),
      `${target} is not referenced by the full guide`,
    );
    targetCount += 1;
  }
}

const actionsByFile = {
  "app/(tabs)/group.tsx": ["tutorial.challenge.open-create"],
  "app/(tabs)/gym.tsx": [
    "tutorial.workout.choose-template",
    "tutorial.workout.complete-set",
  ],
  "app/note-editor.tsx": ["tutorial.journal.format"],
};

let actionCount = 0;
for (const [file, actions] of Object.entries(actionsByFile)) {
  const source = read(file);
  assert.match(source, /useTutorial\(\)/, `${file} must use the tutorial event API`);
  for (const action of actions) {
    assert.ok(
      guides.includes(`actionId: "${action}"`),
      `${action} is not referenced by the full guide`,
    );
    assert.ok(source.includes(`actionId: "${action}"`), `${action} is not reported by ${file}`);
    assert.match(
      source,
      new RegExp(
        `actionId: ["']${action.replaceAll(".", "\\.")}["'][\\s\\S]{0,140}scope: ["']isolated-preview["']`,
      ),
      `${action} must be reported only through the isolated tutorial preview`,
    );
    actionCount += 1;
  }
}

const gym = read("app/(tabs)/gym.tsx");
assert.match(gym, /"full-body strength"[\s\S]{0,260}tutorial\.workout\.choose-template/);
assert.match(gym, /!set\.completed[\s\S]{0,260}(?:back_squat|squat)[\s\S]{0,260}tutorial\.workout\.complete-set/);
assert.match(gym, /activeTutorialTarget === "workout-templates"[\s\S]{0,180}setTemplatesOpen\(true\)/);
assert.match(gym, /activeTutorialTarget === "workout-exercises"[\s\S]{0,180}setOpenExerciseId/);

const notes = read("app/note-editor.tsx");
assert.match(notes, /toggleInline\("bold"\)[\s\S]{0,260}tutorial\.journal\.format/);
assert.match(notes, /richNoteHasText\(body\.current\)/);
assert.match(notes, /tutorialDrawing[\s\S]{0,180}setDrawingMode\(true\)/);

const group = read("app/(tabs)/group.tsx");
assert.match(
  spotlight,
  /tutorialActivatedRef\.current = true;[\s\S]{0,120}onTutorialActivateRef\.current\?\.\(\)/,
  "Tutorial targets must remember when Watch mode opened transient UI.",
);
assert.match(
  spotlight,
  /if \(!tutorialActivatedRef\.current\) return;[\s\S]{0,140}onTutorialDeactivateRef\.current\?\.\(\)/,
  "An activated target must clean up its transient UI when its step, route, or guide leaves.",
);
assert.match(
  group,
  /const closeChallengeEditor = useCallback\(\(\) => \{[\s\S]{0,140}setChallengeEditorOpen\(false\);[\s\S]{0,100}setEditingChallenge\(undefined\)/,
  "Challenge tutorial cleanup must close the editor without saving or mutating challenge data.",
);
assert.match(
  group,
  /id="leaderboard-create-challenge"[\s\S]{0,180}onTutorialActivate=\{\(\) => openChallengeEditor\(\)\}[\s\S]{0,120}onTutorialDeactivate=\{closeChallengeEditor\}/,
  "The Challenge lesson must own and release the modal it opens.",
);
assert.match(
  group,
  /if \(screenIsFocused\) return;[\s\S]{0,260}setShowPicker\(false\);[\s\S]{0,180}setShowHistoryOptions\(false\);[\s\S]{0,120}closeChallengeEditor\(\)/,
  "A mounted Group tab must dismiss transient sheets and modals when its route loses focus.",
);

console.log(
  `Tutorial social/workout wiring validated: ${targetCount} real targets, ${actionCount} isolated practice actions.`,
);
