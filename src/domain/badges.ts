import { Ionicons } from "@expo/vector-icons";

import {
  calendarWeekRange,
  dateKey,
  dateRangeEnding,
  dateWithOffsetFrom,
  monthDateRange,
  yearDateRange,
} from "@/src/domain/date";
import {
  leaderboardRows,
  periodMetricResult,
} from "@/src/domain/leaderboard";
import {
  dailyScore,
  formatMetricValue,
  metricPeriodStats,
  trackedGoalSummary,
} from "@/src/domain/metrics";
import {
  type ResolvedChallengePlacement,
  resolvedGroupChallengePlacements,
} from "@/src/domain/groupChallenges";
import { memberDisplayName } from "@/src/domain/members";
import { palette } from "@/src/theme";
import { AppState, GroupChallenge, MetricDefinition } from "@/src/types";

export type BadgePeriod =
  | "today"
  | "yesterday"
  | "week"
  | "month"
  | "year"
  | "achievement";
export type BadgeStatus = "earned" | "progress" | "locked" | "recurring";
export type BadgeCategory =
  | "competition"
  | "goal"
  | "streak"
  | "consistency"
  | "record"
  | "comeback";
export type BadgeAim =
  | "milestones"
  | "streaks"
  | "today"
  | "previous-leaders"
  | "leaders"
  | "records"
  | "consistency"
  | "challenges";
export type BadgeFrame = "crest" | "medallion" | "shield" | "burst";
export type EarnedBadge = {
  id: string;
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  owner: string;
  memberId?: string;
  caption: string;
  description: string;
  color: string;
  period: BadgePeriod;
  periodLabel: string;
  anchorDate: string;
  metricId?: string;
  earnedCount?: number;
  nextTarget?: number;
  status: BadgeStatus;
  category: BadgeCategory;
  progress?: { current: number; target: number };
};

export type BadgeLevelSummary = {
  xp: number;
  level: number;
  levelTitle: string;
  levelProgress: number;
  levelStartXp: number;
  nextLevelXp: number;
  earned: number;
  active: number;
  locked: number;
  recurring: number;
  challengeWins: number;
  nextBadge?: EarnedBadge;
  topEarnedBadges: { badge: EarnedBadge; xp: number }[];
};

export type BadgeXpSummary = {
  earned: number;
  available: number;
};

export type BadgeVisualSpec = {
  frame: BadgeFrame;
  primaryIcon: EarnedBadge["icon"];
  accentIcon: EarnedBadge["icon"];
};

const LEVEL_TITLES = [
  "Starting out",
  "Building rhythm",
  "Finding momentum",
  "Goal keeper",
  "Consistency maker",
  "Habit builder",
  "Momentum leader",
  "Goal specialist",
  "HabHub veteran",
] as const;

const BADGE_XP_WEIGHTS = {
  "goal-count:": 10,
  "perfect-days:": 30,
  "check-ins:": 5,
  "streak-progress:": 3,
  "challenge-wins:": 100,
  "challenge-seconds:": 60,
  "challenge-thirds:": 35,
  "challenge-finishes:": 15,
  "consistency-days:": 12,
} as const;

function badgeXpWeight(badge: EarnedBadge) {
  if (badge.id.startsWith("personal-best:")) return 75;
  return (
    Object.entries(BADGE_XP_WEIGHTS).find(([prefix]) =>
      badge.id.replace(/^earned:/, "").startsWith(prefix),
    )?.[1] ?? 0
  );
}

/**
 * Returns the cumulative XP represented by an earned badge card. Milestone
 * copies encode their reached counter in the final id segment, while personal
 * records are one-off awards. Live/recurring positions intentionally stay at
 * zero so losing a lead can never remove level XP.
 */
export function earnedBadgeXp(badge: EarnedBadge) {
  let sourceId = badge.id;
  let count = Math.max(0, badge.earnedCount ?? 0);
  if (sourceId.startsWith("earned:")) {
    const milestoneSeparator = sourceId.lastIndexOf(":");
    const milestone = Number(sourceId.slice(milestoneSeparator + 1));
    sourceId = sourceId.slice("earned:".length, milestoneSeparator);
    count = Number.isFinite(milestone) ? Math.max(0, milestone) : count;
  }
  if (sourceId.startsWith("personal-best:")) return 75;
  const weighted = Object.entries(BADGE_XP_WEIGHTS).find(([prefix]) =>
    sourceId.startsWith(prefix),
  );
  return weighted ? count * weighted[1] : 0;
}

/** XP already represented by a badge and the remaining XP at its next tier. */
export function badgeXpSummary(badge: EarnedBadge): BadgeXpSummary {
  const earned = earnedBadgeXp(badge);
  const weight = badgeXpWeight(badge);
  const current = Math.max(0, badge.progress?.current ?? badge.earnedCount ?? 0);
  const target = Math.max(current, badge.progress?.target ?? current);
  return {
    earned,
    available:
      badge.status === "earned" && !badge.progress
        ? 0
        : Math.max(0, target - current) * weight,
  };
}

export function badgeAim(badge: EarnedBadge): BadgeAim {
  if (badge.id.startsWith("challenge-")) return "challenges";
  if (badge.category === "record") return "records";
  if (badge.category === "streak") return "streaks";
  if (badge.period === "today" || badge.id === "live") return "today";
  if (badge.period === "yesterday" || badge.id === "yesterday")
    return "previous-leaders";
  if (badge.category === "competition") return "leaders";
  if (badge.category === "consistency" || badge.category === "comeback")
    return "consistency";
  return "milestones";
}

