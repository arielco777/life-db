import type { DateRange } from '../repositories';
import type { Habit, ISODate } from '../types';
import { addDays, addMonths, endOfMonth, intersect, monthOf, rangeLength } from './dates';
import {
  activeDayCount,
  activeRange,
  expectedCompletions,
  expectedForWeek,
  scheduledDays,
  weeksOf,
  type WeekStart,
} from './schedule';
import type { ValuesByDate } from './targets';

/**
 * Per-habit statistics over a period (ANL-1, MON-4). Always derived from entries, never
 * stored (ANL-5). Values are raw numbers; formatting lives in format.ts.
 */
export type HabitStats = BooleanStats | NumberStats | DurationStats | RatingStats;

export interface BooleanStats {
  type: 'boolean';
  /** Completions that count toward the rate (scheduled days; capped per week for N/week). */
  done: number;
  /** Completions the schedule asks for in the period (HAB-5). */
  expected: number;
  /** done / expected, 0–1; null when nothing was expected. */
  completion: number | null;
  currentStreak: number;
  longestStreak: number;
  /** Streaks count days, or weeks for "N times per week" habits. */
  streakUnit: 'day' | 'week';
}

interface Spread {
  daysLogged: number;
  min: number | null;
  max: number | null;
}

export interface NumberStats extends Spread {
  type: 'number';
  total: number | null;
  average: number | null;
}

export interface DurationStats extends Spread {
  type: 'duration';
  /** Total minutes (0 when nothing logged). */
  total: number;
  averagePerLoggedDay: number | null;
  /** Total spread over every active day of the period, logged or not. */
  averagePerCalendarDay: number | null;
}

export interface RatingStats extends Spread {
  type: 'rating';
  average: number | null;
}

export interface StatsOptions {
  weekStart: WeekStart;
  /**
   * The logical today (SET-4). Days after it are ignored so a running month isn't
   * penalised for the future, and an unlogged today doesn't break the current streak.
   */
  today?: ISODate;
}

type StatsHabit = Pick<Habit, 'type' | 'frequency' | 'startDate' | 'endDate'>;

export function computeStats(
  habit: StatsHabit,
  values: ValuesByDate,
  range: DateRange,
  opts: StatsOptions,
): HabitStats {
  const effective: DateRange | null =
    opts.today && opts.today < range.to ? intersect(range, { from: range.from, to: opts.today }) : range;
  const inRange = (d: ISODate) => !!effective && d >= effective.from && d <= effective.to;
  const logged = [...values.entries()]
    .filter(([d]) => inRange(d))
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([, v]) => v);

  if (habit.type === 'boolean') return booleanStats(habit, values, range, effective, opts);

  const spread: Spread = {
    daysLogged: logged.length,
    min: logged.length ? Math.min(...logged) : null,
    max: logged.length ? Math.max(...logged) : null,
  };
  const total = logged.reduce((a, b) => a + b, 0);
  const average = logged.length ? total / logged.length : null;

  switch (habit.type) {
    case 'number':
      return { type: 'number', ...spread, total: logged.length ? total : null, average };
    case 'rating':
      return { type: 'rating', ...spread, average };
    case 'duration': {
      const calendarDays = effective ? activeDayCount(habit, effective) : 0;
      return {
        type: 'duration',
        ...spread,
        total,
        averagePerLoggedDay: average,
        averagePerCalendarDay: calendarDays ? total / calendarDays : null,
      };
    }
  }
}

const isDone = (values: ValuesByDate, d: ISODate) => values.get(d) === 1;

