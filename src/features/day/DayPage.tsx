import { useEffect, useEffectEvent, type CSSProperties } from 'react';
import { Link, Navigate, useNavigate, useParams } from 'react-router-dom';
import { rowStatus } from './rowStatus';
import { useDay } from './useDay';
import { isISODate } from '@/domain/services/clock';
import { addDays, diffDays } from '@/domain/services/dates';
import type { ValuesByDate } from '@/domain/services/targets';
import type { Habit, ISODate } from '@/domain/types';
import { useCategories } from '@/features/categories/hooks';
import { HabitEntryField } from '@/features/habits/HabitEntryField';
import { useSettings, useToday } from '@/features/settings/hooks';

const longDate = (d: ISODate) =>
  new Date(`${d}T00:00:00Z`).toLocaleDateString(undefined, {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  });

const relative = (date: ISODate, today: ISODate) => {
  const n = diffDays(today, date);
  if (n === 0) return 'Today';
  if (n === -1) return 'Yesterday';
  if (n === 1) return 'Tomorrow';
  return n < 0 ? `${-n} days ago` : `In ${n} days`;
};

/** /day and /day/:date (tasks 5.1). No or invalid date → the logical today (SET-4). */
export function DayRoute() {
  const { date } = useParams();
  const today = useToday();
  if (!date || !isISODate(date)) return <Navigate to={`/day/${today}`} replace />;
  return <DayPage date={date} />;
}

/**
 * ←/→ change the day and `t` jumps to today (DAY-3) — but never while typing, while a
 * widget handled the key itself (rating arrows), or with modifiers held.
 */
function useDayKeys(date: ISODate, today: ISODate) {
  const navigate = useNavigate();
  const onKey = useEffectEvent((e: KeyboardEvent) => {
    if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
    const el = e.target as HTMLElement | null;
    if (
      el?.closest('input, textarea, select, [contenteditable="true"], [role="dialog"], [role="alertdialog"]')
    )
      return;
    if (e.key === 'ArrowLeft') navigate(`/day/${addDays(date, -1)}`);
    else if (e.key === 'ArrowRight') navigate(`/day/${addDays(date, 1)}`);
    else if (e.key === 't' && date !== today) navigate(`/day/${today}`);
    else return;
    e.preventDefault();
  });
  useEffect(() => {
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}

function DayPage({ date }: { date: ISODate }) {
  const navigate = useNavigate();
  const today = useToday();
  const day = useDay(date);
  useDayKeys(date, today);

  return (
    <section className="day">
      <header className="day-header">
        <nav className="day-nav" aria-label="Day">
          <Link
            to={`/day/${addDays(date, -1)}`}
            className="button secondary icon-btn"
            aria-label="Previous day"
          >
            ‹
          </Link>
          <div className="day-title">
            <h1 className="page-title">{longDate(date)}</h1>
            <span className="muted small">{relative(date, today)}</span>
          </div>
          <Link to={`/day/${addDays(date, 1)}`} className="button secondary icon-btn" aria-label="Next day">
            ›
          </Link>
        </nav>
        <div className="row day-tools">
          <button
            type="button"
            className="secondary"
            disabled={date === today}
            onClick={() => navigate(`/day/${today}`)}
          >
            Today
          </button>
          <input
            type="date"
            aria-label="Go to date"
            value={date}
            onChange={(e) =>
              e.target.value && isISODate(e.target.value) && navigate(`/day/${e.target.value}`)
            }
          />
        </div>
      </header>

      {/* V1.1: life events covering the date (DAY-1 §2) render here. */}

      <HabitsSection date={date} day={day} />

      {/* V1.1: goals with habits linked for the day (DAY-1 §4) render here. */}

      <section className="day-section" aria-labelledby="day-journal">
        <h2 id="day-journal" className="section-title">
          Journal
        </h2>
        {day.journal.length === 0 ? (
          <p className="muted">Nothing written for this day yet.</p>
        ) : (
          <ul className="plain list" aria-label="Journal entries">
            {day.journal.map((j) => (
              <li key={j.id} className="list-row">
                <Link to={`/journal/${j.id}`} className="grow">
                  {j.title || j.body?.split('\n').find((l) => l.trim()) || 'Untitled'}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </section>
  );
}

function HabitsSection({ date, day }: { date: ISODate; day: ReturnType<typeof useDay> }) {
  if (day.error) return <p className="error">Couldn't load this day.</p>;
  return (
    <section className="day-section" aria-labelledby="day-habits">
      <h2 id="day-habits" className="section-title">
        Habits
      </h2>
      {day.isPending ? (
        <p className="muted">Loading…</p>
      ) : day.habits.length === 0 ? (
        <div className="card empty">
          <p>No habits for this day.</p>
          <Link to="/habits/new" className="button">
            Add a habit
          </Link>
        </div>
      ) : (
        <ul className="plain list day-habits" aria-label="Habits">
          {day.habits.map((h) => (
            <DayHabitRow
              key={h.id}
              habit={h}
              date={date}
              values={day.valuesByHabit.get(h.id) ?? EMPTY}
              range={day.window}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

const EMPTY: ValuesByDate = new Map();

const shortDate = (d: ISODate) =>
  new Date(`${d}T00:00:00Z`).toLocaleDateString(undefined, {
    month: 'long',
    day: 'numeric',
    timeZone: 'UTC',
  });

function DayHabitRow({
  habit,
  date,
  values,
  range,
}: {
  habit: Habit;
  date: ISODate;
  values: ValuesByDate;
  range: { from: ISODate; to: ISODate };
}) {
  const { week_start } = useSettings();
  const { data: categories = [] } = useCategories();
  const category = categories.find((c) => c.id === habit.categoryId);
  const status = rowStatus(habit, values, date, week_start);

  return (
    <li className={`list-row day-habit${status.scheduled ? '' : ' unscheduled'}`}>
      <span
        className="dot"
        style={{ '--dot': category?.color ?? 'transparent' } as CSSProperties}
        title={category?.name}
        aria-hidden
      />
      <span className="grow stack-xs">
        <span className="habit-label">{habit.name}</span>
        <span className="small muted day-habit-meta">
          {!status.scheduled && <span>Not scheduled</span>}
          {status.week && (
            <span className="week-dots" aria-label={`${status.week.done} of ${status.week.need} this week`}>
              <span aria-hidden>
                {'●'.repeat(Math.min(status.week.done, status.week.need))}
                {'○'.repeat(Math.max(0, status.week.need - status.week.done))}
              </span>{' '}
              {status.week.done}/{status.week.need} this week
            </span>
          )}
          {status.target && (
            <span className={`target target-${status.target.status}`}>{status.target.text}</span>
          )}
        </span>
      </span>
      <HabitEntryField habit={habit} date={date} range={range} label={`${habit.name}, ${shortDate(date)}`} />
    </li>
  );
}
