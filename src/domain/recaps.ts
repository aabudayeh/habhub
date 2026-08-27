import {
  AppState,
  MetricDefinition,
  NutritionDetails,
  PhotoUpdate,
} from "@/src/types";
import { dateKey, dateRangeEnding, friendlyDate } from "./date";
import { memberDisplayName } from "./members";
import {
  dailyScore,
  formatMetricValue,
  safeMetricValue,
  trackedGoalSummary,
} from "./metrics";
import { performanceOverview } from "./performance";
import { estimateLevelWalkingFromSteps } from "./health";

export type RecapScope = "personal" | "group";

export type RecapStory = {
  id: string;
  scope: RecapScope;
  eyebrow: string;
  title: string;
  stat: string;
  body: string;
  icon: string;
  color: string;
};

export type RecapFeedKind =
  | "log"
  | "meal"
  | "workout"
  | "photo"
  | "leader"
  | "badge";

export type RecapFeedItem = {
  id: string;
  kind: RecapFeedKind;
  localDate: string;
  createdAt: string;
  memberId?: string;
  metricId?: string;
  eyebrow: string;
  title: string;
  body: string;
  value?: string;
  icon: string;
  color: string;
  image?: PhotoUpdate["uri"];
  nutrition?: NutritionDetails;
  socialTarget: {
    type: "recap_feed" | "metric_entry" | "photo_update" | "badge";
    id: string;
  };
  deepLink?: {
    pathname: string;
    params?: Record<string, string>;
  };
};

function meaningfulFeedEntry(
  metric: MetricDefinition,
  entry: AppState["entries"][number],
) {
  if (entry.visibility !== "group") return false;
  if (entry.source === "calculated") return false;
  const note = `${entry.label ?? ""} ${entry.note ?? ""}`.toLowerCase();
  if (/estimated unrecorded|passive walking|from step difference/.test(note))
    return false;
  // High-frequency ambient readings belong in charts, not a social feed.
  if (
    ["steps", "pulse", "heart_rate", "active_energy", "total_energy"].includes(
      metric.id,
    ) &&
    !entry.label &&
    !entry.note &&
    !entry.imageUri
  )
    return false;
  return (
    entry.source === "manual" ||
    Boolean(entry.label || entry.note || entry.imageUri || entry.nutrition) ||
    metric.healthMapping?.dataType === "workouts" ||
    metric.category === "gym"
  );
}

/**
 * Builds a privacy-safe, deterministic feed from content already authorized in
 * the local group projection. It never manufactures detail rows from compact
 * daily totals, so a recap cannot bypass per-entry visibility.
 */
