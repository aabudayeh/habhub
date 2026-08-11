import assert from "node:assert/strict";
import fs from "node:fs";

const source = fs.readFileSync("app/onboarding.tsx", "utf8");

assert.match(source, /\{step \+ 1\}\/4/);
assert.match(source, /ProgressBar progress=\{\(step \+ 1\) \/ 4\}/);
assert.doesNotMatch(source, /step === 4/);
assert.match(
  source,
  /\{step === 0 && goals\.length \? \([\s\S]*?title="Your starting setup"/,
  "Recommended trackers must render in the same step as goal selection",
);
assert.match(source, /if \(step === 1\) configure\(\)/);
assert.match(source, /\{step === 2 \? \([\s\S]*?title="Connect when you are ready"/);
assert.match(source, /\{step === 3 \? \([\s\S]*?title="You are ready"/);
assert.match(
  source,
  /metrics: \["body_fat", "lean_body_mass", "body_water_mass", "bone_mass"\]/,
);
assert.match(source, /const previousProposedIds = useRef/);
assert.match(source, /const added = previousIds/);
assert.match(source, /const removed = previousIds/);
assert.match(source, /knownRecommendationGroups/);
assert.match(source, /accessibilityRole="checkbox"/);
assert.match(source, /<Text style=\{styles\.targetLabel\}>Target<\/Text>/);
assert.match(
  source,
  /A filled flag counts this tracker toward your daily tracked[\s\S]*?checkbox only adds or removes the tracker/,
);

console.log("Goal-led four-step onboarding flow validated.");
