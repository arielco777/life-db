import type { DateRange } from '../repositories';
import type { Habit, ISODate } from '../types';
import { addDays, eachDay, endOfWeek, rangeLength, startOfWeek } from './dates';
import type { WeekStart } from './schedule';
import { aggregate, type ValuesByDate } from './targets';

/** One bar of a habit's chart (ANL-3): a day, or a week for long periods. */
export interface Bucket {
  /** First and last day the bucket covers, clipped to the period. */
  from: ISODate;
  to: ISODate;
  /** Roll-up of the values logged in the bucket; null when nothing was logged. */
  value: number | null;
}

/** Periods longer than this are charted by week, so a year is ~53 bars instead of 365. */
export const DAILY_LIMIT = 62;

/**
 * A habit's values over a period, ready to chart (ANL-3). One bucket per day, or per week
 * (respecting the week start) when the period is longer than {@link DAILY_LIMIT} days.
 * Weeks roll up like targets do: done days for yes/no habits, the sum for numbers and
 * durations, the average for ratings. Days after `today` are left empty.
 */
export function chartSeries(
  habit: Pick<Habit, 'type'>,
  values: ValuesByDate,
  range: DateRange,
  { weekStart, today }: { weekStart: WeekStart; today?: ISODate },
): { unit: 'day' | 'week'; buckets: Bucket[] } {
  const known = (d: ISODate) => (!today || d <= today ? values.get(d) : undefined);
  if (rangeLength(range) <= DAILY_LIMIT) {
    return {
      unit: 'day',
      buckets: eachDay(range).map((d) => ({ from: d, to: d, value: known(d) ?? null })),
    };
  }
  const buckets: Bucket[] = [];
  for (let start = startOfWeek(range.from, weekStart); start <= range.to; start = addDays(start, 7)) {
    const from = start < range.from ? range.from : start;
    const end = endOfWeek(start, weekStart);
    const to = end > range.to ? range.to : end;
    const logged = eachDay({ from, to })
      .map(known)
      .filter((v): v is number => v !== undefined);
    buckets.push({ from, to, value: logged.length ? aggregate(habit.type, logged) : null });
  }
  return { unit: 'week', buckets };
}
