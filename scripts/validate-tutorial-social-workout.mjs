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
  "app/member/[id].tsx": ["comparison-stats", "badge-showcase-picker"],
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

console.log(
  `Tutorial social/workout wiring validated: ${targetCount} real targets, ${actionCount} isolated practice actions.`,
);
