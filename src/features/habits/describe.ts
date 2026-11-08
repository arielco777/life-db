import type { Habit, HabitType, ISODate, Weekday } from '@/domain/types';
import { WEEKDAYS } from '@/domain/types';
import { diffDays } from '@/domain/services/dates';
import { formatValue } from '@/domain/services/format';

export const TYPE_LABELS: Record<HabitType, { label: string; hint: string }> = {
  boolean: { label: 'Checkbox', hint: 'Done or not, e.g. Exercise' },
  number: { label: 'Number', hint: 'An amount with a unit, e.g. 2.5 L of water' },
  duration: { label: 'Duration', hint: 'Time spent, e.g. 45 min of reading' },
  rating: { label: 'Rating', hint: 'A score on a scale, e.g. mood 8/10' },
};

export const WEEKDAY_SHORT: Record<Weekday, string> = {
  mon: 'Mon',
  tue: 'Tue',
  wed: 'Wed',
  thu: 'Thu',
  fri: 'Fri',
  sat: 'Sat',
  sun: 'Sun',
};

/** Weekdays in display order for the user's week start (SET-2). */
export const orderedWeekdays = (weekStart: 'mon' | 'sun'): Weekday[] =>
  weekStart === 'sun' ? ['sun', ...WEEKDAYS.slice(0, 6)] : [...WEEKDAYS];

/** "Daily", "Mon, Wed, Fri", "Weekdays", "3× a week". */
export function describeFrequency(f: Habit['frequency'], weekStart: 'mon' | 'sun' = 'mon'): string {
  switch (f.type) {
    case 'daily':
      return 'Daily';
    case 'times_per_week':
      return `${f.count}× a week`;
    case 'weekdays': {
      const set = new Set(f.days);
      if (set.size === 7) return 'Daily';
      if (set.size === 5 && !set.has('sat') && !set.has('sun')) return 'Weekdays';
      if (set.size === 2 && set.has('sat') && set.has('sun')) return 'Weekends';
      return orderedWeekdays(weekStart)
        .filter((d) => set.has(d))
        .map((d) => WEEKDAY_SHORT[d])
        .join(', ');
    }
  }
}

/** "At least 4× per week", "At most 2 cups per day", "At least an average of 7 per week". */
export function describeTarget(h: Pick<Habit, 'type' | 'unit' | 'ratingScale' | 'target'>): string | null {
  const t = h.target;
  if (!t) return null;
  const amount =
    h.type === 'boolean'
      ? `${t.value}×`
      : h.type === 'rating'
        ? `an average of ${formatValue(h, t.value, { compact: true })}`
        : formatValue(h, t.value);
  return `${t.op === 'at_least' ? 'At least' : 'At most'} ${amount} per ${t.period}`;
}

/** "Aug 14, 2026" for a calendar date, never time-zone shifted (NFR-11). */
export const formatDate = (d: ISODate, locale?: string, withYear = true): string =>
  new Date(`${d}T00:00:00Z`).toLocaleDateString(locale, {
    month: 'short',
    day: 'numeric',
    ...(withYear ? { year: 'numeric' } : {}),
    timeZone: 'UTC',
  });

export type RunState = 'upcoming' | 'running' | 'ended';

/** Where a habit is in its start/end window on `today`. */
export function runState(h: Pick<Habit, 'startDate' | 'endDate'>, today: ISODate): RunState {
  if (h.startDate > today) return 'upcoming';
  if (h.endDate && h.endDate < today) return 'ended';
  return 'running';
}

const days = (n: number) => (n === 1 ? '1 day' : `${n} days`);

/**
 * The habit's date window in words: "From Aug 14, 2026 · no end date",
 * "Aug 14, 2026 – Dec 31, 2026 · ends in 53 days", "… · ended", "Starts Sep 1, 2026 (in 5 days) · no end date".
 */
export function describeRun(
  h: Pick<Habit, 'startDate' | 'endDate'>,
  today: ISODate,
  locale?: string,
): string {
  const start = formatDate(h.startDate, locale);
  const state = runState(h, today);
  const startsIn = `in ${days(diffDays(today, h.startDate))}`;
  if (!h.endDate)
    return state === 'upcoming'
      ? `Starts ${start} (${startsIn}) · no end date`
      : `From ${start} · no end date`;
  const range = `${start} – ${formatDate(h.endDate, locale)}`;
  if (state === 'ended') return `${range} · ended`;
  if (state === 'upcoming') return `${range} · starts ${startsIn}`;
  const left = diffDays(today, h.endDate);
  return `${range} · ${left === 0 ? 'ends today' : `ends in ${days(left)}`}`;
}

/** Short note for list rows: "Ends Dec 31", "Ended Dec 31", "Starts Sep 1"; null when open-ended and running. */
export function runNote(
  h: Pick<Habit, 'startDate' | 'endDate'>,
  today: ISODate,
  locale?: string,
): string | null {
  const state = runState(h, today);
  if (state === 'upcoming') return `Starts ${formatDate(h.startDate, locale, false)}`;
  if (!h.endDate) return null;
  return `${state === 'ended' ? 'Ended' : 'Ends'} ${formatDate(h.endDate, locale, false)}`;
}
