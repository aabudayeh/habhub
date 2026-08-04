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
import { memberDisplayName } from "@/src/domain/members";
import { palette } from "@/src/theme";
import { AppState, MetricDefinition } from "@/src/types";

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

export function buildBadges(
  state: AppState,
  anchor = dateKey(),
): EarnedBadge[] {
  if (
    badgeCache?.anchor === anchor &&
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
  const perfectDayBadges = state.group.members.map((member): EarnedBadge => {
    const count = achievementDates.filter((day) => {
      if (member.id !== state.currentUserId) {
        const sharedGoals =
          sharedGoalsByMemberDate.get(`${member.id}\u0000${day}`) ?? [];
        return (
          sharedGoals.length > 0 &&
          sharedGoals.every((status) => status.goalReached)
        );
      }
      const summary = trackedGoalSummary(state, member.id, day);
      return summary.total > 0 && summary.allMet;
    }).length;
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
  const earnedMilestoneBadges = [
    ...trackerGoalBadges,
    ...perfectDayBadges,
    ...checkInBadges,
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
    overall(
      "year",
      "Year leader",
      year,
      "star",
      palette.purple,
      "year",
      "Current yearly lead",
      "Highest average normalized score in the selected calendar year.",
    ),
    ...metricBadges,
    ...perfectDayBadges,
    ...checkInBadges,
    ...trackerGoalBadges,
    ...streakBadges,
    ...streakMilestoneBadges,
    ...personalBestBadges,
    ...earnedMilestoneBadges,
    {
      id: "comeback",
      icon: "trending-up",
      title: "Comeback",
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
