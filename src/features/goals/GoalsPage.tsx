import { useState, type CSSProperties } from 'react';
import { Link } from 'react-router-dom';
import { isFinished, STATUS_LABELS, STATUS_ORDER } from './describe';
import { useGoals } from './hooks';
import { ProgressBar } from './ProgressBar';
import type { Category, Goal } from '@/domain/types';
import {
  CategoryFilter,
  matchesCategory,
  type CategoryFilterValue,
} from '@/features/categories/CategoryFilter';
import { useCategories } from '@/features/categories/hooks';
import { useFormatDate } from '@/features/settings/hooks';

/** /goals (tasks 11.3): goals grouped by status with progress bars, filtered by category (CAT-5). */
export function GoalsPage() {
  const { data: goals = [], isPending, error } = useGoals();
  const { data: categories = [] } = useCategories();
  const [filter, setFilter] = useState<CategoryFilterValue>('all');
  const catById = new Map(categories.map((c) => [c.id, c]));
  const visible = goals.filter((g) => matchesCategory(filter, g.categoryId));

  return (
    <section className="stack">
      <header className="page-header">
        <h1 className="page-title">Goals</h1>
        <Link to="/goals/new" className="button">
          New goal
        </Link>
      </header>

      {goals.length > 0 && (
        <div className="row">
          <CategoryFilter
            value={filter}
            onChange={setFilter}
            usedCategoryIds={goals.map((g) => g.categoryId)}
          />
        </div>
      )}

      {isPending && <p className="muted">Loading…</p>}
      {error && <p className="error">Couldn't load goals.</p>}
      {!isPending && goals.length === 0 && (
        <div className="card empty">
          <p>No goals yet. A goal can have milestones, a target to count toward, and habits that help.</p>
          <Link to="/goals/new" className="button">
            Create your first goal
          </Link>
        </div>
      )}
      {goals.length > 0 && visible.length === 0 && <p className="muted">No goals in this category.</p>}

      {STATUS_ORDER.map((status) => {
        const group = visible.filter((g) => g.status === status);
        if (group.length === 0) return null;
        const list = (
          <ul className="plain list" aria-label={`${STATUS_LABELS[status]} goals`}>
            {group.map((g) => (
              <GoalRow key={g.id} goal={g} category={catById.get(g.categoryId ?? '')} />
            ))}
          </ul>
        );
        // Finished goals are folded away so the list stays about what's in progress.
        return isFinished(status) ? (
          <details key={status} className="goal-section stack-sm">
            <summary>
              {STATUS_LABELS[status]} ({group.length})
            </summary>
            {list}
          </details>
        ) : (
          <section key={status} className="goal-section stack-sm">
            <h2>
              {STATUS_LABELS[status]} <span className="muted">({group.length})</span>
            </h2>
            {list}
          </section>
        );
      })}
    </section>
  );
}

function GoalRow({ goal: g, category }: { goal: Goal; category?: Category }) {
  const formatDate = useFormatDate();
  const details = [
    category?.name,
    g.targetDate && `Target ${formatDate(g.targetDate)}`,
    g.completedAt && `Done ${formatDate(g.completedAt)}`,
  ].filter(Boolean);
  return (
    <li className="list-row goal-row">
      <span
        className="dot"
        style={{ '--dot': category?.color ?? 'transparent' } as CSSProperties}
        title={category?.name}
        aria-hidden
      />
      <span className="grow stack-xs">
        <Link to={`/goals/${g.id}`} className="habit-name">
          {g.title}
        </Link>
        {details.length > 0 && <span className="small muted">{details.join(' · ')}</span>}
      </span>
      <ProgressBar goal={g} label={`${g.title} progress`} />
    </li>
  );
}
