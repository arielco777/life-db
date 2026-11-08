import type { DateRange } from '../repositories';
import type { ISODate, ISOMonth, Weekday } from '../types';
import { WEEKDAYS } from '../types';

/**
 * Calendar arithmetic on `YYYY-MM-DD` strings. Computed in UTC so that daylight-saving
 * transitions can never shift a date (NFR-11). Inputs are assumed valid (see isISODate).
 */

const DAY_MS = 86_400_000;

const toUtc = (d: ISODate): number => {
  const [y, m, day] = d.split('-').map(Number) as [number, number, number];
  return Date.UTC(y, m - 1, day);
};

const fromUtc = (ms: number): ISODate => new Date(ms).toISOString().slice(0, 10);

export const addDays = (d: ISODate, n: number): ISODate => fromUtc(toUtc(d) + n * DAY_MS);

/** Whole days from `a` to `b` (positive when b is later). */
export const diffDays = (a: ISODate, b: ISODate): number => Math.round((toUtc(b) - toUtc(a)) / DAY_MS);

/** Weekday of a date. */
export const weekdayOf = (d: ISODate): Weekday => {
  const js = new Date(toUtc(d)).getUTCDay(); // 0 = Sunday
  return WEEKDAYS[(js + 6) % 7]!;
};

/** First day of the week containing `d` (DAY-5, HAB-4: respects the week-start setting). */
export const startOfWeek = (d: ISODate, weekStart: 'mon' | 'sun'): ISODate => {
  const offsetFromMon = WEEKDAYS.indexOf(weekdayOf(d));
  const back = weekStart === 'mon' ? offsetFromMon : (offsetFromMon + 1) % 7;
  return addDays(d, -back);
};

export const endOfWeek = (d: ISODate, weekStart: 'mon' | 'sun'): ISODate =>
  addDays(startOfWeek(d, weekStart), 6);

export const monthOf = (d: ISODate): ISOMonth => d.slice(0, 7);

export const daysInMonth = (month: ISOMonth): number => {
  const [y, m] = month.split('-').map(Number) as [number, number];
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
};

export const startOfMonth = (d: ISODate): ISODate => `${monthOf(d)}-01`;

export const endOfMonth = (d: ISODate): ISODate => {
  const month = monthOf(d);
  return `${month}-${String(daysInMonth(month)).padStart(2, '0')}`;
};

export const monthRange = (month: ISOMonth): DateRange => ({
  from: `${month}-01`,
  to: endOfMonth(`${month}-01`),
});

export const addMonths = (month: ISOMonth, n: number): ISOMonth => {
  const [y, m] = month.split('-').map(Number) as [number, number];
  const total = y * 12 + (m - 1) + n;
  return `${String(Math.floor(total / 12)).padStart(4, '0')}-${String((total % 12) + 1).padStart(2, '0')}`;
};

/** Every date from `from` to `to`, inclusive. Empty when `to < from`. */
export function eachDay({ from, to }: DateRange): ISODate[] {
  const out: ISODate[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
  return out;
}

export const rangeLength = ({ from, to }: DateRange): number => Math.max(0, diffDays(from, to) + 1);

/** Intersection of two ranges, or null when they don't overlap. */
export function intersect(a: DateRange, b: DateRange): DateRange | null {
  const from = a.from > b.from ? a.from : b.from;
  const to = a.to < b.to ? a.to : b.to;
  return from <= to ? { from, to } : null;
}

export const minDate = (a: ISODate, b: ISODate): ISODate => (a < b ? a : b);
