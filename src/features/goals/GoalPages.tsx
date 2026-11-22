import { useId, useState, type CSSProperties } from 'react';
import { Link, Navigate, Route, Routes, useNavigate, useParams } from 'react-router-dom';
import { STATUS_LABELS, STATUS_ORDER } from './describe';
import { draftFrom, GoalForm } from './GoalForm';
import { GoalsPage } from './GoalsPage';
import { useGoal, useGoalActions } from './hooks';
import { GoalMonths } from './GoalMonths';
import { LinkedHabits } from './LinkedHabits';
import { Milestones } from './Milestones';
import { ProgressBar } from './ProgressBar';
import type { GoalPatch, NewGoal } from '@/domain/repositories';
import { formatNumber } from '@/domain/services/format';
import type { Goal, GoalStatus } from '@/domain/types';
import { useCategories } from '@/features/categories/hooks';
import { parseNumber } from '@/features/habits/inputs/NumberInput';
import { useFormatDate } from '@/features/settings/hooks';
import { useTags } from '@/features/tags/hooks';
import { ConfirmDialog } from '@/ui/ConfirmDialog';

/** /goals/* (design §6.4). */
export function GoalRoutes() {
  return (
    <Routes>
      <Route index element={<GoalsPage />} />
      <Route path="new" element={<NewGoalPage />} />
      <Route path=":id" element={<GoalDetailPage />} />
      <Route path=":id/edit" element={<EditGoalPage />} />
      <Route path="*" element={<Navigate to="/goals" replace />} />
    </Routes>
  );
}

function NewGoalPage() {
  const navigate = useNavigate();
  const { create } = useGoalActions();
  return (
    <section className="stack">
      <Link to="/goals" className="small">
        ← Goals
      </Link>
      <h1 className="page-title">New goal</h1>
      <GoalForm
        initial={draftFrom()}
        submitLabel="Create goal"
        busy={create.isPending}
        onCancel={() => navigate('/goals')}
        onSubmit={(input) => create.mutate(input, { onSuccess: (g) => navigate(`/goals/${g.id}`) })}
      />
    </section>
  );
}

/** Edit patch: every form field is sent, and optional ones that were emptied become `null`. */
const toPatch = (input: NewGoal): GoalPatch => ({
  title: input.title,
  description: input.description ?? null,
  categoryId: input.categoryId ?? null,
  priority: input.priority,
  status: input.status,
  progressMode: input.progressMode,
  progressManual: input.progressManual ?? null,
  progressCurrent: input.progressCurrent ?? null,
  progressTarget: input.progressTarget ?? null,
  progressUnit: input.progressUnit ?? null,
  startDate: input.startDate ?? null,
  targetDate: input.targetDate ?? null,
  tagIds: input.tagIds ?? [],
});

function EditGoalPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const { data: goal, isPending } = useGoal(id);
  const { update } = useGoalActions();
  if (isPending) return <p className="muted">Loading…</p>;
  if (!goal) return <Missing />;
  return (
    <section className="stack">
      <Link to={`/goals/${id}`} className="small">
        ← {goal.title}
      </Link>
      <h1 className="page-title">Edit goal</h1>
      <GoalForm
        initial={draftFrom(goal)}
        submitLabel="Save changes"
        busy={update.isPending}
        onCancel={() => navigate(`/goals/${id}`)}
        onSubmit={(input) =>
          update.mutate({ id, patch: toPatch(input) }, { onSuccess: () => navigate(`/goals/${id}`) })
        }
      />
    </section>
  );
}

function Missing() {
  return (
    <section className="stack">
      <p className="muted">This goal doesn't exist or was deleted.</p>
      <Link to="/goals">← Goals</Link>
    </section>
  );
}

function GoalDetailPage() {
  const { id = '' } = useParams();
  const { data: goal, isPending } = useGoal(id);
  if (isPending) return <p className="muted">Loading…</p>;
  if (!goal) return <Missing />;
  return <GoalDetail goal={goal} />;
}

