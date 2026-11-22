import { formatDuration, formatNumber, formatPercent } from '@/domain/services/format';
import type { HabitStats } from '@/domain/services/stats';
import type { Habit } from '@/domain/types';

export interface StatRow {
  key: string;
  label: string;
  value: string;
  /** Whether comparing with the previous period means anything (a streak doesn't). */
  comparable: boolean;
}

const dash = '–';
const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? '' : 's'}`;

/** A habit's stats for a period as labelled rows, by type (ANL-1). */
export function statRows(habit: Pick<Habit, 'type' | 'unit'>, s: HabitStats, locale?: string): StatRow[] {
  const num = (v: number | null, digits = 1) => (v === null ? dash : formatNumber(v, digits, locale));
  const withUnit = (v: number | null) => (v === null || !habit.unit ? num(v) : `${num(v)} ${habit.unit}`);
  const row = (key: string, label: string, value: string, comparable = true): StatRow => ({
    key,
    label,
    value,
    comparable,
  });
  switch (s.type) {
    case 'boolean':
      return [
        row('completion', 'Completion', s.completion === null ? dash : formatPercent(s.completion, locale)),
        row('done', 'Done', `${s.done} of ${s.expected}`),
        row('current', 'Current streak', plural(s.currentStreak, s.streakUnit), false),
        row('longest', 'Longest streak', plural(s.longestStreak, s.streakUnit), false),
      ];
    case 'number':
      return [
        row('average', 'Average', withUnit(s.average)),
        row('total', 'Total', withUnit(s.total)),
        row('min', 'Lowest', withUnit(s.min)),
        row('max', 'Highest', withUnit(s.max)),
        row('days', 'Days logged', String(s.daysLogged)),
      ];
    case 'duration': {
      const dur = (v: number | null) => (v === null ? dash : formatDuration(v));
      return [
        row('total', 'Total', s.daysLogged ? formatDuration(s.total) : dash),
        row('perLogged', 'Average per logged day', dur(s.averagePerLoggedDay)),
        row('perDay', 'Average per day', dur(s.averagePerCalendarDay)),
        row('days', 'Days logged', String(s.daysLogged)),
      ];
    }
    case 'rating':
      return [
        row('average', 'Average', num(s.average)),
        row('min', 'Lowest', num(s.min, 0)),
        row('max', 'Highest', num(s.max, 0)),
        row('days', 'Days logged', String(s.daysLogged)),
      ];
  }
}