export function buildGroupRecapFeed(
  state: AppState,
  dates: readonly string[],
  badgeItems: readonly {
    id: string;
    memberId?: string;
    anchorDate: string;
    title: string;
    caption: string;
    description: string;
    icon: string;
    color: string;
    status: string;
  }[] = [],
): RecapFeedItem[] {
  const dateSet = new Set(dates);
  const groupMetricIds = new Set(
    (state.group.metricConfiguration ?? [])
      .filter((metric) => metric.sections.group)
      .map((metric) => metric.id),
  );
  const metrics = new Map(
    state.metrics
      .filter((metric) => groupMetricIds.has(metric.id))
      .map((metric) => [metric.id, metric]),
  );
  const items: RecapFeedItem[] = [];
  for (const entry of state.entries) {
    if (!dateSet.has(entry.localDate)) continue;
    const metric = metrics.get(entry.metricId);
    if (!metric || !meaningfulFeedEntry(metric, entry)) continue;
    const member = state.group.members.find((item) => item.id === entry.userId);
    if (!member) continue;
    const memberName = memberDisplayName(state, member);
    const workout =
      metric.healthMapping?.dataType === "workouts" ||
      metric.category === "gym" ||
      /workout|walk|run|cycle|swim|gym/.test(
        `${entry.label ?? ""} ${entry.note ?? ""}`.toLowerCase(),
      );
    const meal = metric.id === "food" || Boolean(entry.nutrition);
    const label = entry.label?.trim() || entry.note?.trim();
    const value =
      typeof entry.value === "number"
        ? formatMetricValue(metric, entry.value)
        : typeof entry.value === "boolean"
          ? entry.value
            ? "Completed"
            : "Not completed"
          : String(entry.value || "Logged");
    items.push({
      id: `entry:${entry.id}`,
      kind: meal ? "meal" : workout ? "workout" : "log",
      localDate: entry.localDate,
      createdAt: entry.recordedAt,
      memberId: entry.userId,
      metricId: entry.metricId,
      eyebrow: meal ? "MEAL LOG" : workout ? "WORKOUT LOG" : "SHARED LOG",
      title: `${memberName} logged ${label || metric.name.toLowerCase()}`,
      body:
        label && label.toLowerCase() !== metric.name.toLowerCase()
          ? metric.name
          : meal
            ? entry.nutrition?.mealType
              ? `${entry.nutrition.mealType[0].toUpperCase()}${entry.nutrition.mealType.slice(1)}`
              : "Nutrition update"
            : workout
              ? "Workout activity"
              : "Shared group activity",
      value,
      icon: metric.icon,
      color: metric.color,
      image: entry.imageUri ? { uri: entry.imageUri } : undefined,
      nutrition: entry.nutrition,
      socialTarget: { type: "metric_entry", id: entry.id },
      deepLink: {
        pathname: "/leaderboard-detail",
        params: {
          period: "custom",
          anchor: entry.localDate,
          metrics: entry.metricId,
        },
      },
    });
  }
  for (const photo of state.photos) {
    if (photo.visibility !== "group" || !dateSet.has(photo.localDate)) continue;
    const member = state.group.members.find((item) => item.id === photo.userId);
    if (!member) continue;
    items.push({
      id: `photo:${photo.id}`,
      kind: "photo",
      localDate: photo.localDate,
      createdAt: photo.createdAt,
      memberId: photo.userId,
      eyebrow: "PHOTO UPDATE",
      title: `${memberDisplayName(state, member)} shared a photo`,
      body: photo.caption || "A moment from their day.",
      icon: "image-outline",
      color: member.color,
      image: photo.uri,
      socialTarget: { type: "photo_update", id: photo.id },
    });
  }
  for (const badge of badgeItems) {
    if (
      badge.status !== "earned" ||
      !badge.memberId ||
      !dateSet.has(badge.anchorDate)
    )
      continue;
    const member = state.group.members.find(
      (item) => item.id === badge.memberId,
    );
    if (!member) continue;
    items.push({
      id: `badge:${badge.id}:${badge.anchorDate}`,
      kind: "badge",
      localDate: badge.anchorDate,
      createdAt: `${badge.anchorDate}T23:59:00`,
      memberId: badge.memberId,
      eyebrow: "BADGE UNLOCKED",
      title: `${memberDisplayName(state, member)} earned ${badge.title}`,
      body: badge.description,
      value: badge.caption,
      icon: badge.icon,
      color: badge.color,
      socialTarget: {
        type: "badge",
        id: `${badge.id}:${badge.anchorDate}`,
      },
      deepLink: {
        pathname: "/badges",
        params: {
          anchor: badge.anchorDate,
          filter: "achievement",
          memberId: badge.memberId,
          highlight: badge.id,
        },
      },
    });
  }
  // One daily group headline gives the feed rhythm without duplicating every
  // live rank change or background health sample. Only evaluate dates with a
  // real group projection and cap headline work for year/all-time feeds; raw
  // entry/photo cards remain available throughout the selected range.
  const activeDates = new Set([
    ...state.entries
      .filter(
        (entry) =>
          entry.visibility === "group" && groupMetricIds.has(entry.metricId),
      )
      .map((entry) => entry.localDate),
    ...(state.dailyMetricStatuses ?? [])
      .filter(
        (status) =>
          status.groupId === state.group.id && status.visibility !== "private",
      )
      .map((status) => status.localDate),
  ]);
  const headlineDates = dates
    .filter((localDate) => activeDates.has(localDate))
    .slice(-45);
  for (const localDate of headlineDates) {
    const ranked = state.group.members
      .map((member) => ({
        member,
        score: dailyScore(state, member.id, localDate),
      }))
      .filter((row) => row.score > 0)
      .sort((left, right) => right.score - left.score);
    const leader = ranked[0];
    if (!leader) continue;
    items.push({
      id: `leader:${localDate}`,
      kind: "leader",
      localDate,
      createdAt: `${localDate}T23:58:00`,
      memberId: leader.member.id,
      eyebrow: "DAILY LEADER",
      title: `${memberDisplayName(state, leader.member)} led the board`,
      body:
        ranked.length > 1
          ? `${Math.max(0, Math.round(leader.score - ranked[1].score))} points ahead of second place.`
          : "The first score on the board—there is room for company.",
      value: `${Math.round(leader.score)}/100`,
      icon: "trophy-outline",
      color: leader.member.color,
      socialTarget: { type: "recap_feed", id: `leader:${localDate}` },
      deepLink: {
        pathname: "/group",
        params: { period: "custom", anchor: localDate },
      },
    });
  }
  const unique = new Map(items.map((item) => [item.id, item]));
  return [...unique.values()]
    .sort(
      (left, right) =>
        right.createdAt.localeCompare(left.createdAt) ||
        left.id.localeCompare(right.id),
    )
    .slice(0, 160);
}

