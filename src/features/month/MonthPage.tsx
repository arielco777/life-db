import { memo, useMemo, type CSSProperties } from 'react';
import { Link, Navigate, useNavigate, useParams } from 'react-router-dom';
import { summaryLines } from './summary';
import { isISOMonth, useMonth } from './useMonth';
import { addMonths, eachDay, monthOf, monthRange, weekdayOf } from '@/domain/services/dates';
import { formatValue } from '@/domain/services/format';
import { isScheduled } from '@/domain/services/schedule';
import { computeStats } from '@/domain/services/stats';
import { evaluateTarget, type ValuesByDate } from '@/domain/services/targets';
import type { Category, Habit, ISODate, ISOMonth } from '@/domain/types';
import { useCategories } from '@/features/categories/hooks';
import { useSettings, useToday } from '@/features/settings/hooks';

const monthTitle = (ym: ISOMonth) =>
  new Date(`${ym}-01T00:00:00Z`).toLocaleDateString(undefined, {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });
const weekdayShort = (d: ISODate) =>
  new Date(`${d}T00:00:00Z`).toLocaleDateString(undefined, { weekday: 'short', timeZone: 'UTC' });
const dayLong = (d: ISODate) =>
  new Date(`${d}T00:00:00Z`).toLocaleDateString(undefined, {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    timeZone: 'UTC',
  });
const MONTH_NAMES = Array.from({ length: 12 }, (_, i) =>
  new Date(Date.UTC(2026, i, 1)).toLocaleDateString(undefined, { month: 'long', timeZone: 'UTC' }),
);

/** /month and /month/:ym (tasks 6.1). No or invalid month → the month of the logical today. */
export function MonthRoute() {
  const { ym } = useParams();
  const today = useToday();
  if (!ym || !isISOMonth(ym)) return <Navigate to={`/month/${monthOf(today)}`} replace />;
  return <MonthPage ym={ym} />;
}

