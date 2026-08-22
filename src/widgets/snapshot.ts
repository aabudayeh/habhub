import {
  ALL_GOALS_COMPLETE_COLOR,
  GOAL_COMPLETE_COLOR,
} from "@/src/domain/colors";
import {
  completionIndicatorFillMode,
  completionIndicatorOption,
} from "@/src/domain/completionIndicators";
import { statusRangeRollup } from "@/src/domain/status";
import { todayHeroSummary } from "@/src/domain/todayHero";
import { localizeMetricName } from "@/src/i18n/domain";
import type { AppLanguage, AppState, StatusAvatarStyle } from "@/src/types";
import type {
  WidgetAvatarSnapshot,
  WidgetFeaturedSnapshot,
  WidgetGoalSnapshot,
} from "@/src/widgets";

type Translate = (source: string) => string;

export type WidgetSnapshotTheme = {
  backgroundColor: string;
  completedBackgroundColor: string;
};

export type WidgetAvatarVisual = {
  avatarUri?: string;
  avatarStyle: StatusAvatarStyle;
  heightScale: number;
};

function metricDeepLink(metricId: string, localDate: string) {
  return `paceboard://metric-detail?metric=${encodeURIComponent(metricId)}&date=${localDate}&period=today`;
}

function percentValue(progress: number, unavailable: boolean) {
  return unavailable ? "—" : `${Math.round(progress * 100)}%`;
}

function featuredSubtitle(
  summary: ReturnType<typeof todayHeroSummary>,
  translate: Translate,
) {
  if (summary.allMet)
    return translate(
      summary.usesGoals ? "Every goal reached" : "Every to-do complete",
    );
  if (summary.total > 0) {
    const remaining = summary.total - summary.met;
    const label = summary.usesGoals
      ? remaining === 1
        ? translate("goal left")
        : translate("goals left")
      : remaining === 1
        ? translate("to-do left")
        : translate("to-dos left");
    return `${remaining} ${label}`;
  }
  return translate(
    summary.usesGoals ? "Choose your first goal" : "No to-dos today",
  );
}

/** Builds the durable Featured widget from the same semantic summary as Today. */
export function featuredWidgetSnapshot(
  state: AppState,
  today: string,
  language: AppLanguage,
  translate: Translate,
  theme: WidgetSnapshotTheme,
): WidgetFeaturedSnapshot {
  const summary = todayHeroSummary(state, state.currentUserId, today);
  const fillMode = completionIndicatorFillMode(
    state.settings.completionIndicatorIcon,
    state.settings.completionIndicatorFillMode ?? "auto",
  );
  const completionIcon = completionIndicatorOption(
    state.settings.completionIndicatorIcon,
  ).icon;
  const activeColor = summary.allMet
    ? ALL_GOALS_COMPLETE_COLOR
    : GOAL_COMPLETE_COLOR;
  const baseEyebrow = translate(
    summary.allMet
      ? "DAY COMPLETE"
      : summary.usesGoals
        ? "TODAY'S FOCUS"
        : "To-Dos",
  );
  const todoSuffix =
    summary.usesGoals && summary.todos.length
      ? ` · ${summary.completedTodos}/${summary.todos.length} ${translate("To-Dos")}`
      : "";
  const goals: WidgetGoalSnapshot[] = summary.usesGoals
    ? summary.goalProgress.map((goal) => ({
        id: goal.id,
        title: localizeMetricName(language, goal.metric),
        value: percentValue(goal.progress, goal.unavailable),
        progress: goal.progress,
        met: goal.met,
        unavailable: goal.unavailable,
        color:
          summary.allMet && goal.met
            ? ALL_GOALS_COMPLETE_COLOR
            : GOAL_COMPLETE_COLOR,
        icon: goal.unavailable
          ? "remove"
          : goal.met
            ? "checkmark"
            : goal.metric.icon,
        deepLink: metricDeepLink(goal.id, today),
      }))
    : [];

  return {
    id: "__featured__",
    eyebrow: `${baseEyebrow}${todoSuffix}`,
    title: "HabHub",
    value: `${summary.met} ${translate("of")} ${summary.total}`,
    subtitle: featuredSubtitle(summary, translate),
    progress: summary.progress,
    color: activeColor,
    backgroundColor: summary.allMet
      ? theme.completedBackgroundColor
      : theme.backgroundColor,
    progressColor: activeColor,
    allComplete: summary.allMet,
    fillMode,
    showProgressOutline:
      state.settings.showFeaturedCardProgressOutline !== false,
    completionIcon,
    deepLink: "paceboard://status",
    goals,
  };
}

/** Builds Status widget rings in the same tracker order as the Status page. */
export function statusWidgetSnapshot(
  state: AppState,
  today: string,
  language: AppLanguage,
  theme: WidgetSnapshotTheme,
  visual: WidgetAvatarVisual,
): WidgetAvatarSnapshot {
  const summary = statusRangeRollup(state, state.currentUserId, [today]);
  const progress = Math.max(0, Math.min(1, summary.progress));
  const allComplete =
    summary.opportunities > 0 && summary.completed === summary.opportunities;
  const activeColor = allComplete
    ? ALL_GOALS_COMPLETE_COLOR
    : GOAL_COMPLETE_COLOR;
  const goals: WidgetGoalSnapshot[] = summary.metrics.map((rollup) => {
    const met =
      rollup.opportunities > 0 &&
      rollup.completed === rollup.opportunities;
    const goalProgress = Math.max(0, Math.min(1, rollup.progress));
    return {
      id: rollup.metric.id,
      title: localizeMetricName(language, rollup.metric),
      value: percentValue(goalProgress, rollup.opportunities === 0),
      progress: goalProgress,
      met,
      unavailable: rollup.opportunities === 0,
      color: met ? GOAL_COMPLETE_COLOR : rollup.metric.color,
      icon: met ? "checkmark" : rollup.metric.icon,
      deepLink: metricDeepLink(rollup.metric.id, today),
    };
  });

  return {
    id: "__avatar__",
    progress,
    color: activeColor,
    backgroundColor: allComplete
      ? theme.completedBackgroundColor
      : theme.backgroundColor,
    progressColor: activeColor,
    allComplete,
    fillMode: "bottom_up",
    deepLink: "paceboard://status",
    avatarUri: visual.avatarUri,
    avatarStyle: visual.avatarStyle,
    heightScale: visual.heightScale,
    goals,
  };
}
