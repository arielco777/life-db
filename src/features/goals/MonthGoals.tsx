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
  const { create, setMonths } = useGoalActions();
  const [title, setTitle] = useState('');
  const [picking, setPicking] = useState(false);
  const monthName = MONTH_NAMES[Number(ym.slice(5)) - 1]!;

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
        {picking ? (
          <ExistingGoalPicker ym={ym} monthName={monthName} onDone={() => setPicking(false)} />
        ) : (
          <button type="button" className="secondary" onClick={() => setPicking(true)}>
            Add an existing goal…
          </button>
        )}
      </div>
    </section>
  );
}

/**
 * Unfinished goals not yet in the month. Loaded only when opened: listing every goal is
 * needless work on each month visit (NFR-1).
 */
function ExistingGoalPicker({ ym, monthName, onDone }: { ym: ISOMonth; monthName: string; onDone(): void }) {
  const { data: all, isPending } = useGoals();
  const { setMonths } = useGoalActions();
  const addable = (all ?? []).filter((g) => !isFinished(g.status) && !g.months.includes(ym));
  if (isPending) return <span className="small muted">Loading goals…</span>;
  if (addable.length === 0)
    return (
      <span className="small muted">
        Every unfinished goal is already in {monthName}.{' '}
        <button type="button" className="ghost small-button" onClick={onDone}>
          OK
        </button>
      </span>
    );
  return (
    <select
      aria-label={`Add an existing goal to ${monthName}`}
      value=""
      autoFocus
      onBlur={onDone}
      onKeyDown={(e) => e.key === 'Escape' && onDone()}
      onChange={(e) => {
        const g = addable.find((x) => x.id === e.target.value);
        if (g) setMonths.mutate({ goalId: g.id, months: [...g.months, ym] }, { onSuccess: onDone });
      }}
    >
      <option value="">Choose a goal…</option>
      {addable.map((g) => (
        <option key={g.id} value={g.id}>
          {g.title}
        </option>
      ))}
    </select>
  );
}
