import { dateWithOffsetFrom } from "./date";
import { AppState } from "../types";

export type CyclePhase = "menstrual" | "follicular" | "ovulation estimate" | "luteal" | "unknown";
export type CycleForecast = {
  phase: CyclePhase;
  cycleDay: number;
  averageCycleDays: number;
  averagePeriodDays: number;
  nextPeriodStart?: string;
  daysUntilPeriod?: number;
  observedCycles: number;
  confidence: "default" | "learning" | "personalized";
};

function dayDifference(from: string, to: string) {
  return Math.round((new Date(`${to}T12:00:00`).getTime() - new Date(`${from}T12:00:00`).getTime()) / 86400000);
}

export function periodWindows(state: AppState, userId: string) {
  const days = [...new Set(state.entries
    .filter((entry) => entry.userId === userId && entry.metricId === "menstrual_cycle" && Number(entry.value) > 0)
    .map((entry) => entry.localDate))].sort();
  return days.reduce<{ start: string; end: string; days: number }[]>((windows, day) => {
    const previous = windows.at(-1);
    if (previous && dayDifference(previous.end, day) === 1) {
      previous.end = day;
      previous.days += 1;
    } else windows.push({ start: day, end: day, days: 1 });
    return windows;
  }, []);
}

export function cycleForecast(state: AppState, userId: string, date: string): CycleForecast {
  const windows = periodWindows(state, userId).filter((window) => window.start <= date);
  const lengths = windows.slice(1).map((window, index) => dayDifference(windows[index].start, window.start)).filter((days) => days >= 15 && days <= 60).slice(-6);
  const observedCycles = lengths.length;
  const averageCycleDays = observedCycles >= 3 ? Math.round(lengths.reduce((sum, days) => sum + days, 0) / observedCycles) : 28;
  const completedPeriods = windows.filter((window) => window.end < date).slice(-6);
  const averagePeriodDays = completedPeriods.length ? Math.round(completedPeriods.reduce((sum, window) => sum + window.days, 0) / completedPeriods.length) : 5;
  const latest = windows.at(-1);
  if (!latest) return { phase: "unknown", cycleDay: 0, averageCycleDays, averagePeriodDays, observedCycles, confidence: "default" };
  const elapsed = Math.max(0, dayDifference(latest.start, date));
  const cycleDay = elapsed + 1;
  const predictedStart = dateWithOffsetFrom(latest.start, averageCycleDays);
  const daysUntilPeriod = dayDifference(date, predictedStart);
  const ovulationDay = Math.max(averagePeriodDays + 1, averageCycleDays - 14);
  const phase: CyclePhase = elapsed < averagePeriodDays ? "menstrual" : cycleDay >= ovulationDay - 1 && cycleDay <= ovulationDay + 1 ? "ovulation estimate" : cycleDay < ovulationDay - 1 ? "follicular" : "luteal";
  return {
    phase, cycleDay, averageCycleDays, averagePeriodDays,
    nextPeriodStart: predictedStart,
    daysUntilPeriod,
    observedCycles,
    confidence: observedCycles >= 3 ? "personalized" : observedCycles ? "learning" : "default",
  };
}
