const DAY_MS = 86_400_000;

export const WEEKDAYS = ['пн', 'вт', 'ср', 'чт', 'пт', 'сб', 'вс'];

export function toISODate(date: Date) {
  return date.toISOString().slice(0, 10);
}

export function fromISODate(value: string) {
  return new Date(`${value}T00:00:00.000Z`);
}

export function startOfWeek(date: Date) {
  const offset = (date.getUTCDay() + 6) % 7;
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() - offset));
}

export function addDays(date: Date, days: number) {
  return new Date(date.getTime() + days * DAY_MS);
}

export function parseWeekParam(param?: string) {
  if (param && /^\d{4}-\d{2}-\d{2}$/.test(param)) {
    const parsed = fromISODate(param);
    if (!Number.isNaN(parsed.getTime())) {
      return toISODate(startOfWeek(parsed));
    }
  }
  return toISODate(startOfWeek(new Date()));
}

export function weekDates(start: string) {
  const monday = fromISODate(start);
  return Array.from({ length: 7 }, (_, index) => toISODate(addDays(monday, index)));
}

const dayMonth = new Intl.DateTimeFormat('ru-RU', {
  day: 'numeric',
  month: 'long',
  timeZone: 'UTC',
});

const dayMonthYear = new Intl.DateTimeFormat('ru-RU', {
  day: 'numeric',
  month: 'long',
  year: 'numeric',
  timeZone: 'UTC',
});

const shortMonth = new Intl.DateTimeFormat('ru-RU', {
  month: 'short',
  timeZone: 'UTC',
});

export function formatWeekRange(start: string) {
  const monday = fromISODate(start);
  const sunday = addDays(monday, 6);
  return `${dayMonth.format(monday)} — ${dayMonthYear.format(sunday)}`;
}

export function formatDayNumber(date: string) {
  const value = fromISODate(date);
  return `${value.getUTCDate()} ${shortMonth.format(value).replace('.', '')}`;
}
