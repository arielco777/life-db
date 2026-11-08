import { useState, type CSSProperties } from 'react';
import { Link, Navigate, Route, Routes, useNavigate, useParams } from 'react-router-dom';
import { describeFrequency, describeRun, describeTarget, runState, TYPE_LABELS } from './describe';
import { HabitEntryField } from './HabitEntryField';
import { draftFrom, HabitForm } from './HabitForm';
import { HabitsPage } from './HabitsPage';
import { useHabit, useHabitActions, useHabitHasEntries } from './hooks';
import type { HabitPatch, NewHabit } from '@/domain/repositories';
import { addDays } from '@/domain/services/dates';
import type { Habit } from '@/domain/types';
import { useCategories } from '@/features/categories/hooks';
import { useSettings, useToday } from '@/features/settings/hooks';
import { useTags } from '@/features/tags/hooks';
import { ConfirmDialog } from '@/ui/ConfirmDialog';

/** /habits/* (design §6.3). */
export function HabitRoutes() {
  return (
    <Routes>
      <Route index element={<HabitsPage />} />
      <Route path="new" element={<NewHabitPage />} />
      <Route path=":id" element={<HabitDetailPage />} />
      <Route path=":id/edit" element={<EditHabitPage />} />
      <Route path="*" element={<Navigate to="/habits" replace />} />
    </Routes>
  );
}

function NewHabitPage() {
  const today = useToday();
  const navigate = useNavigate();
  const { create } = useHabitActions();
  return (
    <section className="stack">
      <Link to="/habits" className="small">
        ← Habits
      </Link>
      <h1 className="page-title">New habit</h1>
      <HabitForm
        initial={draftFrom(undefined, today)}
        submitLabel="Create habit"
        busy={create.isPending}
        onCancel={() => navigate('/habits')}
        onSubmit={(input) => create.mutate(input, { onSuccess: (h) => navigate(`/habits/${h.id}`) })}
      />
    </section>
  );
}

/** Edit patch: every field is sent, and optional ones that were emptied become `null` (cleared). */
const toPatch = (input: NewHabit, locked: boolean): HabitPatch => ({
  name: input.name,
  description: input.description ?? null,
  ...(locked ? {} : { type: input.type }),
  unit: input.unit ?? null,
  ratingScale: input.ratingScale ?? null,
  target: input.target ?? null,
  frequency: input.frequency,
  categoryId: input.categoryId ?? null,
  priority: input.priority,
  startDate: input.startDate,
  endDate: input.endDate ?? null,
  tagIds: input.tagIds ?? [],
});

function EditHabitPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const today = useToday();
  const { data: habit, isPending } = useHabit(id);
  const { data: locked, isPending: lockPending } = useHabitHasEntries(id);
  const { update } = useHabitActions();
  if (isPending || lockPending) return <p className="muted">Loading…</p>;
  if (!habit) return <Missing />;
  return (
    <section className="stack">
      <Link to={`/habits/${id}`} className="small">
        ← {habit.name}
      </Link>
      <h1 className="page-title">Edit habit</h1>
      <HabitForm
        initial={draftFrom(habit, today)}
        locked={!!locked}
        submitLabel="Save changes"
        busy={update.isPending}
        onCancel={() => navigate(`/habits/${id}`)}
        onSubmit={(input) =>
          update.mutate(
            { id, patch: toPatch(input, !!locked) },
            { onSuccess: () => navigate(`/habits/${id}`) },
          )
        }
      />
    </section>
  );
}

function Missing() {
  return (
    <section className="stack">
      <p className="muted">This habit doesn't exist or was deleted.</p>
      <Link to="/habits">← Habits</Link>
    </section>
  );
}

const dayLabel = (d: string) =>
  new Date(`${d}T00:00:00Z`).toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  });

function HabitDetailPage() {
  const { id = '' } = useParams();
  const { data: habit, isPending } = useHabit(id);
  if (isPending) return <p className="muted">Loading…</p>;
  if (!habit) return <Missing />;
  return <HabitDetail habit={habit} />;
}

