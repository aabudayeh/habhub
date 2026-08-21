import { dateKey, dateRangeEnding } from "@/src/domain/date";
import { AppState } from "@/src/types";

export const VACATION_COLOR = "#E76FA8";

export function isVacationDate(
  state: AppState,
  userId: string,
  localDate: string,
) {
  if (userId !== state.currentUserId) return false;
  return (state.settings.vacationPeriods ?? []).some(
    (period) =>
      period.from <= localDate && (!period.to || localDate <= period.to),
  );
}

export function vacationDates(
  state: AppState,
  userId: string,
  throughDate = dateKey(),
  limit = 730,
) {
  if (userId !== state.currentUserId) return [];
  return dateRangeEnding(throughDate, limit).filter((date) =>
    isVacationDate(state, userId, date),
  );
}