function average(
  state: AppState,
  metric: MetricDefinition,
  userId: string,
  dates: string[],
) {
  return (
    dates.reduce(
      (sum, day) => sum + safeMetricValue(state, metric, userId, day),
      0,
    ) / Math.max(dates.length, 1)
  );
}

function total(
  state: AppState,
  metric: MetricDefinition,
  userId: string,
  dates: string[],
) {
  return dates.reduce(
    (sum, day) => sum + safeMetricValue(state, metric, userId, day),
    0,
  );
}

function deterministicShuffle(stories: RecapStory[], seed: string) {
  return [...stories].sort(
    (a, b) => hash(`${seed}:${a.id}`) - hash(`${seed}:${b.id}`),
  );
}

function hash(value: string) {
  let result = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    result ^= value.charCodeAt(index);
    result = Math.imul(result, 16777619);
  }
  return result >>> 0;
}

function signedChange(current: number, previous: number) {
  if (!previous) return undefined;
  return Math.round(((current - previous) / Math.abs(previous)) * 100);
}

export function buildRecapStories(
  state: AppState,
  scope: RecapScope,
  anchor = dateKey(),
): RecapStory[] {
  const current = dateRangeEnding(anchor, 7);
  const previous = dateRangeEnding(current[0], 8).slice(0, 7);
  const stories =
    scope === "personal"
      ? personalStories(state, current, previous)
      : groupStories(state, current, previous);
  return deterministicShuffle(stories, `${anchor}:${scope}`).slice(0, 8);
}