/**
 * One composable visual language for every award. Tracker awards put the
 * tracker glyph in the centre and the achievement motif in the corner.
 */
export function badgeVisualSpec(
  badge: EarnedBadge,
  trackerIcon?: EarnedBadge["icon"],
): BadgeVisualSpec {
  const aim = badgeAim(badge);
  if (aim === "records") {
    return {
      frame: "burst",
      primaryIcon: trackerIcon ?? badge.icon,
      accentIcon: "star",
    };
  }
  if (aim === "challenges") {
    return {
      frame: "shield",
      primaryIcon: badge.icon,
      accentIcon: "flag",
    };
  }
  if (aim === "previous-leaders") {
    return {
      frame: "medallion",
      primaryIcon: "medal",
      accentIcon: "checkmark",
    };
  }
  if (aim === "today" || aim === "leaders") {
    return {
      frame: "crest",
      primaryIcon: trackerIcon ?? badge.icon,
      accentIcon: aim === "today" ? "flash" : "trophy",
    };
  }
  if (aim === "streaks") {
    return {
      frame: "burst",
      primaryIcon: trackerIcon ?? badge.icon,
      accentIcon: "flame",
    };
  }
  if (aim === "consistency") {
    return {
      frame: "medallion",
      primaryIcon: badge.icon,
      accentIcon: badge.category === "comeback" ? "trending-up" : "repeat",
    };
  }
  return {
    frame: "shield",
    primaryIcon: trackerIcon ?? badge.icon,
    accentIcon: "checkmark",
  };
}

/**
 * Picks three useful starter pins while preferring trackers selected during
 * onboarding. Explicitly persisted pins (including an empty list) supersede
 * this suggestion in the UI.
 */
export function defaultPinnedBadgeIds(
  badges: readonly EarnedBadge[],
  memberId: string,
  preferredMetricIds: readonly string[],
  limit = 3,
) {
  const preferred = new Set(preferredMetricIds);
  const candidates = badges
    .filter((badge) => badge.memberId === memberId)
    .sort((left, right) => {
      const statusScore = (badge: EarnedBadge) =>
        badge.status === "earned"
          ? 4
          : badge.status === "progress"
            ? 3
            : badge.status === "recurring"
              ? 2
              : 1;
      return (
        Number(Boolean(right.metricId && preferred.has(right.metricId))) -
          Number(Boolean(left.metricId && preferred.has(left.metricId))) ||
        statusScore(right) - statusScore(left) ||
        earnedBadgeXp(right) - earnedBadgeXp(left) ||
        right.anchorDate.localeCompare(left.anchorDate)
      );
    });
  const selected: EarnedBadge[] = [];
  const add = (badge?: EarnedBadge) => {
    if (badge && !selected.some((item) => item.id === badge.id))
      selected.push(badge);
  };
  add(candidates.find((badge) => badgeAim(badge) === "records"));
  add(
    candidates.find(
      (badge) =>
        badge.metricId &&
        preferred.has(badge.metricId) &&
        badgeAim(badge) === "milestones",
    ),
  );
  add(
    candidates.find((badge) =>
      ["challenges", "consistency", "previous-leaders"].includes(
        badgeAim(badge),
      ),
    ),
  );
  for (const candidate of candidates) {
    if (selected.length >= limit) break;
    const aim = badgeAim(candidate);
    add(
      selected.some((badge) => badgeAim(badge) === aim) &&
        candidates.length > limit
        ? undefined
        : candidate,
    );
  }
  for (const candidate of candidates) {
    if (selected.length >= limit) break;
    add(candidate);
  }
  return selected.slice(0, limit).map((badge) => badge.id);
}

/**
 * A stable, easy-to-explain motivation score derived from badge counters.
 * It deliberately ignores live leaderboard positions so XP never falls when
 * another member overtakes the user. Canonical counters are counted once;
 * their visual milestone copies are excluded to avoid double rewards.
 */
