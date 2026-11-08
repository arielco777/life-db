import type { ISODate, Timestamp } from '../types';

/**
 * The only module that reads the system clock (NFR-11, SET-4).
 * Tests and repositories receive a `Clock` so time can be controlled.
 */
export interface Clock {
  now(): Date;
}

export const systemClock: Clock = { now: () => new Date() };

export const nowUtc = (clock: Clock = systemClock): Timestamp => clock.now().toISOString();

const pad = (n: number) => String(n).padStart(2, '0');

/** Formats a Date's *local* calendar date as `YYYY-MM-DD`. */
export const toISODate = (d: Date): ISODate =>
  `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

/**
 * The logical date of a moment: before `dayStartHour` (local time) it still counts
 * as the previous calendar day (SET-4).
 */
export const logicalDateOf = (moment: Date, dayStartHour: number): ISODate => {
  const d = new Date(moment.getTime());
  if (d.getHours() < dayStartHour) d.setDate(d.getDate() - 1);
  return toISODate(d);
};

export const logicalToday = (dayStartHour: number, clock: Clock = systemClock): ISODate =>
  logicalDateOf(clock.now(), dayStartHour);

const ISO_DATE_RE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

/** True for a real calendar date in `YYYY-MM-DD` form (rejects 2026-02-30). */
export const isISODate = (s: string): boolean => {
  if (!ISO_DATE_RE.test(s)) return false;
  const [y, m, d] = s.split('-').map(Number) as [number, number, number];
  const dt = new Date(y, m - 1, d);
  return dt.getFullYear() === y && dt.getMonth() === m - 1 && dt.getDate() === d;
};
