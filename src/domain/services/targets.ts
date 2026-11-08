import type { DateRange } from '../repositories';
import type { Habit, HabitEntry, HabitTarget, ISODate } from '../types';
import { eachDay, endOfMonth, endOfWeek, startOfMonth, startOfWeek } from './dates';
import type { WeekStart } from './schedule';

/** Values of one habit keyed by date. */
export type ValuesByDate = ReadonlyMap<ISODate, number>;

export const valuesByDate = (entries: readonly Pick<HabitEntry, 'date' | 'value'>[]): Map<ISODate, number> =>
  new Map(entries.map((e) => [e.date, e.value]));

/** The calendar period (day / week / month) a target is measured over, containing `date`. */
/** Splits entries into one ValuesByDate per habit (daily view, monthly grid). */
export function valuesByHabit(
  entries: readonly Pick<HabitEntry, 'habitId' | 'date' | 'value'>[],
): Map<string, Map<ISODate, number>> {
  const out = new Map<string, Map<ISODate, number>>();
  for (const e of entries) {
    let m = out.get(e.habitId);
    if (!m) out.set(e.habitId, (m = new Map()));
    m.set(e.date, e.value);
  }
  return out;
}

export function periodRange(period: HabitTarget['period'], date: ISODate, weekStart: WeekStart): DateRange {
  switch (period) {
    case 'day':
      return { from: date, to: date };
    case 'week':
      return { from: startOfWeek(date, weekStart), to: endOfWeek(date, weekStart) };
    case 'month':
      return { from: startOfMonth(date), to: endOfMonth(date) };
  }
}

export type TargetStatus =
  /** Target reached (at_least), or period over without exceeding (at_most). */
  | 'met'
  /** Period over without reaching (at_least), or limit already exceeded (at_most). */
  | 'not_met'
  /** Week/month still running and not yet decided. */
  | 'in_progress'
  /** Nothing logged: a day target with no entry, or a finished week/month with no entries. */
  | 'no_data';

export interface TargetEvaluation {
  target: HabitTarget;
  period: DateRange;
  /** Aggregated value so far: done days (boolean), sum (number/duration), average (rating). */
  actual: number | null;
  /** actual / target value, for progress bars; null without data. Not capped. */
  progress: number | null;
  status: TargetStatus;
}

/**
 * How a period's logged values roll up for comparison with the target:
 * boolean → count of done days; number/duration → sum; rating → average.
 */
export function aggregate(type: Habit['type'], values: number[]): number | null {
  if (values.length === 0) return type === 'boolean' ? 0 : null;
  switch (type) {
    case 'boolean':
      return values.filter((v) => v === 1).length;
    case 'rating':
      return values.reduce((a, b) => a + b, 0) / values.length;
    default:
      return values.reduce((a, b) => a + b, 0);
  }
}

/**
 * HAB-4 / DAY-5: evaluates a habit's target for the period containing `asOf`, counting
 * only values logged up to and including `asOf`.
 * Returns null when the habit has no target.
 */
export function evaluateTarget(
  habit: Pick<Habit, 'type' | 'target'>,
  values: ValuesByDate,
  asOf: ISODate,
  weekStart: WeekStart,
): TargetEvaluation | null {
  const target = habit.target;
  if (!target) return null;
  const period = periodRange(target.period, asOf, weekStart);
  const logged = eachDay({ from: period.from, to: asOf }).flatMap((d) => {
    const v = values.get(d);
    return v === undefined ? [] : [v];
  });
  const actual = aggregate(habit.type, logged);
  const progress =
    actual === null ? null : target.value === 0 ? (actual === 0 ? 1 : Infinity) : actual / target.value;
  const periodOver = asOf >= period.to;

  let status: TargetStatus;
  if (target.period === 'day' && logged.length === 0) status = 'no_data';
  else if (actual === null) status = periodOver ? 'no_data' : 'in_progress';
  else if (target.op === 'at_least')
    status = actual >= target.value ? 'met' : periodOver ? 'not_met' : 'in_progress';
  // at_most: rating averages can come back down, so only sums/counts are "already exceeded".
  else if (actual > target.value) status = periodOver || habit.type !== 'rating' ? 'not_met' : 'in_progress';
  else status = periodOver ? 'met' : 'in_progress';

  return { target, period, actual, progress, status };
}
