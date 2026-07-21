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
  safeMetricValue,
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
};

const labels: Record<BadgePeriod, string> = {
  today: "Selected day",
  yesterday: "Previous day",
  week: "7-day awards",
  month: "Month awards",
  achievement: "Achievements",
};

export function buildBadges(
  state: AppState,
  anchor = dateKey(),
): EarnedBadge[] {
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
            const result = leaderboardRows(
              state,
              [carb],
              [date],
              state.currentUserId,
              false,
            ).find((row) => row.member.id === member.id)?.metrics[0]?.result;
            return (
              result?.mode === "exact" &&
              result.average > 0 &&
              result.average <= 50
            );
          }).length,
        }))
        .sort((a, b) => b.days - a.days)[0]
    : undefined;
  return [
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
}
