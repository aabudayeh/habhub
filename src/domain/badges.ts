import { Ionicons } from "@expo/vector-icons";

import {
  dateKey,
  dateRangeEnding,
  dateWithOffsetFrom,
  monthDateRange,
} from "@/src/domain/date";
import { leaderboardRows } from "@/src/domain/leaderboard";
import {
  dailyScore,
  effectiveGoalTarget,
  goalReached,
  metricApplicableOnDate,
  safeMetricValue,
  scheduledGoalReached,
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
  | "achievement";
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
};

const labels: Record<BadgePeriod, string> = {
  today: "Selected day",
  yesterday: "Previous day",
  week: "7-day awards",
  month: "Month awards",
  achievement: "Achievements",
};

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
  const week = dateRangeEnding(anchor, 7);
  const month = monthDateRange(anchor).filter((date) => date <= anchor);
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
    { key: "week", dates: week, label: "7 days", caption: "7-day winner" },
    { key: "month", dates: month, label: "Month", caption: "Month leader" },
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
        let streak = 0;
        for (let offset = 0; offset < 90; offset++) {
          const day = dateWithOffsetFrom(anchor, -offset);
          if (
            goalReached(
              metric,
              safeMetricValue(state, metric, member.id, day),
              effectiveGoalTarget(state, metric, member.id, day),
            )
          )
            streak++;
          else break;
        }
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
                Number(entry.value) > 0,
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
  const milestone = (count: number) =>
    [1, 3, 7, 14, 30, 50, 100, 250, 500, 1000].find((target) => target > count);
  const achievementDates = dateRangeEnding(anchor, 365);
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
      const count = achievementDates.filter(
        (day) =>
          metric.activeFrom <= day &&
          metricApplicableOnDate(state, metric, member.id, day) &&
          scheduledGoalReached(state, metric, member.id, day),
      ).length;
      const nextTarget = milestone(count);
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
        color: metric.color,
        period: "achievement",
        periodLabel: labels.achievement,
        anchorDate: anchor,
      };
    }),
  );
  const perfectDayBadges = state.group.members.map((member): EarnedBadge => {
    const count = achievementDates.filter((day) => {
      const summary = trackedGoalSummary(state, member.id, day);
      return summary.total > 0 && summary.allMet;
    }).length;
    const nextTarget = milestone(count);
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
      color: palette.lime,
      period: "achievement",
      periodLabel: labels.achievement,
      anchorDate: anchor,
    };
  });
  const checkInBadges = state.group.members.map((member): EarnedBadge => {
    const count = new Set(
      state.entries
        .filter(
          (entry) =>
            entry.userId === member.id &&
            achievementDates.includes(entry.localDate) &&
            groupMetricIds.has(entry.metricId),
        )
        .map((entry) => entry.localDate),
    ).size;
    const nextTarget = milestone(count);
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
      color: "#5A78C9",
      period: "achievement",
      periodLabel: labels.achievement,
      anchorDate: anchor,
    };
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
      "7-day champion",
      week,
      "trophy",
      palette.blue,
      "week",
      "Best 7-day score",
      "Highest average normalized score across the selected seven days.",
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
    ...trackerGoalBadges,
    ...streakBadges,
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
    },
    {
      id: "keto",
      icon: "leaf",
      title: "Keto week",
      color: "#4C8B3B",
      period: "achievement",
      periodLabel: labels.achievement,
      anchorDate: anchor,
      owner:
        (keto?.days ?? 0) >= 7 && keto
          ? memberDisplayName(state, keto.member)
          : "Not yet earned",
      memberId: (keto?.days ?? 0) >= 7 ? keto?.member.id : undefined,
      caption: `${keto?.days ?? 0}/7 days at ≤50g carbs`,
      description:
        "Logged no more than 50g of carbohydrates on all seven days.",
    },
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
    currentUserId: state.currentUserId,
    result,
  };
  return result;
}
