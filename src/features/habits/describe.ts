import type { Habit, HabitType, Weekday } from '@/domain/types';
import { WEEKDAYS } from '@/domain/types';
import { formatValue } from '@/domain/services/format';

export const TYPE_LABELS: Record<HabitType, { label: string; hint: string }> = {
  boolean: { label: 'Checkbox', hint: 'Done or not, e.g. Exercise' },
  number: { label: 'Number', hint: 'An amount with a unit, e.g. 2.5 L of water' },
  duration: { label: 'Duration', hint: 'Time spent, e.g. 45 min of reading' },
  rating: { label: 'Rating', hint: 'A score on a scale, e.g. mood 8/10' },
};

export const WEEKDAY_SHORT: Record<Weekday, string> = {
  mon: 'Mon',
  tue: 'Tue',
  wed: 'Wed',
  thu: 'Thu',
  fri: 'Fri',
  sat: 'Sat',
  sun: 'Sun',
};

/** Weekdays in display order for the user's week start (SET-2). */
export const orderedWeekdays = (weekStart: 'mon' | 'sun'): Weekday[] =>
  weekStart === 'sun' ? ['sun', ...WEEKDAYS.slice(0, 6)] : [...WEEKDAYS];

/** "Daily", "Mon, Wed, Fri", "Weekdays", "3× a week". */
export function describeFrequency(f: Habit['frequency'], weekStart: 'mon' | 'sun' = 'mon'): string {
  switch (f.type) {
    case 'daily':
      return 'Daily';
    case 'times_per_week':
      return `${f.count}× a week`;
    case 'weekdays': {
      const set = new Set(f.days);
      if (set.size === 7) return 'Daily';
      if (set.size === 5 && !set.has('sat') && !set.has('sun')) return 'Weekdays';
      if (set.size === 2 && set.has('sat') && set.has('sun')) return 'Weekends';
      return orderedWeekdays(weekStart)
        .filter((d) => set.has(d))
        .map((d) => WEEKDAY_SHORT[d])
        .join(', ');
    }
  }
}

/** "At least 4× per week", "At most 2 cups per day", "At least an average of 7 per week". */
export function describeTarget(h: Pick<Habit, 'type' | 'unit' | 'ratingScale' | 'target'>): string | null {
  const t = h.target;
  if (!t) return null;
  const amount =
    h.type === 'boolean'
      ? `${t.value}×`
      : h.type === 'rating'
        ? `an average of ${formatValue(h, t.value, { compact: true })}`
        : formatValue(h, t.value);
  return `${t.op === 'at_least' ? 'At least' : 'At most'} ${amount} per ${t.period}`;
}
