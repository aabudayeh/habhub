import { AppState } from "@/src/types";

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
) {
  const allowance = Math.max(0, state.group.streakRestDaysPerWeek ?? 0);
  let longest = 0;
  let current = 0;
  let restUsed = 0;
  let week = "";
  for (const date of [...dates].sort()) {
    const nextWeek = weekKey(date);
    if (nextWeek !== week) {
      week = nextWeek;
      restUsed = 0;
    }
    if (met(date)) current += 1;
    else if (current > 0 && restUsed < allowance) {
      restUsed += 1;
      current += 1;
    } else current = 0;
    longest = Math.max(longest, current);
  }
  return { current, longest };
}

export function longestStreakWithRest(
  state: AppState,
  dates: string[],
  met: (date: string) => boolean,
) {
  return streaksWithRest(state, dates, met).longest;
}

export function currentStreakWithRest(
  state: AppState,
  dates: string[],
  met: (date: string) => boolean,
) {
  return streaksWithRest(state, dates, met).current;
}