function booleanStats(
  habit: StatsHabit,
  values: ValuesByDate,
  fullRange: DateRange,
  range: DateRange | null,
  { weekStart, today }: StatsOptions,
): BooleanStats {
  const f = habit.frequency;
  if (!range || !activeRange(habit, range)) {
    return {
      type: 'boolean',
      done: 0,
      expected: 0,
      completion: null,
      currentStreak: 0,
      longestStreak: 0,
      streakUnit: f.type === 'times_per_week' ? 'week' : 'day',
    };
  }
  if (f.type === 'times_per_week') {
    // Weeks are taken from the full range so the running week keeps its full target.
    const weeks = weeksOf(habit, fullRange, weekStart).flatMap((w) => {
      const elapsed = today ? w.days.filter((d) => d <= today) : w.days;
      if (elapsed.length === 0) return []; // future week
      const fullNeed = expectedForWeek(f.count, w.days.length);
      const running = elapsed.length < w.days.length;
      const doneInWeek = elapsed.filter((d) => isDone(values, d)).length;
      const doneCapped = Math.min(doneInWeek, fullNeed);
      // A running week expects its prorated share so far, but early progress still counts.
      const expectedSoFar = running
        ? Math.max(expectedForWeek(f.count, elapsed.length), doneCapped)
        : fullNeed;
      return [
        { fullNeed, expectedSoFar, done: doneCapped, met: fullNeed > 0 && doneInWeek >= fullNeed, running },
      ];
    });
    const done = weeks.reduce((n, w) => n + w.done, 0);
    const expected = weeks.reduce((n, w) => n + w.expectedSoFar, 0);
    // Weeks that expect nothing (tiny partial weeks) neither extend nor break a streak.
    const counted = weeks.filter((w) => w.fullNeed > 0);
    const last = counted.at(-1);
    const { current, longest } = streaks(
      counted.map((w) => w.met),
      // An unfinished running week is not a failure yet.
      !!last && last.running && !last.met,
    );
    return {
      type: 'boolean',
      done,
      expected,
      completion: expected ? done / expected : null,
      currentStreak: current,
      longestStreak: longest,
      streakUnit: 'week',
    };
  }

  const expected = expectedCompletions(habit, range, weekStart);
  const days = scheduledDays(habit, range);
  const doneFlags = days.map((d) => isDone(values, d));
  const done = doneFlags.filter(Boolean).length;
  const lastIsUnloggedToday = days.at(-1) === today && !values.has(today!);
  const { current, longest } = streaks(doneFlags, lastIsUnloggedToday);
  return {
    type: 'boolean',
    done,
    expected,
    completion: expected ? done / expected : null,
    currentStreak: current,
    longestStreak: longest,
    streakUnit: 'day',
  };
}

/**
 * Longest run of `true`, and the run ending at the last slot. With `graceLast`, the last
 * slot is still open (today / this week) and is skipped instead of breaking the streak.
 */
export function streaks(flags: boolean[], graceLast = false): { current: number; longest: number } {
  let longest = 0;
  let run = 0;
  for (const f of flags) {
    run = f ? run + 1 : 0;
    longest = Math.max(longest, run);
  }
  let current = 0;
  for (let i = flags.length - 1 - (graceLast ? 1 : 0); i >= 0 && flags[i]; i--) current++;
  return { current, longest };
}

/**
 * The period before `range`, for comparisons (ANL-2): whole calendar months map to the
 * same number of previous months (August → July); anything else shifts back by its length.
 */
export function previousPeriod(range: DateRange): DateRange {
  const wholeMonths = range.from.endsWith('-01') && range.to === endOfMonth(range.to);
  if (wholeMonths) {
    const months =
      (Number(range.to.slice(0, 4)) - Number(range.from.slice(0, 4))) * 12 +
      (Number(range.to.slice(5, 7)) - Number(range.from.slice(5, 7))) +
      1;
    const fromMonth = addMonths(monthOf(range.from), -months);
    const toMonth = addMonths(monthOf(range.to), -months);
    return { from: `${fromMonth}-01`, to: endOfMonth(`${toMonth}-01`) };
  }
  const len = rangeLength(range);
  return { from: addDays(range.from, -len), to: addDays(range.to, -len) };
}
