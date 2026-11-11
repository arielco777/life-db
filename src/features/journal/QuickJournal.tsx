import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { useCreateJournalEntry } from './hooks';
import type { ISODate } from '@/domain/types';

/**
 * The daily view's "new entry" box (tasks 5.7, DAY-1 §5): type a line, press
 * Ctrl/⌘+Enter or "Add entry". "Full editor" opens a new entry for the date with title,
 * category, tags and Markdown preview (tasks 7.4).
 */
export function QuickJournal({ date, label }: { date: ISODate; label: string }) {
  const [body, setBody] = useState('');
  const create = useCreateJournalEntry();

  const save = (e?: FormEvent) => {
    e?.preventDefault();
    if (!body.trim() || create.isPending) return;
    create.mutate({ entryDate: date, body: body.trim() }, { onSuccess: () => setBody('') });
  };

  return (
    <form className="quick-journal stack-sm" onSubmit={save}>
      <textarea
        aria-label={label}
        rows={3}
        placeholder="Write about this day…"
        value={body}
        onChange={(e) => setBody(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) save();
        }}
      />
      <div className="row">
        <button type="submit" disabled={!body.trim() || create.isPending}>
          Add entry
        </button>
        <span className="small muted grow">Ctrl+Enter to save</span>
        <Link to={`/journal/new?date=${date}`} className="small">
          Full editor
        </Link>
      </div>
    </form>
  );
}
