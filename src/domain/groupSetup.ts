import { DEFAULT_METRICS } from "@/src/data/seed";
import {
  isBloodPressureDiastolic,
  isBloodPressureSystolic,
} from "@/src/domain/trackerCatalog";
import {
  MetricDefinition,
  NewMetric,
} from "@/src/types";

export const DEFAULT_GROUP_THEME = "#176B4D";

// Gold and yellow are intentionally absent because those colors communicate
// all-goals-complete celebrations elsewhere in the app.
export const GROUP_THEME_COLORS = [
  DEFAULT_GROUP_THEME,
  "#3478D4",
  "#7756D9",
  "#C45B35",
  "#9B3F72",
  "#2A8F86",
  "#59636E",
  "#B23A48",
] as const;

function slugify(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

export function newMetricFromDefinition(
  metric: MetricDefinition,
): NewMetric {
  return {
    templateId: metric.id,
    name: metric.name,
    icon: metric.icon,
    color: metric.color,
    unit: metric.unit,
    dataType: metric.dataType,
    aggregation: metric.aggregation,
    goal: { ...metric.goal },
    goalEnabled: metric.goalEnabled,
    goalRange: metric.goalRange ? { ...metric.goalRange } : undefined,
    category: metric.category,
    healthMapping: metric.healthMapping
      ? { ...metric.healthMapping }
      : undefined,
    gymMapping: metric.gymMapping ? { ...metric.gymMapping } : undefined,
    gymMuscleGroups: metric.gymMuscleGroups
      ? [...metric.gymMuscleGroups]
      : undefined,
    stepFallback: metric.stepFallback,
    manualEntry: metric.manualEntry,
    rankingDirection: metric.rankingDirection,
    defaultVisibility: metric.defaultVisibility,
    formula: metric.formula,
    goalSchedule: metric.goalSchedule
      ? { ...metric.goalSchedule }
      : undefined,
    reminder: metric.reminder ? { ...metric.reminder } : undefined,
    reminders: metric.reminders?.map((reminder) => ({ ...reminder })),
    activeFrom: metric.activeFrom,
  };
}

function withBloodPressureCompanion(metrics: NewMetric[]) {
  if (
    !metrics.some(isBloodPressureSystolic) ||
    metrics.some(isBloodPressureDiastolic)
  )
    return metrics;
  const companion = DEFAULT_METRICS.find(isBloodPressureDiastolic);
  return companion
    ? [...metrics, newMetricFromDefinition(companion)]
    : metrics;
}

export function groupMetricDefinitions(
  requested: NewMetric[],
  activeFrom: string,
): MetricDefinition[] {
  const used = new Set<string>();
  return withBloodPressureCompanion(requested).map((request, order) => {
    const base =
      slugify(request.templateId ?? request.name) || `group_tracker_${order + 1}`;
    let id = base;
    let suffix = 2;
    while (used.has(id)) id = `${base}_${suffix++}`;
    used.add(id);
    const internal = isBloodPressureDiastolic({
      id,
      healthMapping: request.healthMapping,
    });
    const competitive =
      request.goalEnabled !== false &&
      request.dataType !== "text" &&
      request.dataType !== "photo";
    const {
      templateId: _templateId,
      trackGoal: _trackGoal,
      ...definition
    } = request;
    return {
      ...definition,
      id,
      activeFrom: request.activeFrom ?? activeFrom,
      scoreWeight: internal || !competitive ? 0 : 10,
      sections: {
        today: false,
        insights: false,
        group: !internal,
      },
      order,
      defaultVisibility: "group",
    };
  });
}

