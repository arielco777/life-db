import type { DateRange } from '@/domain/repositories';
import { isISODate } from '@/domain/services/clock';
import { formatDate } from '@/domain/services/dateFormat';
import {
  addDays,
  addMonths,
  endOfWeek,
  monthOf,
  monthRange,
  rangeLength,
  startOfWeek,
} from '@/domain/services/dates';
import type { WeekStart } from '@/domain/services/schedule';
import { previousPeriod } from '@/domain/services/stats';
import type { ISODate } from '@/domain/types';
import { monthTitle } from '@/features/month/labels';

export type PeriodKind = 'week' | 'month' | 'year' | 'custom';
export const PERIOD_KINDS: readonly PeriodKind[] = ['week', 'month', 'year', 'custom'];

export interface Period {
  kind: PeriodKind;
  range: DateRange;
}

/** The week, month or year containing `date`. */
export function periodAround(
  kind: Exclude<PeriodKind, 'custom'>,
  date: ISODate,
  weekStart: WeekStart,
): Period {
  switch (kind) {
    case 'week':
      return { kind, range: { from: startOfWeek(date, weekStart), to: endOfWeek(date, weekStart) } };
    case 'month':
      return { kind, range: monthRange(monthOf(date)) };
    case 'year':
      return { kind, range: { from: `${date.slice(0, 4)}-01-01`, to: `${date.slice(0, 4)}-12-31` } };
  }
}

/** The period `n` steps before (negative) or after: a custom range moves by its own length. */
export function shiftPeriod(p: Period, n: number): Period {
  switch (p.kind) {
    case 'week':
      return { kind: 'week', range: { from: addDays(p.range.from, 7 * n), to: addDays(p.range.to, 7 * n) } };
    case 'month':
      return { kind: 'month', range: monthRange(addMonths(monthOf(p.range.from), n)) };
    case 'year': {
      const y = Number(p.range.from.slice(0, 4)) + n;
      return { kind: 'year', range: { from: `${y}-01-01`, to: `${y}-12-31` } };
    }
    case 'custom': {
      const len = rangeLength(p.range) * n;
      return { kind: 'custom', range: { from: addDays(p.range.from, len), to: addDays(p.range.to, len) } };
    }
  }
}

/** The period compared against (ANL-2): the one just before, of the same kind and length. */
export const comparisonPeriod = (p: Period): Period =>
  p.kind === 'custom' ? { kind: 'custom', range: previousPeriod(p.range) } : shiftPeriod(p, -1);

/** "August 2026", "2026", "Aug 10 – Aug 16, 2026", in the user's date format for ranges. */
export function periodLabel(p: Period, pattern: string): string {
  if (p.kind === 'month') return monthTitle(monthOf(p.range.from));
  if (p.kind === 'year') return p.range.from.slice(0, 4);
  const sameYear = p.range.from.slice(0, 4) === p.range.to.slice(0, 4);
  return `${formatDate(p.range.from, pattern, !sameYear)} – ${formatDate(p.range.to, pattern, true)}`;
}

/**
 * Reads a period from the URL (`?period=month&from=2026-08-01`, or `period=custom&from&to`),
 * falling back to the month containing `today` (ANL-1's default).
 */
export function periodFromParams(params: URLSearchParams, today: ISODate, weekStart: WeekStart): Period {
  const kind = params.get('period');
  const from = params.get('from') ?? '';
  const to = params.get('to') ?? '';
  if (kind === 'custom' && isISODate(from) && isISODate(to) && from <= to) {
    return { kind, range: { from, to } };
  }
  if (kind === 'week' || kind === 'month' || kind === 'year') {
    return periodAround(kind, isISODate(from) ? from : today, weekStart);
  }
  return periodAround('month', today, weekStart);
}

export const periodParams = (p: Period): Record<string, string> =>
  p.kind === 'custom'
    ? { period: 'custom', from: p.range.from, to: p.range.to }
    : { period: p.kind, from: p.range.from };
