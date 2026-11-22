import { useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { GoalSummary } from './GoalSummary';
import { HabitStatsCard } from './HabitStatsCard';
import { comparisonPeriod, periodFromParams, periodLabel, periodParams, type Period } from './period';
import { PeriodPicker } from './PeriodPicker';
import { valuesByHabit, type ValuesByDate } from '@/domain/services/targets';
import { useEntries } from '@/features/habits/entryHooks';
import { useActiveHabits } from '@/features/habits/hooks';
import { useSettings, useToday } from '@/features/settings/hooks';

const EMPTY: ValuesByDate = new Map();

/**
 * /analytics (tasks 13.1, 13.2, 13.3, 13.5): a period picker, then a card per habit with
 * its stats next to the previous period's and a chart, then the goals summary. The period
 * lives in the URL, so going back restores it.
 */
export function AnalyticsPage() {
  const today = useToday();
  const { week_start, date_format } = useSettings();
  const [params, setParams] = useSearchParams();
  const period = periodFromParams(params, today, week_start);
  const previous = comparisonPeriod(period);
  const setPeriod = (p: Period) => setParams(periodParams(p), { replace: true });

  // Habits active at any point in the period (archived ones too, when they were active then),
  // and one query for the entries of both periods.
  const habits = useActiveHabits(period.range);
  const entries = useEntries({ from: previous.range.from, to: period.range.to });
  const byHabit = useMemo(() => valuesByHabit(entries.data ?? []), [entries.data]);
  const name = periodLabel(period, date_format);
  const previousName = periodLabel(previous, date_format);
  const list = habits.data ?? [];

  return (
    <section className="stack analytics">
      <h1 className="page-title">Analytics</h1>
      <PeriodPicker period={period} onChange={setPeriod} today={today} />

      <section className="stack-sm" aria-labelledby="analytics-habits">
        <h2 id="analytics-habits">Habits</h2>
        {habits.isPending || entries.isPending ? (
          <p className="muted">Loading…</p>
        ) : habits.error || entries.error ? (
          <p className="error">Couldn't load the stats.</p>
        ) : list.length === 0 ? (
          <p className="small muted">No habits were active in this period.</p>
        ) : (
          <div className="stats-grid">
            {list.map((h) => (
              <HabitStatsCard
                key={h.id}
                habit={h}
                period={period}
                periodName={name}
                previous={previous}
                previousName={previousName}
                values={byHabit.get(h.id) ?? EMPTY}
                today={today}
              />
            ))}
          </div>
        )}
      </section>

      <GoalSummary />
    </section>
  );
}
