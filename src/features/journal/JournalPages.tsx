import { useQuery } from '@tanstack/react-query';
import {
  Link,
  Navigate,
  Route,
  Routes,
  useLocation,
  useNavigate,
  useParams,
  useSearchParams,
} from 'react-router-dom';
import { entryHeadline } from './headline';
import { journalKeys, useJournalEntry } from './hooks';
import { JournalEditor } from './JournalEditor';
import { useRepositories } from '@/app/RepositoryProvider';
import { isISODate } from '@/domain/services/clock';
import type { JournalEntry } from '@/domain/types';
import { formatDate } from '@/features/habits/describe';
import { useToday } from '@/features/settings/hooks';

/** /journal, /journal/new[?date=], /journal/:id (JRN-1…7). */
export function JournalRoutes() {
  return (
    <Routes>
      <Route index element={<JournalHome />} />
      <Route path=":id" element={<JournalEntryRoute />} />
      <Route path="*" element={<Navigate to="/journal" replace />} />
    </Routes>
  );
}

/**
 * `new` and `:id` share one route so that when a new entry's first save creates it, the
 * URL can become `/journal/<id>` (replace, carrying the editor's key in the location
 * state) without remounting the editor mid-sentence.
 */
function JournalEntryRoute() {
  const { id = '' } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const today = useToday();
  const isNew = id === 'new';
  const query = useJournalEntry(isNew ? undefined : id);
  const carriedKey = (location.state as { editorKey?: string } | null)?.editorKey;

  if (isNew) {
    const date = params.get('date');
    const key = location.key;
    return (
      <JournalEditor
        key={key}
        defaultDate={date && isISODate(date) ? date : today}
        onCreated={(e: JournalEntry) =>
          navigate(`/journal/${e.id}`, { replace: true, state: { editorKey: key } })
        }
      />
    );
  }
  if (query.isPending) return <p className="muted">Loading…</p>;
  if (!query.data)
    return (
      <section className="stack">
        <p className="muted">This entry doesn't exist or was deleted.</p>
        <Link to="/journal">← Journal</Link>
      </section>
    );
  return <JournalEditor key={carriedKey ?? id} entry={query.data} defaultDate={query.data.entryDate} />;
}

/** The latest entries. The full feed with filters and paging is task 7.1. */
function JournalHome() {
  const { journal } = useRepositories();
  const recent = useQuery({
    queryKey: [...journalKeys.all, 'recent'],
    queryFn: () => journal.list({}, { limit: 30 }),
  });
  const entries = recent.data?.entries ?? [];

  return (
    <section className="stack">
      <header className="page-header">
        <h1 className="page-title">Journal</h1>
        <Link to="/journal/new" className="button">
          New entry
        </Link>
      </header>
      {recent.isPending ? (
        <p className="muted">Loading…</p>
      ) : entries.length === 0 ? (
        <div className="card empty">
          <p>No journal entries yet.</p>
        </div>
      ) : (
        <ul className="plain list" aria-label="Recent entries">
          {entries.map((e) => (
            <li key={e.id} className="list-row">
              <span className="small muted journal-date">{formatDate(e.entryDate)}</span>
              <Link to={`/journal/${e.id}`} className="grow">
                {entryHeadline(e)}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
