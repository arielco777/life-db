import { useState, type CSSProperties } from 'react';
import { Link, Navigate, Route, Routes, useNavigate, useParams } from 'react-router-dom';
import { eventDates, eventLength } from './describe';
import { draftFrom, EventForm } from './EventForm';
import { useEvent, useEventActions, useEvents } from './hooks';
import type { LifeEventPatch, NewLifeEvent } from '@/domain/repositories';
import type { Category, LifeEvent } from '@/domain/types';
import { useCategories } from '@/features/categories/hooks';
import { useFormatDate, useToday } from '@/features/settings/hooks';
import { ConfirmDialog } from '@/ui/ConfirmDialog';

/** /events/* (design §6.6). */
export function EventRoutes() {
  return (
    <Routes>
      <Route index element={<EventsPage />} />
      <Route path=":id" element={<EditEventPage />} />
      <Route path="*" element={<Navigate to="/events" replace />} />
    </Routes>
  );
}

/** /events (tasks 12.2): a quick-add form, then every event grouped by year, newest first (EVT-3). */
function EventsPage() {
  const today = useToday();
  const { data: events = [], isPending, error } = useEvents();
  const { data: categories = [] } = useCategories();
  const { create } = useEventActions();
  const catById = new Map(categories.map((c) => [c.id, c]));

  const years = new Map<string, LifeEvent[]>();
  for (const e of events) {
    const y = e.startDate.slice(0, 4);
    years.set(y, [...(years.get(y) ?? []), e]);
  }

  return (
    <section className="stack">
      <h1 className="page-title">Life events</h1>
      <section className="card stack-sm" aria-labelledby="add-event">
        <h2 id="add-event">Add an event</h2>
        <EventForm
          quick
          initial={draftFrom(undefined, today)}
          submitLabel="Add event"
          busy={create.isPending}
          onSubmit={(input) => create.mutateAsync(input)}
        />
      </section>

      {isPending && <p className="muted">Loading…</p>}
      {error && <p className="error">Couldn't load events.</p>}
      {!isPending && events.length === 0 && (
        <p className="muted card empty">
          No events yet. Note the things that happened — a trip, a move, a new job — and they'll show on those
          days.
        </p>
      )}

      {[...years].map(([year, list]) => (
        <section key={year} className="stack-sm" aria-labelledby={`events-${year}`}>
          <h2 id={`events-${year}`}>{year}</h2>
          <ul className="plain list" aria-label={`Events in ${year}`}>
            {list.map((e) => (
              <EventRow key={e.id} event={e} category={catById.get(e.categoryId ?? '')} />
            ))}
          </ul>
        </section>
      ))}
    </section>
  );
}

function EventRow({ event: e, category }: { event: LifeEvent; category?: Category }) {
  const formatDate = useFormatDate();
  const days = eventLength(e);
  return (
    <li className="list-row">
      <span
        className="dot"
        style={{ '--dot': category?.color ?? 'transparent' } as CSSProperties}
        title={category?.name}
        aria-hidden
      />
      <span className="grow stack-xs">
        <Link to={`/events/${e.id}`} className="habit-name">
          {e.name}
        </Link>
        <span className="small muted">
          {eventDates(e, formatDate)}
          {days > 1 && ` · ${days} days`}
          {category && ` · ${category.name}`}
        </span>
      </span>
      <Link to={`/day/${e.startDate}`} className="small" aria-label={`Open ${e.name} in the daily view`}>
        Day ›
      </Link>
    </li>
  );
}

/** Every form field is sent; optional ones that were emptied become `null` (cleared). */
const toPatch = (input: NewLifeEvent): LifeEventPatch => ({
  name: input.name,
  description: input.description ?? null,
  startDate: input.startDate,
  endDate: input.endDate ?? null,
  categoryId: input.categoryId ?? null,
  tagIds: input.tagIds ?? [],
});

/** /events/:id (tasks 12.2): edit or delete an event. */
function EditEventPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const today = useToday();
  const { data: event, isPending } = useEvent(id);
  const { update, remove } = useEventActions();
  const [confirmDelete, setConfirmDelete] = useState(false);
  if (isPending) return <p className="muted">Loading…</p>;
  if (!event)
    return (
      <section className="stack">
        <p className="muted">This event doesn't exist or was deleted.</p>
        <Link to="/events">← Events</Link>
      </section>
    );

  return (
    <section className="stack">
      <Link to="/events" className="small">
        ← Events
      </Link>
      <h1 className="page-title">Edit event</h1>
      <EventForm
        initial={draftFrom(event, today)}
        submitLabel="Save changes"
        busy={update.isPending}
        onCancel={() => navigate('/events')}
        onSubmit={(input) =>
          update.mutate({ id, patch: toPatch(input) }, { onSuccess: () => navigate('/events') })
        }
      />
      <div className="row danger-zone">
        <button type="button" className="secondary" onClick={() => setConfirmDelete(true)}>
          Delete
        </button>
      </div>
      {confirmDelete && (
        <ConfirmDialog
          title={`Delete “${event.name}”?`}
          confirmLabel="Delete event"
          danger
          busy={remove.isPending}
          onCancel={() => setConfirmDelete(false)}
          onConfirm={() => remove.mutate(event.id, { onSuccess: () => navigate('/events') })}
        >
          <p>It will no longer show in the daily and monthly views.</p>
        </ConfirmDialog>
      )}
    </section>
  );
}
