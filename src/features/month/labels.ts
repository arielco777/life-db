import type { ISODate, ISOMonth } from '@/domain/types';

const utc = (d: string) => new Date(`${d}T00:00:00Z`);

export const monthTitle = (ym: ISOMonth) =>
  utc(`${ym}-01`).toLocaleDateString(undefined, { month: 'long', year: 'numeric', timeZone: 'UTC' });
export const weekdayShort = (d: ISODate) =>
  utc(d).toLocaleDateString(undefined, { weekday: 'short', timeZone: 'UTC' });
export const dayLong = (d: ISODate) =>
  utc(d).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', timeZone: 'UTC' });
export const MONTH_NAMES = Array.from({ length: 12 }, (_, i) =>
  new Date(Date.UTC(2026, i, 1)).toLocaleDateString(undefined, { month: 'long', timeZone: 'UTC' }),
);