function GoalDetail({ goal }: { goal: Goal }) {
  const ids = useId();
  const navigate = useNavigate();
  const formatDate = useFormatDate();
  const { data: categories = [] } = useCategories();
  const { data: tags = [] } = useTags();
  const { update, remove } = useGoalActions();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const category = categories.find((c) => c.id === goal.categoryId);
  const tagNames = goal.tagIds.map((t) => tags.find((x) => x.id === t)?.name).filter(Boolean);

  return (
    <section className="stack">
      <Link to="/goals" className="small">
        ← Goals
      </Link>
      <header className="page-header">
        <h1 className="page-title">{goal.title}</h1>
        <Link to="edit" className="button secondary">
          Edit
        </Link>
      </header>

      <div className="card stack-sm">
        <div className="row">
          <label htmlFor={`${ids}-status`} className="muted">
            Status
          </label>
          <select
            id={`${ids}-status`}
            value={goal.status}
            onChange={(e) => update.mutate({ id: goal.id, patch: { status: e.target.value as GoalStatus } })}
          >
            {STATUS_ORDER.map((s) => (
              <option key={s} value={s}>
                {STATUS_LABELS[s]}
              </option>
            ))}
          </select>
          {goal.completedAt && <span className="small muted">Completed {formatDate(goal.completedAt)}</span>}
        </div>
        <ProgressControl goal={goal} />
      </div>

      <dl className="facts">
        <dt>Category</dt>
        <dd>
          {category ? (
            <>
              <span className="dot" style={{ '--dot': category.color } as CSSProperties} aria-hidden />{' '}
              {category.name}
              {category.archivedAt && ' (archived)'}
            </>
          ) : (
            <span className="muted">None</span>
          )}
        </dd>
        <dt>Priority</dt>
        <dd>{goal.priority[0]!.toUpperCase() + goal.priority.slice(1)}</dd>
        {goal.startDate && (
          <>
            <dt>Started</dt>
            <dd>{formatDate(goal.startDate)}</dd>
          </>
        )}
        {goal.targetDate && (
          <>
            <dt>Target date</dt>
            <dd>{formatDate(goal.targetDate)}</dd>
          </>
        )}
        {tagNames.length > 0 && (
          <>
            <dt>Tags</dt>
            <dd>{tagNames.map((n) => `#${n}`).join(' ')}</dd>
          </>
        )}
      </dl>
      {goal.description && <p className="description">{goal.description}</p>}

      <Milestones goal={goal} />
      <LinkedHabits goal={goal} />
      <GoalMonths goal={goal} />

      <div className="row danger-zone">
        <button type="button" className="secondary" onClick={() => setConfirmDelete(true)}>
          Delete
        </button>
      </div>

      {confirmDelete && (
        <ConfirmDialog
          title={`Delete “${goal.title}”?`}
          confirmLabel="Delete goal"
          danger
          busy={remove.isPending}
          onCancel={() => setConfirmDelete(false)}
          onConfirm={() => remove.mutate(goal.id, { onSuccess: () => navigate('/goals') })}
        >
          <p>
            The goal and its milestones will be deleted. Linked habits stay, with their history. To keep the
            goal on record, mark it completed or abandoned instead.
          </p>
        </ConfirmDialog>
      )}
    </section>
  );
}

/** The progress bar, plus the control that moves it in manual and numeric modes (GOAL-4). */
function ProgressControl({ goal }: { goal: Goal }) {
  const { update } = useGoalActions();
  const save = (patch: GoalPatch) => update.mutate({ id: goal.id, patch });
  return (
    <div className="progress-control">
      <ProgressBar goal={goal} label="Progress" />
      {goal.progressMode === 'manual' && (
        <NumberField
          key={goal.progressManual ?? ''}
          label="Progress, percent"
          suffix="% done"
          value={goal.progressManual}
          max={100}
          onCommit={(v) => save({ progressManual: v })}
        />
      )}
      {goal.progressMode === 'numeric' && (
        <>
          <NumberField
            key={goal.progressCurrent ?? ''}
            label="Current value"
            suffix={`of ${formatNumber(goal.progressTarget ?? 0)}${goal.progressUnit ? ` ${goal.progressUnit}` : ''}`}
            value={goal.progressCurrent}
            onCommit={(v) => save({ progressCurrent: v })}
          />
          <button
            type="button"
            className="secondary small-button"
            aria-label="Add 1"
            onClick={() => save({ progressCurrent: (goal.progressCurrent ?? 0) + 1 })}
          >
            +1
          </button>
        </>
      )}
    </div>
  );
}

/**
 * A number box that saves once, on Enter or leaving the field, never per keystroke.
 * Escape reverts; invalid text is flagged and not saved. Empty saves as 0.
 */
function NumberField({
  label,
  suffix,
  value,
  max,
  onCommit,
}: {
  label: string;
  suffix: string;
  value: number | undefined;
  max?: number;
  onCommit(v: number): void;
}) {
  const initial = value === undefined ? '' : String(value);
  const [text, setText] = useState(initial);
  const parsed = parseNumber(text);
  const invalid = parsed === null || (max !== undefined && parsed !== undefined && parsed > max);
  const commit = () => {
    if (invalid || text === initial) return;
    onCommit(parsed ?? 0);
  };
  return (
    <span className="row">
      <input
        aria-label={label}
        className="short"
        inputMode="decimal"
        placeholder="0"
        value={text}
        aria-invalid={invalid}
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') e.currentTarget.blur();
          if (e.key === 'Escape') setText(initial);
        }}
      />
      <span className="muted">{suffix}</span>
    </span>
  );
}
