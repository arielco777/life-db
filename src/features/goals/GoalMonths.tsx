import { useId, useState } from 'react';
import { Link } from 'react-router-dom';
import { useGoalActions } from './hooks';
import { addMonths, monthOf } from '@/domain/services/dates';
import type { Goal, ISOMonth } from '@/domain/types';
import { MONTH_NAMES, monthTitle } from '@/features/month/labels';
import { useToday } from '@/features/settings/hooks';

/**
 * "Goal for: Aug 2026, Sep 2026" (tasks 11.7, GOAL-6): the months this goal appears in the
 * monthly view's goal list, like the notebook's "Monthly goals". Picked with month and year
 * selects, since `<input type="month">` isn't supported by every webview.
 */
export function GoalMonths({ goal }: { goal: Goal }) {
  const ids = useId();
  const today = useToday();
  const thisMonth = monthOf(today);
  const { setMonths } = useGoalActions();
  // Suggest the first month from now that isn't picked yet.
  const suggested = (() => {
    let m = thisMonth;
    while (goal.months.includes(m)) m = addMonths(m, 1);
    return m;
  })();
  const [pick, setPick] = useState<ISOMonth>(suggested);
  const year = Number(pick.slice(0, 4));
  const thisYear = Number(thisMonth.slice(0, 4));
  const years = [...new Set([thisYear - 1, thisYear, thisYear + 1, thisYear + 2, year])].sort(
    (a, b) => a - b,
  );
  const already = goal.months.includes(pick);

  const save = (months: ISOMonth[]) => setMonths.mutate({ goalId: goal.id, months });

  return (
    <section className="stack-sm" aria-labelledby={`${ids}-heading`}>
      <h2 id={`${ids}-heading`}>Monthly goal for</h2>
      {goal.months.length === 0 ? (
        <p className="small muted">
          Pick months to list this goal under that month's grid, like a notebook's monthly goals.
        </p>
      ) : (
        <ul className="plain month-chips" aria-label="Months">
          {goal.months.map((m) => (
            <li key={m} className="month-chip">
              <Link to={`/month/${m}`}>{monthTitle(m)}</Link>
              <button
                type="button"
                className="ghost"
                aria-label={`Remove ${monthTitle(m)}`}
                onClick={() => save(goal.months.filter((x) => x !== m))}
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}
      <form
        className="row"
        onSubmit={(e) => {
          e.preventDefault();
          if (already) return;
          save([...goal.months, pick]);
          setPick(addMonths(pick, 1));
        }}
      >
        <select
          aria-label="Month to add"
          value={pick.slice(5)}
          onChange={(e) => setPick(`${pick.slice(0, 4)}-${e.target.value}`)}
        >
          {MONTH_NAMES.map((name, i) => (
            <option key={name} value={String(i + 1).padStart(2, '0')}>
              {name}
            </option>
          ))}
        </select>
        <select
          aria-label="Year to add"
          value={year}
          onChange={(e) => setPick(`${e.target.value}-${pick.slice(5)}`)}
        >
          {years.map((y) => (
            <option key={y} value={y}>
              {y}
            </option>
          ))}
        </select>
        <button type="submit" className="secondary" disabled={already || setMonths.isPending}>
          {already ? 'Already added' : 'Add month'}
        </button>
      </form>
    </section>
  );
}
