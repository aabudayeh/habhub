import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

const screen = read("app/badges.tsx");
const medallion = read("src/components/BadgeMedallion.tsx");
const alerts = read("app/alerts.tsx");
const profile = read("app/member-profile/[id].tsx");
const domain = read("src/domain/badges.ts");
const types = read("src/types.ts");
const seed = read("src/data/seed.ts");
const provider = read("src/state/AppProvider.tsx");
const challengeInputs = read("src/cloud/useBadgeChallengeInputs.ts");

assert.match(
  medallion,
  /function BadgeMedallion[\s\S]*badgeVisualSpec\(badge, trackerIcon\)[\s\S]*spec\.primaryIcon[\s\S]*spec\.accentIcon/,
  "Badge cards must keep the composable tracker-glyph plus award-motif shell.",
);
assert.match(
  domain,
  /if \(aim === "records"\)[\s\S]*primaryIcon: trackerIcon \?\? badge\.icon,[\s\S]*accentIcon: "star"/,
  "Personal records must combine the tracker icon with the personal-best star.",
);
assert.match(
  domain,
  /if \(aim === "previous-leaders"\)[\s\S]*primaryIcon: "medal",[\s\S]*accentIcon: "checkmark"/,
  "Previous-day champions must retain a visually distinct finalized-medal treatment.",
);
assert.match(
  screen,
  /if \(!statusFilters\.includes\(status\)\)[\s\S]*\[status\]: true/,
  "Selecting a hidden status filter must expand its section.",
);
assert.match(
  types,
  /badgePinnedByGroup: Record<string, string\[\]>/,
  "Pinned badge ids must be part of persisted settings.",
);
assert.match(seed, /badgePinnedByGroup: \{\}/);
assert.match(
  provider,
  /badgePinnedByGroup: \{[\s\S]*defaults\.settings\.badgePinnedByGroup,[\s\S]*restored\.settings\?\.badgePinnedByGroup/,
  "Older snapshots must restore pinned badge settings safely.",
);
assert.match(
  screen,
  /defaultPinnedBadgeIds\(/,
  "The cabinet must provide tracker-aware default pins.",
);
assert.match(
  screen,
  /state\.settings\.selectedGoals/,
  "Default badge pins must consider trackers selected during onboarding.",
);
assert.match(
  screen,
  /pinnedBadgeIds\.length >= 9/,
  "The cabinet must allow at most nine personal pins.",
);
assert.match(
  screen,
  /\)\.slice\(0, 9\)/,
  "Restored pin lists must be safely capped at nine.",
);
assert.doesNotMatch(
  screen,
  /badgePinnedLimitByGroup|pinnedLimit|changePinnedLimit|>Slots</,
  "Pinned capacity must stay fixed at nine without a user-facing slot control.",
);
assert.match(screen, /setOptimisticShowcased\(next\)/);
assert.match(screen, /setOptimisticPinnedBadgeIds\(next\)/);
assert.match(
  screen,
  /setOptimisticShowcased\(next\);[\s\S]{0,120}setTimeout\(/,
  "Showcase feedback must render before deferred settings persistence.",
);
assert.match(
  screen,
  /setOptimisticPinnedBadgeIds\(next\);[\s\S]{0,120}setTimeout\(/,
  "Pin feedback must render before deferred settings persistence.",
);
assert.match(screen, /title="Award groups"/);
assert.ok(
  screen.indexOf('title="People"') > screen.indexOf("{sections.length ?"),
  "People, tracker, and award-group filters must sit after the badge sections.",
);
assert.match(
  screen,
  /earned: false,[\s\S]*progress: false,[\s\S]*locked: false,[\s\S]*recurring: false/,
  "Every status section must begin collapsed.",
);
assert.match(
  screen,
  /if \(next\.length === 1\)[\s\S]*earned: only === "earned"[\s\S]*recurring: only === "recurring"/,
  "The sole remaining status filter must expand immediately.",
);
assert.doesNotMatch(
  screen,
  />Highest-XP badges</,
  "Pinned badges must replace the old highest-XP summary.",
);
assert.doesNotMatch(screen, />Badge design</);
assert.match(screen, /style=\{styles\.pinnedRemove\}/);
assert.match(
  screen,
  /pinnedRemove: \{[\s\S]*position: "absolute",[\s\S]*top: 1,[\s\S]*right: 1/,
);
assert.match(
  screen,
  /<View\s+key=\{badge\.id\}[\s\S]{0,1000}<Pressable[\s\S]{0,220}accessibilityLabel=\{`Unpin \$\{badge\.title\}`\}[\s\S]{0,220}onPress=\{\(\) => unpinBadge\(badge\.id\)\}/,
  "Pinned badge tiles must be inert while their top-right X owns unpinning.",
);
assert.equal(
  (screen.match(/unpinBadge\(badge\.id\)/g) ?? []).length,
  1,
  "Only the pinned badge X may invoke unpinning.",
);
assert.match(
  screen,
  /accessibilityLabel=\{\s*isShowcased \? "Remove from showcase" : "Add to showcase"/,
  "Earned badge cards need a direct showcase control.",
);
for (const aim of [
  "milestones",
  "streaks",
  "today",
  "previous-leaders",
  "leaders",
  "records",
  "consistency",
  "challenges",
]) {
  assert.ok(
    screen.includes(`id: "${aim}"`),
    `Badge aim group ${aim} must remain visible in the cabinet.`,
  );
}
assert.match(
  screen,
  /badgeXpCopy\(badge\)/,
  "Every badge card must explain its earned or available XP.",
);
assert.match(
  domain,
  /id: `consistency-days:\$\{member\.id\}`[\s\S]*title: "Consistency builder"/,
  "The supported consistency achievement must remain in the catalogue.",
);
assert.match(domain, /title: "Best comeback"/);
assert.match(alerts, /<BadgeMedallion[\s\S]*trackerIcon=\{trackerIcon\}/);
assert.match(profile, /<BadgeMedallion[\s\S]*trackerIcon=/);
assert.match(screen, /useBadgeChallengeInputs\(/);
assert.match(alerts, /useBadgeChallengeInputs\(/);
assert.match(
  challengeInputs,
  /settledChallengeResults\.placements[\s\S]*publicChallengePlacements/,
  "Every badge surface must combine immutable group settlements with joined public-challenge placements.",
);
assert.match(
  challengeInputs,
  /\[publicPlacementChallengeKey\]/,
  "Public challenge standings must use a stable request key instead of refetching on catalogue object refreshes.",
);

console.log(
  "Badge cabinet validation passed: shared visuals, optimistic actions, bottom filters, collapsed status groups, and fixed nine-pin X-only removal are wired.",
);
