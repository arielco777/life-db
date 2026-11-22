import { useId, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useGoalActions } from './hooks';
import { monthOf, monthRange } from '@/domain/services/dates';
import { restDaysLogged } from '@/domain/services/schedule';
import { computeStats } from '@/domain/services/stats';
import { valuesByHabit, type ValuesByDate } from '@/domain/services/targets';
import type { Goal, Habit } from '@/domain/types';
import { useEntries } from '@/features/habits/entryHooks';
import { useHabits } from '@/features/habits/hooks';
import { monthTitle } from '@/features/month/labels';
import { summaryLines } from '@/features/month/summary';
import { useSettings, useToday } from '@/features/settings/hooks';

const EMPTY: ValuesByDate = new Map();

/**
 * Habits that help with the goal (tasks 11.6, GOAL-5), each with its stats for the current
 * month, plus linking and unlinking. A habit can serve several goals.
 */
export function LinkedHabits({ goal }: { goal: Goal }) {
  const ids = useId();
  const today = useToday();
  const { week_start } = useSettings();
  const { data: habits = [] } = useHabits();
  const { setHabits } = useGoalActions();
  const month = monthOf(today);
  const range = monthRange(month);
  const linked = goal.habitIds.map((id) => habits.find((h) => h.id === id)).filter((h): h is Habit => !!h);
  const { data: entries } = useEntries(range, goal.habitIds);
  const byHabit = useMemo(() => valuesByHabit(entries ?? []), [entries]);
  const linkable = habits.filter((h) => !h.archivedAt && !goal.habitIds.includes(h.id));
  const [pick, setPick] = useState('');

  const stats = (h: Habit) => {
    const values = byHabit.get(h.id) ?? EMPTY;
    const s = computeStats(h, values, range, { weekStart: week_start, today });
    return summaryLines(h, s, undefined, restDaysLogged(h, values, range));
  };

  return (
    <section className="stack-sm" aria-labelledby={`${ids}-heading`}>
      <h2 id={`${ids}-heading`}>Habits</h2>
      {linked.length === 0 ? (
        <p className="small muted">
          Link the habits that move this goal forward, e.g. “Study French” for “Learn French”.
        </p>
      ) : (
        <ul className="plain list" aria-label="Linked habits">
          {linked.map((h) => {
            const s = stats(h);
            return (
              <li key={h.id} className="list-row">
                <span className="grow stack-xs">
                  <Link to={`/habits/${h.id}`} className="habit-name">
                    {h.name}
                  </Link>
                  <span className="small muted" aria-label={`${monthTitle(month)}: ${s.label}`}>
                    {monthTitle(month)}: {[s.main, s.sub].filter(Boolean).join(' · ')}
                  </span>
                </span>
                {h.archivedAt && <span className="badge">Archived</span>}
                <button
                  type="button"
                  className="secondary small-button"
                  aria-label={`Unlink ${h.name}`}
                  onClick={() =>
                    setHabits.mutate({ goalId: goal.id, habitIds: goal.habitIds.filter((x) => x !== h.id) })
                  }
                >
                  Unlink
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {linkable.length > 0 && (
        <form
          className="row"
          onSubmit={(e) => {
            e.preventDefault();
            if (!pick) return;
            setHabits.mutate(
              { goalId: goal.id, habitIds: [...goal.habitIds, pick] },
              { onSuccess: () => setPick('') },
            );
          }}
        >
          <select aria-label="Habit to link" value={pick} onChange={(e) => setPick(e.target.value)}>
            <option value="">Choose a habit…</option>
            {linkable.map((h) => (
              <option key={h.id} value={h.id}>
                {h.name}
              </option>
            ))}
          </select>
          <button type="submit" className="secondary" disabled={!pick || setHabits.isPending}>
            Link habit
          </button>
        </form>
      )}
    </section>
  );
}
