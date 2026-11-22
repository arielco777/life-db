import {
  closestCenter,
  DndContext,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { useId, useState, type CSSProperties, type FormEvent } from 'react';
import { useGoalActions } from './hooks';
import type { Goal, Milestone } from '@/domain/types';
import { useFormatDate } from '@/features/settings/hooks';

/** The goal's milestone checklist (tasks 11.5, GOAL-3, GOAL-7): tick, edit, drag reorder, delete, add. */
export function Milestones({ goal }: { goal: Goal }) {
  const { reorderMilestones } = useGoalActions();
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const ids = goal.milestones.map((m) => m.id);
  const onDragEnd = ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) return;
    reorderMilestones.mutate({
      goalId: goal.id,
      ids: arrayMove(ids, ids.indexOf(String(active.id)), ids.indexOf(String(over.id))),
    });
  };

  return (
    <section className="stack-sm" aria-labelledby="milestones-heading">
      <h2 id="milestones-heading">Milestones</h2>
      {goal.progressMode !== 'milestones' && goal.milestones.length > 0 && (
        <p className="small muted">
          This goal's progress isn't measured by milestones, so they don't change it.
        </p>
      )}
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
        <SortableContext items={ids} strategy={verticalListSortingStrategy}>
          <ul className="plain list" aria-label="Milestones">
            {goal.milestones.map((m) => (
              <MilestoneRow key={m.id} goal={goal} milestone={m} sortable={goal.milestones.length > 1} />
            ))}
          </ul>
        </SortableContext>
      </DndContext>
      <AddMilestone goal={goal} />
    </section>
  );
}

function MilestoneRow({
  goal,
  milestone: m,
  sortable,
}: {
  goal: Goal;
  milestone: Milestone;
  sortable: boolean;
}) {
  const formatDate = useFormatDate();
  const { toggleMilestone, removeMilestone } = useGoalActions();
  const [editing, setEditing] = useState(false);
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } =
    useSortable({ id: m.id, disabled: !sortable || editing });
  const style: CSSProperties = { transform: CSS.Transform.toString(transform), transition };
  const done = !!m.completedAt;

  if (editing) {
    return (
      <li ref={setNodeRef} style={style} className="list-row milestone-row editing">
        <MilestoneEditor milestone={m} onDone={() => setEditing(false)} />
      </li>
    );
  }

  const note = done ? `Done ${formatDate(m.completedAt!)}` : m.targetDate && `By ${formatDate(m.targetDate)}`;
  return (
    <li
      ref={setNodeRef}
      style={style}
      className={`list-row milestone-row${done ? ' done' : ''}${isDragging ? ' dragging' : ''}`}
    >
      {sortable && (
        <button
          ref={setActivatorNodeRef}
          type="button"
          className="icon drag-handle"
          aria-label={`Reorder ${m.title}`}
          {...attributes}
          {...listeners}
        >
          ⠿
        </button>
      )}
      <label className="row check-row milestone-title">
        <input
          type="checkbox"
          checked={done}
          onChange={(e) => toggleMilestone.mutate({ goalId: goal.id, id: m.id, done: e.target.checked })}
        />
        <span>{m.title}</span>
      </label>
      {note && <span className="small muted">{note}</span>}
      <span className="row-actions">
        <button
          type="button"
          className="secondary small-button"
          onClick={() => setEditing(true)}
          aria-label={`Edit ${m.title}`}
        >
          Edit
        </button>
        <button
          type="button"
          className="secondary small-button"
          aria-label={`Delete ${m.title}`}
          onClick={() => removeMilestone.mutate(m.id)}
        >
          Delete
        </button>
      </span>
    </li>
  );
}

function MilestoneEditor({ milestone: m, onDone }: { milestone: Milestone; onDone(): void }) {
  const ids = useId();
  const { updateMilestone } = useGoalActions();
  const [title, setTitle] = useState(m.title);
  const [date, setDate] = useState(m.targetDate ?? '');
  const save = (e: FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;
    updateMilestone.mutate(
      { id: m.id, patch: { title: title.trim(), targetDate: date || null } },
      { onSuccess: onDone },
    );
  };
  return (
    <form
      className="row grow"
      onSubmit={save}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.preventDefault();
          onDone();
        }
      }}
    >
      <input
        id={`${ids}-title`}
        aria-label="Milestone"
        className="grow"
        value={title}
        maxLength={500}
        autoFocus
        aria-invalid={!title.trim()}
        onChange={(e) => setTitle(e.target.value)}
      />
      <input
        type="date"
        aria-label="Target date (optional)"
        value={date}
        onChange={(e) => setDate(e.target.value)}
      />
      <button type="submit" className="small-button" disabled={!title.trim() || updateMilestone.isPending}>
        Save
      </button>
      <button type="button" className="secondary small-button" onClick={onDone}>
        Cancel
      </button>
    </form>
  );
}

/** Inline add: Enter adds and keeps focus in the box, so a list can be typed out in one go. */
function AddMilestone({ goal }: { goal: Goal }) {
  const { addMilestone } = useGoalActions();
  const [title, setTitle] = useState('');
  const [date, setDate] = useState('');
  const add = (e: FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;
    addMilestone.mutate(
      { goalId: goal.id, input: { title: title.trim(), targetDate: date || undefined } },
      {
        onSuccess: () => {
          setTitle('');
          setDate('');
        },
      },
    );
  };
  return (
    <form className="row" onSubmit={add} aria-label="Add a milestone">
      <input
        aria-label="New milestone"
        className="grow"
        placeholder={goal.milestones.length ? 'Add a milestone' : 'Add the first milestone, e.g. Finish A1'}
        value={title}
        maxLength={500}
        onChange={(e) => setTitle(e.target.value)}
      />
      <input
        type="date"
        aria-label="New milestone target date (optional)"
        value={date}
        onChange={(e) => setDate(e.target.value)}
      />
      <button type="submit" className="secondary" disabled={!title.trim() || addMilestone.isPending}>
        Add
      </button>
    </form>
  );
}
