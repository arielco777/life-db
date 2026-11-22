import { Link } from 'react-router-dom';
import { BarChart } from './BarChart';
import type { Period } from './period';
import { statRows } from './statRows';
import { formatDate } from '@/domain/services/dateFormat';
import { formatDuration, formatNumber } from '@/domain/services/format';
import { chartSeries, type Bucket } from '@/domain/services/series';
import { computeStats } from '@/domain/services/stats';
import type { ValuesByDate } from '@/domain/services/targets';
import type { Habit, ISODate } from '@/domain/types';
import { useSettings } from '@/features/settings/hooks';

interface HabitStatsCardProps {
  habit: Habit;
  period: Period;
  periodName: string;
  previous: Period;
  previousName: string;
  /** The habit's values; must cover both periods. */
  values: ValuesByDate;
  today: ISODate;
  /** Link the habit's name to its page (off on the habit page itself). */
  linkName?: boolean;
}

/** How a chart value reads, by habit type. */
function valueFormat(habit: Habit, unit: 'day' | 'week') {
  switch (habit.type) {
    case 'boolean':
      return unit === 'day'
        ? (v: number) => (v ? 'Done' : 'Not done')
        : (v: number) => `${formatNumber(v)} done`;
    case 'duration':
      return (v: number) => formatDuration(v);
    case 'rating':
      return (v: number) => formatNumber(v, 1);
    case 'number':
      return (v: number) => (habit.unit ? `${formatNumber(v, 1)} ${habit.unit}` : formatNumber(v, 1));
  }
}

/**
 * One habit's stats for the period next to the previous period's (ANL-1, ANL-2), and its
 * chart (ANL-3). Everything is computed from entries on the fly (ANL-5).
 */
export function HabitStatsCard({
  habit,
  period,
  periodName,
  previous,
  previousName,
  values,
  today,
  linkName = true,
}: HabitStatsCardProps) {
  const { week_start, date_format } = useSettings();
  const opts = { weekStart: week_start, today };
  const now = statRows(habit, computeStats(habit, values, period.range, opts));
  const before = statRows(habit, computeStats(habit, values, previous.range, opts));
  const series = chartSeries(habit, values, period.range, opts);
  const short = (d: ISODate) => formatDate(d, date_format, false);
  const dateLabel = (b: Bucket) => (b.from === b.to ? short(b.from) : `${short(b.from)} – ${short(b.to)}`);
  const max =
    habit.type === 'boolean'
      ? series.unit === 'day'
        ? 1
        : 7
      : habit.type === 'rating'
        ? (habit.ratingScale?.max ?? 10)
        : undefined;

  return (
    <article className="card stack-sm habit-stats" aria-labelledby={`stats-${habit.id}`}>
      <h3 id={`stats-${habit.id}`} className="habit-stats-title">
        {linkName ? <Link to={`/habits/${habit.id}`}>{habit.name}</Link> : habit.name}
        {/* On the habit page the heading already says so. */}
        {linkName && habit.archivedAt && <span className="badge">Archived</span>}
      </h3>
      <table className="stats-table" aria-label={`${habit.name} stats`}>
        <thead>
          <tr>
            <th scope="col">
              <span className="sr-only">Stat</span>
            </th>
            <th scope="col">{periodName}</th>
            <th scope="col" className="muted">
              {previousName}
            </th>
          </tr>
        </thead>
        <tbody>
          {now.map((r, i) => (
            <tr key={r.key}>
              <th scope="row">{r.label}</th>
              <td>{r.value}</td>
              <td className="muted">{r.comparable ? before[i]!.value : '–'}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <BarChart
        buckets={series.buckets}
        unit={series.unit}
        title={`${habit.name}, ${periodName}`}
        format={valueFormat(habit, series.unit)}
        dateLabel={dateLabel}
        max={max}
      />
    </article>
  );
}