function personalStories(
  state: AppState,
  current: string[],
  previous: string[],
): RecapStory[] {
  const userId = state.currentUserId;
  const stories: RecapStory[] = [];
  const steps = state.metrics.find((metric) => metric.id === "steps");
  const exercise = state.metrics.find((metric) => metric.id === "exercise");
  const food = state.metrics.find((metric) => metric.id === "food");
  const protein = state.metrics.find((metric) => metric.id === "protein");
  const perfect = current.filter(
    (day) => trackedGoalSummary(state, userId, day).allMet,
  ).length;
  const goalTotals = current.map((day) =>
    trackedGoalSummary(state, userId, day),
  );
  const met = goalTotals.reduce((sum, item) => sum + item.met, 0);
  const possible = goalTotals.reduce((sum, item) => sum + item.total, 0);
  const scores = current
    .map((day) => ({ day, value: dailyScore(state, userId, day) }))
    .sort((a, b) => b.value - a.value);

  if (steps) {
    const stepAverage = average(state, steps, userId, current);
    const priorAverage = average(state, steps, userId, previous);
    const stepTotal = total(state, steps, userId, current);
    const change = signedChange(stepAverage, priorAverage);
    const walkingProfile =
      state.energyProfiles?.[userId] ?? state.settings.energyProfile;
    const km = estimateLevelWalkingFromSteps(
      stepTotal,
      walkingProfile,
    ).distanceKm;
    stories.push({
      id: "personal-steps",
      scope: "personal",
      eyebrow: "YOUR 7-DAY RECAP",
      title: "You kept moving",
      stat: `${Math.round(stepAverage).toLocaleString()} steps/day`,
      body:
        change === undefined
          ? `${km.toFixed(1)} estimated kilometres this week.`
          : `${Math.abs(change)}% ${change >= 0 ? "more" : "less"} than last week · about ${km.toFixed(1)} km.`,
      icon: steps.icon,
      color: steps.color,
    });
    stories.push({
      id: "personal-distance",
      scope: "personal",
      eyebrow: "DISTANCE UNLOCKED",
      title: "Put it in perspective",
      stat: `${(km / 42.195).toFixed(1)} marathons`,
      body: `Your ${Math.round(stepTotal).toLocaleString()} steps add up to roughly ${km.toFixed(1)} km.`,
      icon: "map-outline",
      color: "#3274D9",
    });
  }
  stories.push({
    id: "personal-goals",
    scope: "personal",
    eyebrow: "GOAL CHECK",
    title: perfect ? "Perfect days happened" : "Every check counts",
    stat: `${perfect}/7 all-goal days`,
    body: `${met} of ${possible} individual tracked goals completed across the week.`,
    icon: "checkmark-done-outline",
    color: "#9B6BDB",
  });
  stories.push({
    id: "personal-score",
    scope: "personal",
    eyebrow: "BEST DAY",
    title: friendlyDate(scores[0]?.day ?? current[6]),
    stat: `${Math.round(scores[0]?.value ?? 0)}/100`,
    body: "Your highest configured HabHub score in this recap window.",
    icon: "sparkles-outline",
    color: "#6A5ACD",
  });
  if (exercise) {
    const value = total(state, exercise, userId, current);
    stories.push({
      id: "personal-exercise",
      scope: "personal",
      eyebrow: "ACTIVE ENERGY",
      title: "Energy invested",
      stat: formatMetricValue(exercise, value),
      body: "Total logged active energy across your last seven days.",
      icon: exercise.icon,
      color: exercise.color,
    });
  }
  if (food) {
    const value = average(state, food, userId, current);
    stories.push({
      id: "personal-food",
      scope: "personal",
      eyebrow: "NUTRITION RHYTHM",
      title: "Your daily average",
      stat: formatMetricValue(food, value),
      body: "Your activity-adjusted allowance is evaluated separately on each day.",
      icon: food.icon,
      color: food.color,
    });
  }
  if (protein) {
    const value = average(state, protein, userId, current);
    stories.push({
      id: "personal-protein",
      scope: "personal",
      eyebrow: "PROTEIN CHECK",
      title: "Weekly average",
      stat: formatMetricValue(protein, value),
      body: "A simple look at consistency—not a medical recommendation.",
      icon: protein.icon,
      color: protein.color,
    });
  }
  stories.push({
    id: "personal-consistency",
    scope: "personal",
    eyebrow: "SHOWING UP",
    title: "Seven days, one story",
    stat: `${Math.round(current.reduce((sum, day) => sum + dailyScore(state, userId, day), 0) / 7)}/100`,
    body: "Your average configured score for this rolling week.",
    icon: "calendar-outline",
    color: "#E9873F",
  });
  const performance = performanceOverview(state, 7);
  if (performance.strengths.length)
    stories.push({
      id: "personal-strengths",
      scope: "personal",
      eyebrow: "BIGGEST STRENGTH",
      title: performance.strengths[0].metric.name,
      stat: `${Math.round(performance.strengths[0].currentGoalRate * 100)}% goal rate`,
      body: "Your strongest goal-aligned area compared with your other selected trackers.",
      icon: "trending-up-outline",
      color: performance.strengths[0].metric.color,
    });
  if (performance.opportunities.length)
    stories.push({
      id: "personal-opportunity",
      scope: "personal",
      eyebrow: "NEXT BEST WIN",
      title: performance.opportunities[0].metric.name,
      stat: "Focus here",
      body: "This has the most room to improve based on your recent goal progress.",
      icon: "trail-sign-outline",
      color: performance.opportunities[0].metric.color,
    });
  return stories;
}

