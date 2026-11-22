import { Link, useParams } from 'react-router-dom';
import { useTaggedRecords, useTags } from './hooks';
import type { JournalEntry } from '@/domain/types';
import { STATUS_LABELS } from '@/features/goals/describe';

const journalLabel = (j: JournalEntry) =>
  j.title ||
  j.body
    ?.split('\n')
    .find((l) => l.trim())
    ?.slice(0, 80) ||
  'Untitled';

/** /settings/tags/:id — every record carrying the tag (TAG-5). */
export function TagView() {
  const { id = '' } = useParams();
  const { data: tags, isPending: tagsPending } = useTags();
  const { data, isPending } = useTaggedRecords(id);
  const tag = tags?.find((t) => t.id === id);

  if (!tagsPending && !tag) {
    return (
      <section className="stack">
        <p className="muted">This tag no longer exists.</p>
        <Link to=".." relative="path">
          ← All tags
        </Link>
      </section>
    );
  }

  const empty =
    data &&
    data.habits.length === 0 &&
    data.goals.length === 0 &&
    data.events.length === 0 &&
    data.journal.length === 0;
  return (
    <section className="stack">
      <Link to=".." relative="path" className="small">
        ← All tags
      </Link>
      <h2>#{tag?.name}</h2>
      {isPending && <p className="muted">Loading…</p>}
      {empty && <p className="muted card">Nothing carries this tag yet.</p>}

      {!!data?.habits.length && (
        <div className="stack-sm">
          <h3>Habits</h3>
          <ul className="plain list" aria-label="Habits">
            {data.habits.map((h) => (
              <li key={h.id} className="list-row">
                <Link to={`/habits/${h.id}`} className="grow">
                  {h.name}
                </Link>
                {h.archivedAt && <span className="muted small">archived</span>}
              </li>
            ))}
          </ul>
        </div>
      )}

      {!!data?.goals.length && (
        <div className="stack-sm">
          <h3>Goals</h3>
          <ul className="plain list" aria-label="Goals">
            {data.goals.map((g) => (
              <li key={g.id} className="list-row">
                <Link to={`/goals/${g.id}`} className="grow">
                  {g.title}
                </Link>
                {g.status !== 'active' && (
                  <span className="muted small">{STATUS_LABELS[g.status].toLowerCase()}</span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {!!data?.events.length && (
        <div className="stack-sm">
          <h3>Events</h3>
          <ul className="plain list" aria-label="Events">
            {data.events.map((e) => (
              <li key={e.id} className="list-row">
                <span className="muted small mono">{e.startDate}</span>
                <Link to={`/events/${e.id}`} className="grow">
                  {e.name}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}

      {!!data?.journal.length && (
        <div className="stack-sm">
          <h3>Journal</h3>
          <ul className="plain list" aria-label="Journal entries">
            {data.journal.map((j) => (
              <li key={j.id} className="list-row">
                <span className="muted small mono">{j.entryDate}</span>
                <Link to={`/journal/${j.id}`} className="grow">
                  {journalLabel(j)}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
