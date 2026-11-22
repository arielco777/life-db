import { useId, useState } from 'react';
import { Link } from 'react-router-dom';
import { isFinished, STATUS_LABELS } from './describe';
import { useGoalActions, useGoals, useMonthGoals } from './hooks';
import { ProgressBar } from './ProgressBar';
import type { ISOMonth } from '@/domain/types';
import { MONTH_NAMES } from '@/features/month/labels';

/**
 * The month's goals under the monthly grid (tasks 11.7, MON-7, GOAL-6): status and progress,
 * a quick "add a goal for this month", and adding an existing goal to the month.
 */
export function MonthGoals({ ym }: { ym: ISOMonth }) {
  const ids = useId();
  const { data: goals = [], isPending } = useMonthGoals(ym);
  const { data: all = [] } = useGoals();
  const { create, setMonths } = useGoalActions();
  const [title, setTitle] = useState('');
  const [pick, setPick] = useState('');
  const monthName = MONTH_NAMES[Number(ym.slice(5)) - 1]!;
  const addable = all.filter((g) => !isFinished(g.status) && !g.months.includes(ym));

  const addExisting = (id: string) => {
    const g = all.find((x) => x.id === id);
    if (g) setMonths.mutate({ goalId: g.id, months: [...g.months, ym] }, { onSuccess: () => setPick('') });
  };

  return (
    <section className="day-section stack-sm" aria-labelledby={`${ids}-heading`}>
      <h2 id={`${ids}-heading`} className="section-title">
        Goals for {monthName}
      </h2>
      {!isPending && goals.length === 0 && <p className="small muted">No goals for this month yet.</p>}
      {goals.length > 0 && (
        <ul className="plain list" aria-label={`Goals for ${monthName}`}>
          {goals.map((g) => (
            <li key={g.id} className="list-row goal-row">
              <span className="grow stack-xs">
                <Link to={`/goals/${g.id}`} className="habit-name">
                  {g.title}
                </Link>
                {g.status !== 'active' && <span className="small muted">{STATUS_LABELS[g.status]}</span>}
              </span>
              <ProgressBar goal={g} label={`${g.title} progress`} />
              <button
                type="button"
                className="ghost small-button"
                aria-label={`Remove ${g.title} from ${monthName}`}
                onClick={() => setMonths.mutate({ goalId: g.id, months: g.months.filter((m) => m !== ym) })}
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="row">
        <form
          className="row grow"
          onSubmit={(e) => {
            e.preventDefault();
            if (!title.trim()) return;
            create.mutate({ title: title.trim(), months: [ym] }, { onSuccess: () => setTitle('') });
          }}
        >
          <input
            aria-label={`New goal for ${monthName}`}
            className="grow"
            placeholder={`Add a goal for ${monthName}`}
            maxLength={200}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
          <button type="submit" className="secondary" disabled={!title.trim() || create.isPending}>
            Add monthly goal
          </button>
        </form>
        {addable.length > 0 && (
          <select
            aria-label={`Add an existing goal to ${monthName}`}
            value={pick}
            onChange={(e) => {
              setPick(e.target.value);
              if (e.target.value) addExisting(e.target.value);
            }}
          >
            <option value="">Add an existing goal…</option>
            {addable.map((g) => (
              <option key={g.id} value={g.id}>
                {g.title}
              </option>
            ))}
          </select>
        )}
      </div>
    </section>
  );
}
