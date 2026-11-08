import type { DateRange } from '../repositories';
import type { Habit, ISODate } from '../types';
import { eachDay, intersect, startOfWeek, addDays, rangeLength, weekdayOf } from './dates';

type Schedulable = Pick<Habit, 'frequency' | 'startDate' | 'endDate'>;
export type WeekStart = 'mon' | 'sun';

/** The habit exists on this date (between its start and optional end date). */
export const isActiveOn = (habit: Schedulable, date: ISODate): boolean =>
  date >= habit.startDate && (!habit.endDate || date <= habit.endDate);

/** The part of `range` during which the habit is active, or null. */
export const activeRange = (habit: Schedulable, range: DateRange): DateRange | null =>
  intersect(range, { from: habit.startDate, to: habit.endDate ?? '9999-12-31' });

/**
 * HAB-5. Daily habits are scheduled every active day; weekday habits only on their days.
 * "N times per week" habits can be done on any active day (their goal is weekly), so every
 * active day counts as scheduled.
 */
export function isScheduled(habit: Schedulable, date: ISODate): boolean {
  if (!isActiveOn(habit, date)) return false;
  const f = habit.frequency;
  return f.type === 'weekdays' ? f.days.includes(weekdayOf(date)) : true;
}

/** Scheduled dates inside `range` (HAB-5). */
export function scheduledDays(habit: Schedulable, range: DateRange): ISODate[] {
  const active = activeRange(habit, range);
  return active ? eachDay(active).filter((d) => isScheduled(habit, d)) : [];
}

/** One week of a range, clipped to the range and to the habit's active dates. */
export interface WeekSlice {
  /** First day of the calendar week (may be before the range). */
  weekStart: ISODate;
  /** Days of this week that are inside the range and active. */
  days: ISODate[];
}

/** Splits a range into calendar weeks (by `weekStart`), keeping only active days. */
export function weeksOf(habit: Schedulable, range: DateRange, weekStart: WeekStart): WeekSlice[] {
  const active = activeRange(habit, range);
  if (!active) return [];
  const out: WeekSlice[] = [];
  for (let ws = startOfWeek(active.from, weekStart); ws <= active.to; ws = addDays(ws, 7)) {
    const days = intersect(active, { from: ws, to: addDays(ws, 6) });
    if (days) out.push({ weekStart: ws, days: eachDay(days) });
  }
  return out;
}

/**
 * Expected completions for a "N times per week" habit in one (possibly partial) week:
 * a full week expects N; a partial week expects N prorated by its active days, rounded,
 * never more than the days available.
 */
export const expectedForWeek = (count: number, activeDays: number): number =>
  activeDays >= 7 ? count : Math.min(activeDays, Math.round((count * activeDays) / 7));

/**
 * How many completions a boolean habit should have in `range` — the denominator of its
 * completion rate (ANL-1). Unscheduled days are excluded (HAB-5).
 */
export function expectedCompletions(habit: Schedulable, range: DateRange, weekStart: WeekStart): number {
  const f = habit.frequency;
  if (f.type !== 'times_per_week') return scheduledDays(habit, range).length;
  return weeksOf(habit, range, weekStart).reduce((n, w) => n + expectedForWeek(f.count, w.days.length), 0);
}

/** Number of active calendar days in a range (denominator for "per calendar day" averages). */
export const activeDayCount = (habit: Schedulable, range: DateRange): number => {
  const active = activeRange(habit, range);
  return active ? rangeLength(active) : 0;
};
