import { MetricDefinition } from "@/src/types";

export function defaultReminderTimes(metric: Pick<MetricDefinition, "id" | "category">) {
  if (metric.id === "food") return ["08:30", "13:30", "19:30"];
  if (metric.id === "steps") return ["12:30", "18:30"];
  if (["exercise", "workout", "workout_duration"].includes(metric.id))
    return ["17:30"];
  if (metric.id === "water") return ["10:00", "14:00", "18:00"];
  if (metric.id === "sleep") return ["21:30"];
  if (metric.category === "mind") return ["19:00"];
  return ["19:00"];
}
