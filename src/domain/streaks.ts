import { AppState } from "@/src/types";
import { isVacationDate } from "@/src/domain/vacation";

function weekKey(localDate: string) {
  const date = new Date(`${localDate}T12:00:00`);
  const day = (date.getDay() + 6) % 7;
  date.setDate(date.getDate() - day);
  return date.toISOString().slice(0, 10);
}

function streaksWithRest(
  state: AppState,
  dates: string[],
  met: (date: string) => boolean,
  userId = state.currentUserId,
  scope: "personal" | "group" = "personal",
) {
  const allowance = Math.max(
    0,
    scope === "group"
      ? (state.group.streakRestDaysPerWeek ?? 0)
      : (state.settings.streakRestDaysPerWeek ?? 0),
  );
  let longest = 0;
  let current = 0;
  let restUsed = 0;
  let week = "";
  let currentStart = "";
  let best: { days: number; from: string; to: string } | undefined;
  for (const date of [...dates].sort()) {
    const nextWeek = weekKey(date);
    if (nextWeek !== week) {
      week = nextWeek;
      restUsed = 0;
    }
    if (isVacationDate(state, userId, date) || met(date)) {
      if (!current) currentStart = date;
      current += 1;
    } else if (current > 0 && restUsed < allowance) {
      restUsed += 1;
      current += 1;
    } else {
      current = 0;
      currentStart = "";
    }
    longest = Math.max(longest, current);
    if (current && (!best || current > best.days))
      best = { days: current, from: currentStart, to: date };
  }
  return { current, longest, best };
}

export function longestStreakWithRest(
  state: AppState,
  dates: string[],
  met: (date: string) => boolean,
  userId?: string,
  scope?: "personal" | "group",
) {
  return streaksWithRest(state, dates, met, userId, scope).longest;
}

export function currentStreakWithRest(
  state: AppState,
  dates: string[],
  met: (date: string) => boolean,
  userId?: string,
  scope?: "personal" | "group",
) {
  return streaksWithRest(state, dates, met, userId, scope).current;
}

export function bestStreakPeriodWithRest(
  state: AppState,
  dates: string[],
  met: (date: string) => boolean,
  userId?: string,
  scope?: "personal" | "group",
) {
  return streaksWithRest(state, dates, met, userId, scope).best;
}