function MonthPage({ ym }: { ym: ISOMonth }) {
  const navigate = useNavigate();
  const today = useToday();
  const thisMonth = monthOf(today);
  const month = useMonth(ym);
  // Wait for categories too, so cells don't flash the fallback tint before their colour arrives.
  const categoriesPending = useCategories().isPending;
  const year = Number(ym.slice(0, 4));
  const years = Array.from({ length: 21 }, (_, i) => Number(thisMonth.slice(0, 4)) - 15 + i);
  if (!years.includes(year)) years.push(year);
  years.sort((a, b) => a - b);

  return (
    <section className="month">
      <header className="day-header">
        <nav className="day-nav" aria-label="Month">
          <Link
            to={`/month/${addMonths(ym, -1)}`}
            className="button secondary icon-btn"
            aria-label="Previous month"
          >
            ‹
          </Link>
          <h1 className="page-title month-title">{monthTitle(ym)}</h1>
          <Link
            to={`/month/${addMonths(ym, 1)}`}
            className="button secondary icon-btn"
            aria-label="Next month"
          >
            ›
          </Link>
        </nav>
        <div className="row day-tools">
          <button
            type="button"
            className="secondary"
            disabled={ym === thisMonth}
            onClick={() => navigate(`/month/${thisMonth}`)}
          >
            This month
          </button>
          <select
            aria-label="Month"
            value={ym.slice(5)}
            onChange={(e) => navigate(`/month/${ym.slice(0, 4)}-${e.target.value}`)}
          >
            {MONTH_NAMES.map((name, i) => (
              <option key={name} value={String(i + 1).padStart(2, '0')}>
                {name}
              </option>
            ))}
          </select>
          <select
            aria-label="Year"
            value={year}
            onChange={(e) => navigate(`/month/${e.target.value}-${ym.slice(5)}`)}
          >
            {years.map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </select>
        </div>
      </header>

      {month.error ? (
        <p className="error">Couldn't load this month.</p>
      ) : month.isPending || categoriesPending ? (
        <p className="muted">Loading…</p>
      ) : month.habits.length === 0 ? (
        <div className="card empty">
          <p>No habits were active this month.</p>
          <Link to="/habits/new" className="button">
            Add a habit
          </Link>
        </div>
      ) : (
        <MonthGrid ym={ym} habits={month.habits} valuesByHabit={month.valuesByHabit} today={today} />
      )}

      {/* V1.1: the month's goals (MON-7) render here. */}
    </section>
  );
}

interface GridProps {
  ym: ISOMonth;
  habits: Habit[];
  valuesByHabit: Map<string, ValuesByDate>;
  today: ISODate;
}

const EMPTY: ValuesByDate = new Map();

/**
 * The paper-tracker grid (MON-1): one row per day, one column per habit, angled habit
 * names on top, a summary footer (MON-4). The day column, header and footer are sticky.
 */
function MonthGrid({ ym, habits, valuesByHabit, today }: GridProps) {
  const { week_start } = useSettings();
  const { data: categories = [] } = useCategories();
  const catById = useMemo(() => new Map(categories.map((c) => [c.id, c])), [categories]);
  const range = monthRange(ym);
  const days = eachDay(range);

  return (
    <div className="month-scroll">
      <table className="month-grid">
        <caption className="sr-only">Habits for {monthTitle(ym)}</caption>
        <thead>
          <tr>
            <th scope="col" className="corner">
              <span className="sr-only">Day</span>
            </th>
            {habits.map((h) => {
              const name = h.type === 'number' && h.unit ? `${h.name} (${h.unit})` : h.name;
              return (
                <th key={h.id} scope="col" className="habit-col" title={name}>
                  <div className="angled">
                    <span>{name}</span>
                  </div>
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {days.map((d) => {
            const wd = weekdayOf(d);
            const cls = [
              d === today && 'today',
              (wd === 'sat' || wd === 'sun') && 'weekend',
              d > today && 'future',
            ]
              .filter(Boolean)
              .join(' ');
            return (
              <tr key={d} className={cls || undefined}>
                <th scope="row" className="day-cell">
                  <Link
                    to={`/day/${d}`}
                    aria-label={dayLong(d)}
                    aria-current={d === today ? 'date' : undefined}
                  >
                    <span className="day-num">{Number(d.slice(8))}</span>
                    <span className="day-wd">{weekdayShort(d)}</span>
                  </Link>
                  {/* V1.1: life-event marker (MON-6). */}
                </th>
                {habits.map((h) => (
                  <MonthCell
                    key={h.id}
                    habit={h}
                    date={d}
                    value={valuesByHabit.get(h.id)?.get(d)}
                    values={valuesByHabit.get(h.id) ?? EMPTY}
                    category={catById.get(h.categoryId ?? '')}
                    weekStart={week_start}
                  />
                ))}
              </tr>
            );
          })}
        </tbody>
        <tfoot>
          <tr>
            <th scope="row" className="day-cell summary-head">
              Month
            </th>
            {habits.map((h) => {
              const s = computeStats(h, valuesByHabit.get(h.id) ?? EMPTY, range, {
                weekStart: week_start,
                today,
              });
              const lines = summaryLines(h, s);
              return (
                <td key={h.id} className="summary-cell" aria-label={`${h.name}: ${lines.label}`}>
                  <span className="summary-main">{lines.main}</span>
                  {lines.sub && <span className="summary-sub">{lines.sub}</span>}
                </td>
              );
            })}
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

interface CellProps {
  habit: Habit;
  date: ISODate;
  value: number | undefined;
  values: ValuesByDate;
  category?: Category;
  weekStart: 'mon' | 'sun';
}

/** One (habit, day) cell: value, category tint (MON-6), unscheduled and day-target styling. */
const MonthCell = memo(function MonthCell({ habit, date, value, values, category, weekStart }: CellProps) {
  const scheduled = isScheduled(habit, date);
  const active = date >= habit.startDate && (!habit.endDate || date <= habit.endDate);
  const logged = value !== undefined;
  const tinted = logged && !(habit.type === 'boolean' && value === 0);
  const dayTarget =
    logged && habit.target?.period === 'day'
      ? evaluateTarget(habit, values, date, weekStart)?.status
      : undefined;

  const cls = [
    'cell',
    tinted && 'logged',
    habit.type === 'boolean' && value === 1 && 'done',
    !active ? 'inactive' : !scheduled && 'unscheduled',
    dayTarget === 'met' && 'target-met',
    dayTarget === 'not_met' && 'target-missed',
  ]
    .filter(Boolean)
    .join(' ');

  const text =
    value === undefined
      ? ''
      : habit.type === 'boolean'
        ? value === 1
          ? '✓'
          : '✗'
        : formatValue(habit, value, { compact: true });

  return (
    <td
      className={cls}
      style={tinted ? ({ '--cat': category?.color ?? 'var(--accent)' } as CSSProperties) : undefined}
    >
      {habit.type === 'boolean' && value !== undefined ? (
        <span aria-label={value === 1 ? 'done' : 'not done'}>{text}</span>
      ) : (
        text
      )}
    </td>
  );
});
