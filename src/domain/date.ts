export function dateKey(date = new Date()): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function dateKeyWithOffset(days: number): string {
  const date = new Date();
  date.setHours(12, 0, 0, 0);
  date.setDate(date.getDate() + days);
  return dateKey(date);
}

export function shortDay(date: string): string {
  return new Intl.DateTimeFormat(undefined, { weekday: 'short' }).format(new Date(`${date}T12:00:00`));
}

export function friendlyDate(date: string): string {
  if (date === dateKey()) return 'Today';
  if (date === dateKeyWithOffset(-1)) return 'Yesterday';
  return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(
    new Date(`${date}T12:00:00`),
  );
}

export function dateWithOffsetFrom(localDate: string, days: number): string {
  const date = new Date(`${localDate}T12:00:00`);
  date.setDate(date.getDate() + days);
  return dateKey(date);
}

export function dateRangeEnding(localDate: string, length: number): string[] {
  return Array.from({ length }, (_, index) => dateWithOffsetFrom(localDate, index - length + 1));
}

export function monthDateRange(localDate: string): string[] {
  const date = new Date(`${localDate}T12:00:00`);
  const days = new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
  return Array.from({ length: days }, (_, index) => dateKey(new Date(date.getFullYear(), date.getMonth(), index + 1, 12)));
}