function HabitDetail({ habit }: { habit: Habit }) {
  const navigate = useNavigate();
  const today = useToday();
  const { week_start } = useSettings();
  const { data: categories = [] } = useCategories();
  const { data: tags = [] } = useTags();
  const { archive, remove } = useHabitActions();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const category = categories.find((c) => c.id === habit.categoryId);
  const tagNames = habit.tagIds.map((t) => tags.find((x) => x.id === t)?.name).filter(Boolean);
  const target = describeTarget(habit);

  // The last 7 days the habit was active, newest first; one query for the whole week.
  const lastDay = habit.endDate && habit.endDate < today ? habit.endDate : today;
  const week = { from: addDays(lastDay, -6), to: lastDay };
  const days = Array.from({ length: 7 }, (_, i) => addDays(lastDay, -i)).filter((d) => d >= habit.startDate);

  return (
    <section className="stack">
      <Link to="/habits" className="small">
        ← Habits
      </Link>
      <header className="page-header">
        <h1 className="page-title">
          {habit.name}
          {habit.archivedAt ? (
            <span className="badge">Archived</span>
          ) : (
            runState(habit, today) === 'ended' && <span className="badge">Ended</span>
          )}
        </h1>
        <Link to="edit" className="button secondary">
          Edit
        </Link>
      </header>

      <dl className="facts">
        <dt>Type</dt>
        <dd>
          {TYPE_LABELS[habit.type].label}
          {habit.type === 'number' && habit.unit && ` (${habit.unit})`}
          {habit.ratingScale && ` (${habit.ratingScale.min}–${habit.ratingScale.max})`}
        </dd>
        <dt>Schedule</dt>
        <dd>{describeFrequency(habit.frequency, week_start)}</dd>
        {target && (
          <>
            <dt>Target</dt>
            <dd>{target}</dd>
          </>
        )}
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
        <dd>{habit.priority[0]!.toUpperCase() + habit.priority.slice(1)}</dd>
        <dt>Runs</dt>
        <dd>{describeRun(habit, today)}</dd>
        {tagNames.length > 0 && (
          <>
            <dt>Tags</dt>
            <dd>{tagNames.map((n) => `#${n}`).join(' ')}</dd>
          </>
        )}
      </dl>
      {habit.description && <p className="description">{habit.description}</p>}

      {days.length > 0 && (
        <div className="stack-sm">
          <h2>Last 7 days</h2>
          <ul className="plain list" aria-label="Last 7 days">
            {days.map((d) => (
              <li key={d} className="list-row">
                <span className="grow">{d === today ? 'Today' : dayLabel(d)}</span>
                <HabitEntryField
                  habit={habit}
                  date={d}
                  range={week}
                  label={`${habit.name}, ${dayLabel(d)}`}
                />
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="row danger-zone">
        <button
          type="button"
          className="secondary"
          onClick={() => archive.mutate({ id: habit.id, archived: !habit.archivedAt })}
        >
          {habit.archivedAt ? 'Unarchive' : 'Archive'}
        </button>
        <button type="button" className="secondary" onClick={() => setConfirmDelete(true)}>
          Delete
        </button>
        <span className="small muted">
          {habit.archivedAt
            ? 'Archived habits are hidden from the daily and monthly views; their history stays.'
            : 'Archiving hides the habit from the daily and monthly views but keeps its history.'}
        </span>
      </div>

      {confirmDelete && (
        <ConfirmDialog
          title={`Delete “${habit.name}”?`}
          confirmLabel="Delete habit"
          danger
          busy={remove.isPending}
          onCancel={() => setConfirmDelete(false)}
          onConfirm={() => remove.mutate(habit.id, { onSuccess: () => navigate('/habits') })}
        >
          <p>
            The habit and every value logged for it will be deleted. To keep its history, archive it instead.
          </p>
        </ConfirmDialog>
      )}
    </section>
  );
}
