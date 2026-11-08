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
import { useState, type CSSProperties } from 'react';
import { Link } from 'react-router-dom';
import { describeFrequency, describeTarget, TYPE_LABELS } from './describe';
import { useHabitActions, useHabits } from './hooks';
import type { Category, Habit } from '@/domain/types';
import {
  CategoryFilter,
  matchesCategory,
  type CategoryFilterValue,
} from '@/features/categories/CategoryFilter';
import { useCategories } from '@/features/categories/hooks';
import { useSettings } from '@/features/settings/hooks';

/** /habits (tasks 4.1): user-ordered list with drag reorder (HAB-10), category filter (CAT-5), archive (HAB-8). */
export function HabitsPage() {
  const { data: habits = [], isPending, error } = useHabits();
  const { data: categories = [] } = useCategories();
  const { reorder, archive } = useHabitActions();
  const [filter, setFilter] = useState<CategoryFilterValue>('all');
  const catById = new Map(categories.map((c) => [c.id, c]));

  const active = habits.filter((h) => !h.archivedAt);
  const archived = habits.filter((h) => h.archivedAt);
  const visible = active.filter((h) => matchesCategory(filter, h.categoryId));
  const visibleArchived = archived.filter((h) => matchesCategory(filter, h.categoryId));
  const filtering = filter !== 'all';

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const onDragEnd = ({ active: a, over }: DragEndEvent) => {
    if (!over || a.id === over.id) return;
    const ids = active.map((h) => h.id);
    const moved = arrayMove(ids, ids.indexOf(String(a.id)), ids.indexOf(String(over.id)));
    reorder.mutate([...moved, ...archived.map((h) => h.id)]);
  };

  return (
    <section className="stack">
      <header className="page-header">
        <h1 className="page-title">Habits</h1>
        <Link to="/habits/new" className="button">
          New habit
        </Link>
      </header>

      {habits.length > 0 && (
        <div className="row">
          <CategoryFilter
            value={filter}
            onChange={setFilter}
            usedCategoryIds={habits.map((h) => h.categoryId)}
          />
          {filtering ? (
            <span className="small muted">Clear the filter to reorder.</span>
          ) : (
            active.length > 1 && <span className="small muted">Drag ⠿ to reorder.</span>
          )}
        </div>
      )}

      {isPending && <p className="muted">Loading…</p>}
      {error && <p className="error">Couldn't load habits.</p>}
      {!isPending && habits.length === 0 && (
        <div className="card empty">
          <p>No habits yet. Start with one thing you'd like to track every day.</p>
          <Link to="/habits/new" className="button">
            Create your first habit
          </Link>
        </div>
      )}
      {filtering && visible.length === 0 && visibleArchived.length === 0 && (
        <p className="muted">No habits in this category.</p>
      )}

      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
        <SortableContext items={visible.map((h) => h.id)} strategy={verticalListSortingStrategy}>
          <ul className="plain list" aria-label="Habits">
            {visible.map((h) => (
              <HabitRow
                key={h.id}
                habit={h}
                category={catById.get(h.categoryId ?? '')}
                sortable={!filtering}
              />
            ))}
          </ul>
        </SortableContext>
      </DndContext>

      {visibleArchived.length > 0 && (
        <details className="archived">
          <summary>Archived ({visibleArchived.length})</summary>
          <ul className="plain list" aria-label="Archived habits">
            {visibleArchived.map((h) => (
              <li key={h.id} className="list-row">
                <Link to={`/habits/${h.id}`} className="grow muted">
                  {h.name}
                </Link>
                <button
                  type="button"
                  className="secondary"
                  aria-label={`Unarchive ${h.name}`}
                  onClick={() => archive.mutate({ id: h.id, archived: false })}
                >
                  Unarchive
                </button>
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}

function HabitRow({
  habit: h,
  category,
  sortable,
}: {
  habit: Habit;
  category?: Category;
  sortable: boolean;
}) {
  const { week_start } = useSettings();
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } =
    useSortable({ id: h.id, disabled: !sortable });
  const style: CSSProperties = { transform: CSS.Transform.toString(transform), transition };
  const target = describeTarget(h);

  return (
    <li ref={setNodeRef} style={style} className={`list-row habit-row${isDragging ? ' dragging' : ''}`}>
      {sortable && (
        <button
          ref={setActivatorNodeRef}
          type="button"
          className="icon drag-handle"
          aria-label={`Reorder ${h.name}`}
          {...attributes}
          {...listeners}
        >
          ⠿
        </button>
      )}
      <span
        className="dot"
        style={{ '--dot': category?.color ?? 'transparent' } as CSSProperties}
        title={category?.name}
        aria-hidden
      />
      <span className="grow stack-xs">
        <Link to={`/habits/${h.id}`} className="habit-name">
          {h.name}
        </Link>
        <span className="small muted">
          {TYPE_LABELS[h.type].label} · {describeFrequency(h.frequency, week_start)}
          {target && ` · ${target}`}
          {category && ` · ${category.name}`}
        </span>
      </span>
    </li>
  );
}
