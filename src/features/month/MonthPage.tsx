import { Link, Navigate, useNavigate, useParams } from 'react-router-dom';
import { MONTH_NAMES, monthTitle } from './labels';
import { MonthGrid } from './MonthGrid';
import { isISOMonth, useMonth } from './useMonth';
import { addMonths, monthOf } from '@/domain/services/dates';
import type { ISOMonth } from '@/domain/types';
import { useCategories } from '@/features/categories/hooks';
import { useToday } from '@/features/settings/hooks';

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