export function badgeLevelSummary(
  badges: readonly EarnedBadge[],
  memberId: string,
): BadgeLevelSummary {
  const owned = badges.filter(
    (badge) => badge.memberId === memberId && badge.period === "achievement",
  );
  const canonical = owned.filter((badge) => !badge.id.startsWith("earned:"));
  const countFor = (prefix: string) =>
    canonical
      .filter((badge) => badge.id.startsWith(prefix))
      .reduce((sum, badge) => sum + Math.max(0, badge.earnedCount ?? 0), 0);
  const personalRecords = canonical.filter((badge) =>
    badge.id.startsWith("personal-best:"),
  ).length;
  const challengeWins = countFor("challenge-wins:");
  const xp = Math.round(
    countFor("goal-count:") * 10 +
      countFor("perfect-days:") * 30 +
      countFor("check-ins:") * 5 +
      countFor("streak-progress:") * 3 +
      challengeWins * 100 +
      countFor("challenge-seconds:") * 60 +
      countFor("challenge-thirds:") * 35 +
      countFor("challenge-finishes:") * 15 +
      countFor("consistency-days:") * 12 +
      personalRecords * 75,
  );
  // Quadratic levels keep early rewards close together while leaving useful
  // headroom for long-running accounts without an arbitrary maximum level.
  const level = Math.max(1, Math.floor(Math.sqrt(xp / 250)) + 1);
  const levelStartXp = Math.pow(level - 1, 2) * 250;
  const nextLevelXp = Math.pow(level, 2) * 250;
  const levelProgress = Math.min(
    1,
    Math.max(0, (xp - levelStartXp) / Math.max(1, nextLevelXp - levelStartXp)),
  );
  const nextBadge = canonical
    .filter((badge) => badge.progress && badge.progress.target > 0)
    .sort((left, right) => {
      const leftRemaining = left.progress!
        ? (left.progress!.target - left.progress!.current) /
          left.progress!.target
        : 1;
      const rightRemaining = right.progress!
        ? (right.progress!.target - right.progress!.current) /
          right.progress!.target
        : 1;
      return leftRemaining - rightRemaining;
    })[0];
  const topEarnedBadges = owned
    .filter((badge) => badge.status === "earned")
    .map((badge) => ({ badge, xp: earnedBadgeXp(badge) }))
    .filter((item) => item.xp > 0)
    .sort(
      (left, right) =>
        right.xp - left.xp ||
        right.badge.anchorDate.localeCompare(left.badge.anchorDate) ||
        left.badge.title.localeCompare(right.badge.title),
    )
    .slice(0, 3);
  return {
    xp,
    level,
    levelTitle:
      LEVEL_TITLES[Math.min(level - 1, LEVEL_TITLES.length - 1)] ??
      "HabHub veteran",
    levelProgress,
    levelStartXp,
    nextLevelXp,
    earned: owned.filter((badge) => badge.status === "earned").length,
    active: owned.filter((badge) => badge.status === "progress").length,
    locked: owned.filter((badge) => badge.status === "locked").length,
    recurring: owned.filter((badge) => badge.status === "recurring").length,
    challengeWins,
    nextBadge,
    topEarnedBadges,
  };
}

const labels: Record<BadgePeriod, string> = {
  today: "Selected day",
  yesterday: "Previous day",
  week: "Week awards",
  month: "Month awards",
  year: "Year awards",
  achievement: "Achievements",
};

const BADGE_MILESTONES = [1, 3, 7, 14, 30, 50, 100, 250, 500, 1000];

function nextMilestone(count: number) {
  return BADGE_MILESTONES.find((target) => target > count);
}

function reachedMilestone(count: number) {
  return [...BADGE_MILESTONES].reverse().find((target) => target <= count);
}

function badgeProgress(
  count: number,
  target = nextMilestone(count),
): EarnedBadge["progress"] {
  return target ? { current: count, target } : undefined;
}

function milestoneStatus(count: number): BadgeStatus {
  if (count <= 0) return "locked";
  return nextMilestone(count) ? "progress" : "earned";
}

type BadgeCache = {
  anchor: string;
  today: string;
  challenges: readonly GroupChallenge[];
  externalChallengePlacements: readonly ResolvedChallengePlacement[];
  settledChallengeOccurrenceKeys?: readonly string[];
  group: AppState["group"];
  metrics: AppState["metrics"];
  entries: AppState["entries"];
  statuses: AppState["dailyMetricStatuses"];
  trackedGoals: AppState["trackedGoalPeriods"];
  energyProfiles: AppState["energyProfiles"];
  gymSessions: AppState["gymSessions"];
  photos: AppState["photos"];
  energyProfile: AppState["settings"]["energyProfile"];
  weightDirection: AppState["settings"]["weightDirection"];
  baselineCalories: number;
  foodGoalMode: AppState["settings"]["foodGoalMode"];
  vacationPeriods: AppState["settings"]["vacationPeriods"];
  todos: AppState["todos"];
  personalRestDays: AppState["settings"]["streakRestDaysPerWeek"];
  weekStartsOn: AppState["settings"]["weekStartsOn"];
  dayEndTime: AppState["settings"]["dayEndTime"];
  currentUserId: string;
  result: EarnedBadge[];
};

let badgeCache: BadgeCache | undefined;
const EMPTY_GROUP_CHALLENGES: readonly GroupChallenge[] = [];
const EMPTY_CHALLENGE_PLACEMENTS: readonly ResolvedChallengePlacement[] = [];

