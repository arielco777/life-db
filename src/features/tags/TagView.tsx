import { Link, useParams } from 'react-router-dom';
import { useTaggedRecords, useTags } from './hooks';
import type { JournalEntry } from '@/domain/types';

const journalLabel = (j: JournalEntry) =>
  j.title ||
  j.body
    ?.split('\n')
    .find((l) => l.trim())
    ?.slice(0, 80) ||
  'Untitled';

/** /settings/tags/:id — every record carrying the tag (TAG-5). Goals and events join in V1.1. */
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

  const empty = data && data.habits.length === 0 && data.journal.length === 0;
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