function groupStories(
  state: AppState,
  current: string[],
  previous: string[],
): RecapStory[] {
  const stories: RecapStory[] = [];
  const members = state.group.members;
  const scoreRows = members
    .map((member) => ({
      member,
      score:
        current.reduce(
          (sum, day) => sum + dailyScore(state, member.id, day),
          0,
        ) / 7,
    }))
    .sort((a, b) => b.score - a.score);
  stories.push({
    id: "group-champion",
    scope: "group",
    eyebrow: `${state.group.name.toUpperCase()} RECAP`,
    title: `${memberDisplayName(state, scoreRows[0].member)} leads the week`,
    stat: `${Math.round(scoreRows[0].score)}/100`,
    body: "Highest average configured group score over the last seven days.",
    icon: "trophy-outline",
    color: "#D8A126",
  });
  const tracked = (state.group.metricConfiguration ?? [])
    .filter(
      (metric) =>
        metric.scoreWeight > 0 &&
        metric.sections.group &&
        metric.dataType !== "text",
    )
    .slice(0, 5);
  tracked.forEach((metric) => {
    const rows = members
      .map((member) => ({
        member,
        value: average(state, metric, member.id, current),
      }))
      .sort((a, b) =>
        metric.rankingDirection === "lower"
          ? a.value - b.value
          : b.value - a.value,
      );
    stories.push({
      id: `group-${metric.id}`,
      scope: "group",
      eyebrow: `${metric.name.toUpperCase()} LEADER`,
      title: memberDisplayName(state, rows[0].member),
      stat: formatMetricValue(metric, rows[0].value),
      body: "Best daily average across the current seven-day recap.",
      icon: metric.icon,
      color: metric.color,
    });
  });
  const steps = state.metrics.find((metric) => metric.id === "steps");
  if (steps) {
    const groupSteps = members.reduce(
      (sum, member) => sum + total(state, steps, member.id, current),
      0,
    );
    const groupDistanceKm = estimateLevelWalkingFromSteps(
      groupSteps,
      70,
    ).distanceKm;
    stories.push({
      id: "group-distance",
      scope: "group",
      eyebrow: "TOGETHER",
      title: "The group went far",
      stat: `${Math.round(groupSteps).toLocaleString()} steps`,
      body: `Roughly ${groupDistanceKm.toFixed(1)} km combined—about ${(groupDistanceKm / 42.195).toFixed(1)} marathons.`,
      icon: "people-outline",
      color: steps.color,
    });
  }
  const improvements = members
    .map((member) => {
      const now =
        current.reduce(
          (sum, day) => sum + dailyScore(state, member.id, day),
          0,
        ) / 7;
      const before =
        previous.reduce(
          (sum, day) => sum + dailyScore(state, member.id, day),
          0,
        ) / 7;
      return { member, delta: now - before };
    })
    .sort((a, b) => b.delta - a.delta);
  stories.push({
    id: "group-comeback",
    scope: "group",
    eyebrow: "COMEBACK ENERGY",
    title: memberDisplayName(state, improvements[0].member),
    stat: `${improvements[0].delta >= 0 ? "+" : ""}${Math.round(improvements[0].delta)} pts`,
    body: "Largest score change compared with the previous seven days.",
    icon: "trending-up-outline",
    color: "#E65D58",
  });
  stories.push({
    id: "group-finish",
    scope: "group",
    eyebrow: "KEEP IT FRIENDLY",
    title: "The board resets every day",
    stat: `${members.length} friends`,
    body: "Cheer a win, share the work, and keep the competition moving.",
    icon: "chatbubbles-outline",
    color: "#3274D9",
  });
  return stories;
}