export function buildBadges(
  state: AppState,
  anchor = dateKey(),
  challenges: readonly GroupChallenge[] = EMPTY_GROUP_CHALLENGES,
  today = dateKey(),
  externalChallengePlacements: readonly ResolvedChallengePlacement[] =
    EMPTY_CHALLENGE_PLACEMENTS,
  settledChallengeOccurrenceKeys?: readonly string[],
): EarnedBadge[] {
  if (
    badgeCache?.anchor === anchor &&
    badgeCache.today === today &&
    badgeCache.challenges === challenges &&
    badgeCache.externalChallengePlacements === externalChallengePlacements &&
    badgeCache.settledChallengeOccurrenceKeys ===
      settledChallengeOccurrenceKeys &&
    badgeCache.group === state.group &&
    badgeCache.metrics === state.metrics &&
    badgeCache.entries === state.entries &&
    badgeCache.statuses === state.dailyMetricStatuses &&
    badgeCache.trackedGoals === state.trackedGoalPeriods &&
    badgeCache.energyProfiles === state.energyProfiles &&
    badgeCache.gymSessions === state.gymSessions &&
    badgeCache.photos === state.photos &&
    badgeCache.energyProfile === state.settings.energyProfile &&
    badgeCache.weightDirection === state.settings.weightDirection &&
    badgeCache.baselineCalories === state.settings.baselineCalories &&
    badgeCache.foodGoalMode === state.settings.foodGoalMode &&
    badgeCache.vacationPeriods === state.settings.vacationPeriods &&
    badgeCache.todos === state.todos &&
    badgeCache.personalRestDays === state.settings.streakRestDaysPerWeek &&
    badgeCache.weekStartsOn === state.settings.weekStartsOn &&
    badgeCache.dayEndTime === state.settings.dayEndTime &&
    badgeCache.currentUserId === state.currentUserId
  )
    return badgeCache.result;
  const metrics = (state.group.metricConfiguration ?? []).filter(
    (metric) =>
      metric.scoreWeight > 0 &&
      metric.sections.group &&
      metric.dataType !== "text" &&
      metric.dataType !== "photo",
  );
  const yesterday = dateWithOffsetFrom(anchor, -1);
  const week = calendarWeekRange(
    anchor,
    state.settings.weekStartsOn ?? 1,
  ).filter((date) => date <= anchor);
  const month = monthDateRange(anchor).filter((date) => date <= anchor);
  const year = yearDateRange(anchor).filter((date) => date <= anchor);
  const winner = (
    dates: string[],
    selected: MetricDefinition[] = metrics,
    score = true,
  ) => leaderboardRows(state, selected, dates, state.currentUserId, score)[0];
  const overall = (
    id: string,
    title: string,
    dates: string[],
    icon: EarnedBadge["icon"],
    color: string,
    period: BadgePeriod,
    caption: string,
    description: string,
  ): EarnedBadge => {
    const row = winner(dates);
    return {
      id,
      title,
      icon,
      color,
      period,
      periodLabel: labels[period],
      anchorDate: anchor,
      caption,
      description,
      memberId: row?.member.id,
      owner: row ? memberDisplayName(state, row.member) : "Up for grabs",
      status: "recurring",
      category: "competition",
    };
  };
  const ranges: {
    key: Exclude<BadgePeriod, "achievement">;
    dates: string[];
    label: string;
    caption: string;
  }[] = [
    {
      key: "today",
      dates: [anchor],
      label: "Selected day",
      caption: "Current leader",
    },
    {
      key: "yesterday",
      dates: [yesterday],
      label: "Previous day",
      caption: "Final daily winner",
    },
    {
      key: "week",
      dates: week,
      label: "This week",
      caption: "Current week leader",
    },
    { key: "month", dates: month, label: "Month", caption: "Month leader" },
    { key: "year", dates: year, label: "Year", caption: "Year leader" },
  ];
  const metricBadges = metrics.flatMap((metric) =>
    ranges.map((range): EarnedBadge => {
      const row = winner(range.dates, [metric], false);
      return {
        id: `${metric.id}-${range.key}`,
        metricId: metric.id,
        icon: metric.icon as EarnedBadge["icon"],
        title: `${metric.name} · ${range.label}`,
        owner: row ? memberDisplayName(state, row.member) : "Up for grabs",
        memberId: row?.member.id,
        caption: range.caption,
        description: `Best shared ${metric.name.toLowerCase()} result for ${range.label.toLowerCase()}.`,
        color: metric.color,
        period: range.key,
        periodLabel: labels[range.key],
        anchorDate: anchor,
        status: "recurring",
        category: "competition",
      };
    }),
  );
  const recent = dateRangeEnding(anchor, 3);
  const prior = dateRangeEnding(dateWithOffsetFrom(anchor, -3), 3);
  const comeback = state.group.members
    .map((member) => ({
      member,
      gain:
        recent.reduce(
          (sum, date) => sum + dailyScore(state, member.id, date),
          0,
        ) /
          3 -
        prior.reduce(
          (sum, date) => sum + dailyScore(state, member.id, date),
          0,
        ) /
          3,
    }))
    .sort((a, b) => b.gain - a.gain)[0];
  const goalMachine = state.group.members
    .map((member) => ({
      member,
      count: week.filter(
        (date) =>
          trackedGoalSummary(
            state,
            member.id,
            date,
            metrics.map((metric) => metric.id),
          ).allMet,
      ).length,
    }))
    .sort((a, b) => b.count - a.count)[0];
  const streakBadges = metrics.map((metric): EarnedBadge => {
    const contenders = state.group.members
      .map((member) => {
        const streak =
          periodMetricResult(
            state,
            metric,
            member.id,
            state.currentUserId,
            [anchor],
          ).streak ?? 0;
        return { member, streak };
      })
      .sort((a, b) => b.streak - a.streak);
    const best = contenders[0];
    return {
      id: `${metric.id}-streak`,
      metricId: metric.id,
      icon: "flame",
      title: `${metric.name} streak`,
      owner: best?.streak
        ? memberDisplayName(state, best.member)
        : "Not yet earned",
      memberId: best?.streak ? best.member.id : undefined,
      caption: `${best?.streak ?? 0} days in a row`,
      description: `Longest current streak for the ${metric.name} goal. This award adapts automatically when the goal changes.`,
      color: metric.color,
      period: "achievement",
      periodLabel: labels.achievement,
      anchorDate: anchor,
      status: "recurring",
      category: "streak",
    };
  });
  const carb = state.metrics.find((metric) => metric.id === "carbs");
  const keto = carb
    ? state.group.members
        .map((member) => ({
          member,
          days: week.filter((date) => {
            const foodLogged = state.entries.some(
              (entry) =>
                entry.userId === member.id &&
                entry.metricId === "food" &&
                entry.localDate === date &&
                Number(entry.value) > 0 &&
                (entry.userId === state.currentUserId ||
                  entry.visibility !== "private"),
            );
            const result = leaderboardRows(
              state,
              [carb],
              [date],
              state.currentUserId,
              false,
            ).find((row) => row.member.id === member.id)?.metrics[0]?.result;
            return (
              foodLogged &&
              result?.mode === "exact" &&
              result.average > 0 &&
              result.average <= 50
            );
          }).length,
        }))
        .sort((a, b) => b.days - a.days)[0]
    : undefined;
  const achievementDates = dateRangeEnding(anchor, 365);
  const achievementDateSet = new Set(achievementDates);
  const groupMetricIds = new Set(
    (state.group.metricConfiguration ?? [])
      .filter((metric) => metric.sections.group)
      .map((metric) => metric.id),
  );
  if (groupMetricIds.has("food")) {
    [
      "protein",
      "fat",
      "carbs",
      "fiber",
      "sodium",
      "sugar",
      "saturated_fat",
      "cholesterol",
      "potassium",
      "calcium",
      "iron",
      "magnesium",
      "vitamin_c",
      "vitamin_d",
      "vitamin_b12",
    ].forEach((id) => groupMetricIds.add(id));
  }
  const entriesByMemberMetric = new Map<string, AppState["entries"]>();
  const checkInDatesByMember = new Map<string, Set<string>>();
  for (const entry of state.entries) {
    if (
      !achievementDateSet.has(entry.localDate) ||
      !groupMetricIds.has(entry.metricId) ||
      (entry.userId !== state.currentUserId && entry.visibility === "private")
    )
      continue;
    const key = `${entry.userId}\u0000${entry.metricId}`;
    const metricEntries = entriesByMemberMetric.get(key);
    if (metricEntries) metricEntries.push(entry);
    else entriesByMemberMetric.set(key, [entry]);
    const dates = checkInDatesByMember.get(entry.userId) ?? new Set<string>();
    dates.add(entry.localDate);
    checkInDatesByMember.set(entry.userId, dates);
  }
  const sharedGoalsByMemberDate = new Map<
    string,
    AppState["dailyMetricStatuses"]
  >();
  const sharedGoalsByMemberMetric = new Map<
    string,
    AppState["dailyMetricStatuses"]
  >();
  for (const status of state.dailyMetricStatuses ?? []) {
    if (
      status.groupId !== state.group.id ||
      status.goalEligible === false ||
      !achievementDateSet.has(status.localDate)
    )
      continue;
    const statusDateKey = `${status.userId}\u0000${status.localDate}`;
    const dateStatuses = sharedGoalsByMemberDate.get(statusDateKey);
    if (dateStatuses) dateStatuses.push(status);
    else sharedGoalsByMemberDate.set(statusDateKey, [status]);
    const metricKey = `${status.userId}\u0000${status.metricId}`;
    const metricStatuses = sharedGoalsByMemberMetric.get(metricKey);
    if (metricStatuses) metricStatuses.push(status);
    else sharedGoalsByMemberMetric.set(metricKey, [status]);
  }
  const goalMetrics = state.metrics.filter(
    (metric) =>
      groupMetricIds.has(metric.id) &&
      metric.goalEnabled !== false &&
      metric.dataType !== "text" &&
      metric.dataType !== "photo" &&
      metric.id !== "overall_score" &&
      metric.id !== "weekly_deficit_balance",
  );
  const trackerGoalBadges = state.group.members.flatMap((member) =>
    goalMetrics.map((metric): EarnedBadge => {
      const count =
        member.id === state.currentUserId
          ? metricPeriodStats(
              state,
              metric,
              member.id,
              achievementDates,
            ).goalsReached
          : (
              sharedGoalsByMemberMetric.get(
                `${member.id}\u0000${metric.id}`,
              ) ?? []
            ).filter((status) => status.goalReached).length;
      const nextTarget = nextMilestone(count);
      return {
        id: `goal-count:${member.id}:${metric.id}`,
        metricId: metric.id,
        icon: metric.icon as EarnedBadge["icon"],
        title: `${metric.name} goals`,
        owner: memberDisplayName(state, member),
        memberId: member.id,
        caption: `${count} earned`,
        description: nextTarget
          ? `Complete this goal ${nextTarget - count} more time${nextTarget - count === 1 ? "" : "s"} to reach the ${nextTarget}-completion milestone.`
          : "Top completion milestone reached.",
        earnedCount: count,
        nextTarget,
        progress: badgeProgress(count, nextTarget),
        status: milestoneStatus(count),
        category: "goal",
        color: metric.color,
        period: "achievement",
        periodLabel: labels.achievement,
        anchorDate: anchor,
      };
    }),
  );
  // Compute the two goal-quality awards in one bounded pass. This keeps the
  // richer catalogue from repeating 365 days of metric aggregation per card.
  const goalQualityByMember = new Map(
    state.group.members.map((member) => {
      let perfect = 0;
      let strong = 0;
      for (const day of achievementDates) {
        if (member.id === state.currentUserId) {
          const summary = trackedGoalSummary(state, member.id, day);
          if (summary.total > 0 && summary.allMet) perfect += 1;
          if (summary.total > 0 && summary.met / summary.total >= 0.75)
            strong += 1;
          continue;
        }
        const statuses =
          sharedGoalsByMemberDate.get(`${member.id}\u0000${day}`) ?? [];
        if (statuses.length === 0) continue;
        const met = statuses.filter((status) => status.goalReached).length;
        if (met === statuses.length) perfect += 1;
        if (met / statuses.length >= 0.75) strong += 1;
      }
      return [member.id, { perfect, strong }] as const;
    }),
  );
  const perfectDayBadges = state.group.members.map((member): EarnedBadge => {
    const count = goalQualityByMember.get(member.id)?.perfect ?? 0;
    const nextTarget = nextMilestone(count);
    return {
      id: `perfect-days:${member.id}`,
      icon: "sparkles",
      title: "All daily goals",
      owner: memberDisplayName(state, member),
      memberId: member.id,
      caption: `${count} perfect day${count === 1 ? "" : "s"}`,
      description: nextTarget
        ? `${nextTarget - count} more perfect day${nextTarget - count === 1 ? "" : "s"} until the ${nextTarget}-day milestone.`
        : "Top perfect-day milestone reached.",
      earnedCount: count,
      nextTarget,
      progress: badgeProgress(count, nextTarget),
      status: milestoneStatus(count),
      category: "goal",
      color: palette.lime,
      period: "achievement",
      periodLabel: labels.achievement,
      anchorDate: anchor,
    };
  });
  const checkInBadges = state.group.members.map((member): EarnedBadge => {
    const count = checkInDatesByMember.get(member.id)?.size ?? 0;
    const nextTarget = nextMilestone(count);
    return {
      id: `check-ins:${member.id}`,
      icon: "calendar-clear-outline",
      title: "Group check-ins",
      owner: memberDisplayName(state, member),
      memberId: member.id,
      caption: `${count} active day${count === 1 ? "" : "s"}`,
      description: nextTarget
        ? `Log a group tracker on ${nextTarget - count} more day${nextTarget - count === 1 ? "" : "s"} to reach the ${nextTarget}-day milestone.`
        : "Top check-in milestone reached.",
      earnedCount: count,
      nextTarget,
      progress: badgeProgress(count, nextTarget),
      status: milestoneStatus(count),
      category: "consistency",
      color: "#5A78C9",
      period: "achievement",
      periodLabel: labels.achievement,
      anchorDate: anchor,
    };
  });
  const consistencyBadges = state.group.members.map(
    (member): EarnedBadge => {
      const count = goalQualityByMember.get(member.id)?.strong ?? 0;
      const nextTarget = nextMilestone(count);
      return {
        id: `consistency-days:${member.id}`,
        icon: "repeat",
        title: "Consistency builder",
        owner: memberDisplayName(state, member),
        memberId: member.id,
        caption: `${count} strong day${count === 1 ? "" : "s"}`,
        description: nextTarget
          ? `Reach at least 75% of your shared goals on ${nextTarget - count} more day${nextTarget - count === 1 ? "" : "s"} for the ${nextTarget}-day milestone.`
          : "Top consistency milestone reached.",
        earnedCount: count,
        nextTarget,
        progress: badgeProgress(count, nextTarget),
        status: milestoneStatus(count),
        category: "consistency",
        color: "#2E9C8B",
        period: "achievement",
        periodLabel: labels.achievement,
        anchorDate: anchor,
      };
    },
  );
  const personalBestBadges = state.group.members.flatMap((member) =>
    goalMetrics.flatMap((metric): EarnedBadge[] => {
      if (
        metric.dataType !== "number" ||
        metric.rankingDirection !== "higher" ||
        metric.aggregation === "latest" ||
        metric.goalProgressMode === "journey"
      )
        return [];
      const visibleEntries = [
        ...(entriesByMemberMetric.get(`${member.id}\u0000${metric.id}`) ?? []),
      ]
        .filter(
          (entry) =>
            member.id === state.currentUserId || entry.visibility === "group",
        )
        .sort((a, b) => a.recordedAt.localeCompare(b.recordedAt));
      const byDate = new Map<string, number[]>();
      for (const entry of visibleEntries) {
        const value =
          entry.value === true
            ? 1
            : entry.value === false
              ? 0
              : Number(entry.value);
        if (!Number.isFinite(value)) continue;
        byDate.set(entry.localDate, [
          ...(byDate.get(entry.localDate) ?? []),
          value,
        ]);
      }
      const dailyValues = [...byDate.entries()].map(([date, values]) => {
        const value =
          metric.aggregation === "average"
            ? values.reduce((sum, item) => sum + item, 0) / values.length
            : metric.aggregation === "max"
              ? Math.max(...values)
              : metric.aggregation === "min"
                ? Math.min(...values)
                : values.reduce((sum, item) => sum + item, 0);
        return { date, value };
      });
      const best = dailyValues.sort((left, right) => right.value - left.value)[0];
      if (!best || best.value <= 0) return [];
      return [
        {
          id: `personal-best:${member.id}:${metric.id}`,
          metricId: metric.id,
          icon: "star",
          title: `${metric.name} personal best`,
          owner: memberDisplayName(state, member),
          memberId: member.id,
          caption: formatMetricValue(metric, best.value),
          description: `Highest shared daily ${metric.name.toLowerCase()} result, set ${best.date}.`,
          color: metric.color,
          period: "achievement",
          periodLabel: labels.achievement,
          anchorDate: best.date,
          status: "earned",
          category: "record",
        },
      ];
    }),
  );
  const streakMilestoneBadges = state.group.members.flatMap((member) =>
    goalMetrics.map((metric): EarnedBadge => {
      const result = periodMetricResult(
        state,
        metric,
        member.id,
        state.currentUserId,
        [anchor],
      );
      const streak = result.streak ?? 0;
      const bestStreak = result.bestStreak ?? streak;
      const nextTarget = nextMilestone(bestStreak);
      const reached = reachedMilestone(bestStreak);
      return {
        id: `streak-progress:${member.id}:${metric.id}`,
        metricId: metric.id,
        icon: "flame",
        title: `${metric.name} streak`,
        owner: memberDisplayName(state, member),
        memberId: member.id,
        caption: `${streak} current · ${bestStreak} best`,
        description: nextTarget
          ? `${nextTarget - bestStreak} more best-streak day${nextTarget - bestStreak === 1 ? "" : "s"} to reach the ${nextTarget}-day award.`
          : `Highest streak tier reached${reached ? ` at ${reached} days` : ""}.`,
        earnedCount: bestStreak,
        nextTarget,
        progress: badgeProgress(bestStreak, nextTarget),
        status: milestoneStatus(bestStreak),
        category: "streak",
        color: metric.color,
        period: "achievement",
        periodLabel: labels.achievement,
        anchorDate: anchor,
      };
    }),
  );
  const resolvedChallengePlacements = [
    // Cloud outcomes come exclusively from the immutable server snapshot.
    // Undefined is reserved for the credential-free local/demo model.
    ...(settledChallengeOccurrenceKeys === undefined
      ? resolvedGroupChallengePlacements(
          state,
          challenges,
          anchor,
          today,
        )
      : []),
    ...externalChallengePlacements,
  ].filter(
    (challenge, index, allPlacements) =>
      allPlacements.findIndex(
        (candidate) =>
          candidate.challengeId === challenge.challengeId &&
          candidate.localDate === challenge.localDate,
      ) === index,
  );
  const challengesAtRank = (memberId: string, position?: number) =>
    resolvedChallengePlacements.filter((challenge) =>
      challenge.placements.some(
        (placement) =>
          placement.memberId === memberId &&
          (position === undefined ||
            placement.standingPosition === position),
      ),
    );
  const challengeWinsFor = (memberId: string) =>
    resolvedChallengePlacements.filter((challenge) =>
      challenge.placements.some(
        (placement) =>
          placement.memberId === memberId && placement.winner === true,
      ),
    );
  const challengeWinBadges = state.group.members.map((member): EarnedBadge => {
    const memberWins = challengeWinsFor(member.id);
    const count = memberWins.length;
    const nextTarget = nextMilestone(count);
    return {
      id: `challenge-wins:${member.id}`,
      icon: "trophy",
      title: "Challenge wins",
      owner: memberDisplayName(state, member),
      memberId: member.id,
      caption:
        count === 1 ? `${count} challenge win` : `${count} challenge wins`,
      description: count
        ? "Each finished challenge counts once, including a tied first place."
        : "Finish a friend challenge in first place to earn this badge.",
      earnedCount: count,
      nextTarget,
      progress: badgeProgress(count, nextTarget),
      status: count > 0 ? "earned" : "locked",
      category: "competition",
      color: palette.amber,
      period: "achievement",
      periodLabel: labels.achievement,
      anchorDate: memberWins[0]?.localDate ?? anchor,
    };
  });
  const challengeRankBadges = state.group.members.flatMap(
    (member): EarnedBadge[] => {
      const finishes = challengesAtRank(member.id);
      const seconds = challengesAtRank(member.id, 2);
      const thirds = challengesAtRank(member.id, 3);
      const rankBadge = (
        id: string,
        icon: EarnedBadge["icon"],
        title: string,
        matches: typeof finishes,
        description: string,
        color: string,
      ): EarnedBadge => {
        const count = matches.length;
        const nextTarget = nextMilestone(count);
        return {
          id: `${id}:${member.id}`,
          icon,
          title,
          owner: memberDisplayName(state, member),
          memberId: member.id,
          caption: `${count} ${count === 1 ? "challenge" : "challenges"}`,
          description,
          earnedCount: count,
          nextTarget,
          progress: badgeProgress(count, nextTarget),
          status: count > 0 ? "earned" : "locked",
          category: "competition",
          color,
          period: "achievement",
          periodLabel: labels.achievement,
          anchorDate: matches[0]?.localDate ?? anchor,
        };
      };
      return [
        rankBadge(
          "challenge-seconds",
          "medal",
          "Challenge runner-up",
          seconds,
          "Second place earns a 60 XP rank bonus.",
          "#A7AFBD",
        ),
        rankBadge(
          "challenge-thirds",
          "ribbon",
          "Challenge third place",
          thirds,
          "Third place earns a 35 XP rank bonus.",
          "#B97943",
        ),
        rankBadge(
          "challenge-finishes",
          "flag",
          "Challenge finishes",
          finishes,
          "Every finalized rank earns 15 XP; podium bonuses stack on top.",
          palette.blue,
        ),
      ];
    },
  );
  const earnedMilestoneBadges = [
    ...trackerGoalBadges,
    ...perfectDayBadges,
    ...checkInBadges,
    ...consistencyBadges,
    ...streakMilestoneBadges,
  ].flatMap((badge): EarnedBadge[] => {
    const reached = reachedMilestone(badge.earnedCount ?? 0);
    if (!reached || badge.status === "earned") return [];
    return [
      {
        ...badge,
        id: `earned:${badge.id}:${reached}`,
        title: `${badge.title} · ${reached}`,
        caption: `${reached}-completion milestone`,
        description: `Earned by reaching the ${reached} milestone. Keep going to unlock the next tier.`,
        status: "earned",
        progress: undefined,
        nextTarget: undefined,
      },
    ];
  });
  const result: EarnedBadge[] = [
    overall(
      "live",
      "Live overall leader",
      [anchor],
      "flash",
      palette.lime,
      "today",
      "Current overall lead",
      "Highest normalized group score for the selected day.",
    ),
    overall(
      "yesterday",
      "Previous-day champion",
      [yesterday],
      "medal",
      palette.amber,
      "yesterday",
      "Final overall winner",
      "Highest normalized score on the day before the selected date.",
    ),
    overall(
      "week",
      "Week champion",
      week,
      "trophy",
      palette.blue,
      "week",
      "Best score this week",
      "Highest average normalized score in the current calendar week.",
    ),
    overall(
      "month",
      "Month leader",
      month,
      "ribbon",
      palette.purple,
      "month",
      "Current monthly lead",
      "Highest average normalized score in the selected month.",
    ),
    ...metricBadges,
    ...perfectDayBadges,
    ...checkInBadges,
    ...consistencyBadges,
    ...trackerGoalBadges,
    ...streakBadges,
    ...streakMilestoneBadges,
    ...personalBestBadges,
    ...challengeWinBadges,
    ...challengeRankBadges,
    ...earnedMilestoneBadges,
    {
      id: "comeback",
      icon: "trending-up",
      title: "Best comeback",
      color: "#E56B4B",
      period: "achievement",
      periodLabel: labels.achievement,
      anchorDate: anchor,
      owner: comeback
        ? memberDisplayName(state, comeback.member)
        : "Keep moving",
      memberId: comeback?.member.id,
      caption: `${Math.max(0, Math.round(comeback?.gain ?? 0))} point surge`,
      description:
        "Largest three-day score improvement versus the prior three days.",
      status:
        (comeback?.gain ?? 0) > 0 ? "earned" : "locked",
      category: "comeback",
    },
    {
      id: "goals",
      icon: "checkmark-done",
      title: "Goal machine",
      color: palette.primary,
      period: "achievement",
      periodLabel: labels.achievement,
      anchorDate: anchor,
      owner: goalMachine
        ? memberDisplayName(state, goalMachine.member)
        : "Up for grabs",
      memberId: goalMachine?.member.id,
      caption: `${goalMachine?.count ?? 0}/7 perfect days`,
      description: `Most all-goal days this week. Up to ${state.group.streakRestDaysPerWeek} rest day${state.group.streakRestDaysPerWeek === 1 ? "" : "s"} may preserve streaks.`,
      status: "recurring",
      category: "competition",
    },
    ...(groupMetricIds.has("food")
      ? [
          {
            id: "keto",
            icon: "leaf" as const,
            title: "Low-carb week",
            color: "#4C8B3B",
            period: "achievement" as const,
            periodLabel: labels.achievement,
            anchorDate: anchor,
            owner:
              (keto?.days ?? 0) > 0 && keto
                ? memberDisplayName(state, keto.member)
                : "Not yet earned",
            memberId: (keto?.days ?? 0) > 0 ? keto?.member.id : undefined,
            caption: `${keto?.days ?? 0}/7 logged days at ≤50g carbs`,
            description:
              "Logged food and stayed at or below 50g of carbohydrates on all seven days.",
            progress: { current: keto?.days ?? 0, target: 7 },
            status:
              (keto?.days ?? 0) >= 7
                ? ("earned" as const)
                : (keto?.days ?? 0) > 0
                  ? ("progress" as const)
                  : ("locked" as const),
            category: "consistency" as const,
          },
        ]
      : []),
  ];
  badgeCache = {
    anchor,
    today,
    challenges,
    externalChallengePlacements,
    settledChallengeOccurrenceKeys,
    group: state.group,
    metrics: state.metrics,
    entries: state.entries,
    statuses: state.dailyMetricStatuses,
    trackedGoals: state.trackedGoalPeriods,
    energyProfiles: state.energyProfiles,
    gymSessions: state.gymSessions,
    photos: state.photos,
    energyProfile: state.settings.energyProfile,
    weightDirection: state.settings.weightDirection,
    baselineCalories: state.settings.baselineCalories,
    foodGoalMode: state.settings.foodGoalMode,
    vacationPeriods: state.settings.vacationPeriods,
    todos: state.todos,
    personalRestDays: state.settings.streakRestDaysPerWeek,
    weekStartsOn: state.settings.weekStartsOn,
    dayEndTime: state.settings.dayEndTime,
    currentUserId: state.currentUserId,
    result,
  };
  return result;
}
