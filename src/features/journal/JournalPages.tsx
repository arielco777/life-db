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
import { useJournalEntry } from './hooks';
import { JournalEditor } from './JournalEditor';
import { JournalFeed } from './JournalFeed';
import { isISODate } from '@/domain/services/clock';
import type { JournalEntry } from '@/domain/types';
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

/** /journal: the feed with its filters (task 7.1). */
function JournalHome() {
  return (
    <section className="stack">
      <header className="page-header">
        <h1 className="page-title">Journal</h1>
        <Link to="/journal/new" className="button">
          New entry
        </Link>
      </header>
      <JournalFeed />
    </section>
  );
}
