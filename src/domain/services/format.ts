import type { Habit } from '../types';

/** Display and parsing of habit values (HAB-2, MON-1). Pure functions; locale is injectable. */

export const formatNumber = (n: number, maxFractionDigits = 2, locale?: string): string =>
  new Intl.NumberFormat(locale, { maximumFractionDigits: maxFractionDigits }).format(n);

/** 0–1 ratio → "58%". */
export const formatPercent = (ratio: number, locale?: string): string =>
  new Intl.NumberFormat(locale, { style: 'percent', maximumFractionDigits: 0 }).format(ratio);

/**
 * Minutes → text. `long`: "45m", "1h", "1h 30m", "12h 43m" (stats, inputs).
 * `compact`: "45m", "1h", "1h30" (monthly grid cells).
 */
export function formatDuration(minutes: number, style: 'long' | 'compact' = 'long'): string {
  const total = Math.max(0, Math.round(minutes));
  const h = Math.floor(total / 60);
  const m = total % 60;
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return style === 'compact' ? `${h}h${String(m).padStart(2, '0')}` : `${h}h ${m}m`;
}

const H = '(?:h|hr|hrs|hour|hours)';
const M = '(?:m|min|mins|minute|minutes)';
const PATTERNS: [RegExp, (m: RegExpMatchArray) => number][] = [
  [/^(\d+)$/, (m) => Number(m[1])], // "45" → minutes
  [new RegExp(`^(\\d+)\\s*${M}$`), (m) => Number(m[1])], // "45m", "45 min"
  [/^(\d+):([0-5]\d)$/, (m) => Number(m[1]) * 60 + Number(m[2])], // "1:30", "0:45"
  [new RegExp(`^(\\d+(?:[.,]\\d+)?)\\s*${H}$`), (m) => Math.round(Number(m[1]!.replace(',', '.')) * 60)], // "1.5h"
  [new RegExp(`^(\\d+)\\s*${H}\\s*(\\d+)\\s*(?:${M})?$`), (m) => Number(m[1]) * 60 + Number(m[2])], // "1h30", "1h 30m"
];

/**
 * Parses duration input into whole minutes (DurationInput accepts `45`, `0:45`, `1h30`).
 * Returns null for anything unrecognised.
 */
export function parseDuration(input: string): number | null {
  const s = input.trim().toLowerCase();
  for (const [re, toMinutes] of PATTERNS) {
    const m = s.match(re);
    if (m) {
      const v = toMinutes(m);
      return Number.isFinite(v) ? v : null;
    }
  }
  return null;
}

export interface FormatValueOptions {
  /** Short form for grid cells: no unit, no rating scale, compact durations. */
  compact?: boolean;
  locale?: string;
}

/** One logged value as text, by habit type (MON-1). */
export function formatValue(
  habit: Pick<Habit, 'type' | 'unit' | 'ratingScale'>,
  value: number,
  { compact = false, locale }: FormatValueOptions = {},
): string {
  switch (habit.type) {
    case 'boolean':
      return value === 1 ? '✓' : '✗';
    case 'duration':
      return formatDuration(value, compact ? 'compact' : 'long');
    case 'rating':
      return compact
        ? formatNumber(value, 1, locale)
        : `${formatNumber(value, 1, locale)}/${habit.ratingScale?.max ?? 10}`;
    case 'number': {
      const n = formatNumber(value, 2, locale);
      return compact || !habit.unit ? n : `${n} ${habit.unit}`;
    }
  }
}
