import { useId, useState } from 'react';
import { Link } from 'react-router-dom';
import type { GoalStatus } from '@/domain/types';
import {
  CategoryFilter,
  matchesCategory,
  type CategoryFilterValue,
} from '@/features/categories/CategoryFilter';
import { useCategories } from '@/features/categories/hooks';
import { STATUS_LABELS, STATUS_ORDER } from '@/features/goals/describe';
import { useGoals } from '@/features/goals/hooks';
import { ProgressBar } from '@/features/goals/ProgressBar';
import { useFormatDate } from '@/features/settings/hooks';

/**
 * Every goal with its status, progress and target date, filtered by status and category
 * (tasks 13.5, ANL-4, CAT-5). Not tied to the period: goals span their own dates.
 */
export function GoalSummary() {
  const ids = useId();
  const formatDate = useFormatDate();
  const { data: goals = [], isPending } = useGoals();
  const { data: categories = [] } = useCategories();
  const [status, setStatus] = useState<GoalStatus | 'all' | 'open'>('open');
  const [category, setCategory] = useState<CategoryFilterValue>('all');
  const catName = new Map(categories.map((c) => [c.id, c.name]));
  const shown = goals
    .filter((g) =>
      status === 'all'
        ? true
        : status === 'open'
          ? g.status !== 'completed' && g.status !== 'abandoned'
          : g.status === status,
    )
    .filter((g) => matchesCategory(category, g.categoryId))
    // Grouped by status like the goals page, user order within each.
    .sort((a, b) => STATUS_ORDER.indexOf(a.status) - STATUS_ORDER.indexOf(b.status));

  return (
    <section className="stack-sm" aria-labelledby={`${ids}-heading`}>
      <h2 id={`${ids}-heading`}>Goals</h2>
      {!isPending && goals.length === 0 ? (
        <p className="small muted">
          No goals yet. <Link to="/goals/new">Create one</Link> to see it here.
        </p>
      ) : (
        <>
          <div className="row">
            <select
              aria-label="Filter goals by status"
              value={status}
              onChange={(e) => setStatus(e.target.value as typeof status)}
            >
              <option value="open">In progress (not finished)</option>
              <option value="all">All statuses</option>
              {STATUS_ORDER.map((s) => (
                <option key={s} value={s}>
                  {STATUS_LABELS[s]}
                </option>
              ))}
            </select>
            <CategoryFilter
              value={category}
              onChange={setCategory}
              usedCategoryIds={goals.map((g) => g.categoryId)}
            />
          </div>
          {shown.length === 0 ? (
            <p className="small muted">No goals match these filters.</p>
          ) : (
            <div className="table-scroll">
              <table className="goal-table">
                <caption className="sr-only">Goals with status, progress and target date</caption>
                <thead>
                  <tr>
                    <th scope="col">Goal</th>
                    <th scope="col">Status</th>
                    <th scope="col">Progress</th>
                    <th scope="col">Target date</th>
                    <th scope="col">Category</th>
                  </tr>
                </thead>
                <tbody>
                  {shown.map((g) => (
                    <tr key={g.id}>
                      <th scope="row">
                        <Link to={`/goals/${g.id}`}>{g.title}</Link>
                      </th>
                      <td>{STATUS_LABELS[g.status]}</td>
                      <td>
                        <ProgressBar goal={g} label={`${g.title} progress`} />
                      </td>
                      <td>{g.targetDate ? formatDate(g.targetDate) : <span className="muted">–</span>}</td>
                      <td>{g.categoryId ? catName.get(g.categoryId) : <span className="muted">–</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </section>
  );
}
