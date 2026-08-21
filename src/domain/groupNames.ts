const GROUP_NAME_SUGGESTIONS = [
  "Sunrise Striders",
  "The Daily High-Fives",
  "Momentum Makers",
  "Happy Pace Club",
  "Goal Getters",
  "Move More Crew",
  "Tiny Wins Team",
  "Weekend Wanderers",
  "The Steady Sprinters",
  "Better Together",
] as const;

/** A stable suggestion for one form opening; callers choose when to reroll. */
export function randomGroupNameSuggestion(random = Math.random) {
  const index = Math.min(
    GROUP_NAME_SUGGESTIONS.length - 1,
    Math.max(0, Math.floor(random() * GROUP_NAME_SUGGESTIONS.length)),
  );
  return GROUP_NAME_SUGGESTIONS[index];
}

export function groupNameSuggestions() {
  return [...GROUP_NAME_SUGGESTIONS];
}
