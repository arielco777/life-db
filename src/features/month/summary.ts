import type { HabitStats } from '@/domain/services/stats';
import { formatDuration, formatNumber, formatPercent } from '@/domain/services/format';
import type { Habit } from '@/domain/types';

/**
 * The month summary under a habit column (MON-4), as two short lines that fit a narrow
 * column: boolean → "18/31" + "58%"; number → "avg 2.3" (+ total when it has a unit);
 * duration → total + "24m/d"; rating → "avg 7.2".
 */
export function summaryLines(
  habit: Pick<Habit, 'unit'>,
  s: HabitStats,
  locale?: string,
): { main: string; sub?: string; label: string } {
  switch (s.type) {
    case 'boolean': {
      const pct = s.completion === null ? undefined : formatPercent(s.completion, locale);
      return {
        main: `${s.done}/${s.expected}`,
        sub: pct,
        label: `${s.done} of ${s.expected} scheduled days done${pct ? ` (${pct})` : ''}`,
      };
    }
    case 'number': {
      if (s.average === null) return { main: '–', label: 'Nothing logged' };
      const avg = formatNumber(s.average, 1, locale);
      const total =
        habit.unit && s.total !== null ? `${formatNumber(s.total, 1, locale)} ${habit.unit}` : undefined;
      return {
        main: `avg ${avg}`,
        sub: total,
        label: `Average ${avg}${total ? `, total ${total}` : ''}`,
      };
    }
    case 'duration': {
      if (!s.daysLogged) return { main: '–', label: 'Nothing logged' };
      const perDay =
        s.averagePerCalendarDay === null
          ? undefined
          : `${formatDuration(s.averagePerCalendarDay, 'compact')}/d`;
      const total = formatDuration(s.total, 'compact');
      return {
        main: total,
        sub: perDay,
        label: `Total ${formatDuration(s.total)}${perDay ? `, ${perDay.replace('/d', ' per day')}` : ''}`,
      };
    }
    case 'rating': {
      if (s.average === null) return { main: '–', label: 'Nothing logged' };
      const avg = formatNumber(s.average, 1, locale);
      return { main: `avg ${avg}`, label: `Average ${avg}` };
    }
  }
}
