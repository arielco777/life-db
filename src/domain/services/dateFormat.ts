import { format } from 'date-fns';
import type { ISODate } from '@/domain/types';

/**
 * The date formats offered in settings (SET-2), as date-fns patterns. `short` is the same
 * format without the year, for places where the year is obvious ("Ends Dec 31").
 */
export const DATE_FORMATS = [
  { pattern: 'MMM d, yyyy', short: 'MMM d' },
  { pattern: 'd MMM yyyy', short: 'd MMM' },
  { pattern: 'yyyy-MM-dd', short: 'MM-dd' },
  { pattern: 'dd/MM/yyyy', short: 'dd/MM' },
  { pattern: 'MM/dd/yyyy', short: 'MM/dd' },
  { pattern: 'dd.MM.yyyy', short: 'dd.MM' },
] as const;

export const DEFAULT_DATE_FORMAT = DATE_FORMATS[0].pattern;

/**
 * A calendar date in the chosen format: "Aug 14, 2026", "14/08/2026"… Never shifted by
 * time zone (NFR-11). An unknown pattern falls back to the default.
 */
export function formatDate(d: ISODate, pattern: string = DEFAULT_DATE_FORMAT, withYear = true): string {
  const f = DATE_FORMATS.find((x) => x.pattern === pattern) ?? DATE_FORMATS[0];
  const [y, m, day] = d.split('-').map(Number) as [number, number, number];
  return format(new Date(y, m - 1, day), withYear ? f.pattern : f.short);
}
