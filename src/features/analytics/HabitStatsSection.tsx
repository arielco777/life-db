import { useMemo, useState } from 'react';
import { HabitStatsCard } from './HabitStatsCard';
import { comparisonPeriod, periodAround, periodLabel, type Period } from './period';
import { PeriodPicker } from './PeriodPicker';
import { valuesByDate } from '@/domain/services/targets';
import type { Habit } from '@/domain/types';
import { useEntries } from '@/features/habits/entryHooks';
import { useSettings, useToday } from '@/features/settings/hooks';

/** The habit page's stats and chart for a chosen period (tasks 13.4, ANL-1, ANL-3). */
export function HabitStatsSection({ habit }: { habit: Habit }) {
  const today = useToday();
  const { week_start, date_format } = useSettings();
  const [period, setPeriod] = useState<Period>(() => periodAround('month', today, week_start));
  const previous = comparisonPeriod(period);
  const entries = useEntries({ from: previous.range.from, to: period.range.to }, [habit.id]);
  const values = useMemo(() => valuesByDate(entries.data ?? []), [entries.data]);
  return (
    <section className="stack-sm" aria-labelledby="habit-stats">
      <h2 id="habit-stats">Stats</h2>
      <PeriodPicker period={period} onChange={setPeriod} today={today} />
      {entries.isPending ? (
        <p className="muted">Loading…</p>
      ) : (
        <HabitStatsCard
          habit={habit}
          period={period}
          periodName={periodLabel(period, date_format)}
          previous={previous}
          previousName={periodLabel(previous, date_format)}
          values={values}
          today={today}
          linkName={false}
        />
      )}
    </section>
  );
}
