import { lazy, Suspense, useId, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { editedLaterOn, localDateOf } from './edited';
import { useDeleteJournalEntry } from './hooks';
import { useJournalDraft, type SaveStatus } from './useJournalDraft';
import { isISODate } from '@/domain/services/clock';
import type { ISODate, JournalEntry } from '@/domain/types';
import { CategorySelect } from '@/features/categories/CategorySelect';
import { formatDate } from '@/features/habits/describe';
import { TagInput } from '@/features/tags/TagInput';
import { ConfirmDialog } from '@/ui/ConfirmDialog';

// The Markdown renderer is only needed for Preview, so it loads on first use.
const MarkdownView = lazy(() => import('./MarkdownView').then((m) => ({ default: m.MarkdownView })));

const STATUS_TEXT: Record<SaveStatus, string> = {
  idle: '',
  dirty: 'Saving…',
  saving: 'Saving…',
  saved: 'Saved',
  error: 'Couldn’t save',
};

interface Props {
  /** The entry to edit; undefined for a new one. */
  entry?: JournalEntry;
  /** Entry date for a new entry. */
  defaultDate: ISODate;
  onCreated?(entry: JournalEntry): void;
}

/**
 * The journal editor (tasks 7.2, 7.3, 7.5): title, Markdown body with preview, entry date,
 * category and tags, all autosaved (JRN-1, JRN-3, JRN-4, JRN-6). There is no Save button.
 */
export function JournalEditor({ entry, defaultDate, onCreated }: Props) {
  const ids = useId();
  const navigate = useNavigate();
  const location = useLocation();
  const { draft, change, saved, status, flush, stop } = useJournalDraft({ entry, defaultDate, onCreated });
  const [preview, setPreview] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const remove = useDeleteJournalEntry();
  const edited = saved && editedLaterOn(saved);

  const deleteEntry = async () => {
    if (!saved) return;
    await stop();
    remove.mutate(saved.id, {
      // Back to wherever the entry was opened from; the journal when opened directly.
      onSuccess: () => (location.key === 'default' ? navigate('/journal') : navigate(-1)),
    });
  };

  return (
    <section className="stack journal-editor">
      <Link to={`/day/${draft.entryDate}`} className="small">
        ← {formatDate(draft.entryDate)}
      </Link>
      <header className="page-header">
        <h1 className="page-title">{saved ? 'Journal entry' : 'New journal entry'}</h1>
        <span className="small muted save-status" role="status" aria-label="Save status">
          {STATUS_TEXT[status]}
          {status === 'error' && (
            <button type="button" className="link-button" onClick={() => void flush()}>
              Retry
            </button>
          )}
        </span>
      </header>
      {saved && (
        <p className="small muted journal-meta">
          Written {formatDate(localDateOf(saved.createdAt))}
          {edited && ` · edited ${formatDate(edited)}`}
        </p>
      )}

      <input
        className="journal-title"
        aria-label="Title"
        placeholder="Title (optional)"
        value={draft.title}
        onChange={(e) => change({ title: e.target.value })}
        onBlur={() => void flush()}
      />

      <div className="journal-body-head row">
        <span className="small muted">{preview ? 'Preview' : 'Markdown: **bold**, _italic_, - lists'}</span>
        <button
          type="button"
          className="secondary small-button"
          aria-pressed={preview}
          onClick={() => setPreview((p) => !p)}
        >
          Preview
        </button>
      </div>
      {preview ? (
        <Suspense fallback={<p className="muted">Loading preview…</p>}>
          <MarkdownView text={draft.body} label="Entry preview" />
        </Suspense>
      ) : (
        <textarea
          className="journal-body"
          aria-label="Entry"
          placeholder="Write about this day…"
          rows={14}
          autoFocus={!entry}
          value={draft.body}
          onChange={(e) => change({ body: e.target.value })}
          onBlur={() => void flush()}
        />
      )}

      <div className="form-grid">
        <div className="field">
          <label htmlFor={`${ids}-date`}>Date</label>
          <input
            id={`${ids}-date`}
            type="date"
            value={draft.entryDate}
            onChange={(e) =>
              isISODate(e.target.value) && change({ entryDate: e.target.value }, { now: true })
            }
          />
        </div>
        <div className="field">
          <label htmlFor={`${ids}-cat`}>
            Category <span className="small muted">· Optional</span>
          </label>
          <CategorySelect
            id={`${ids}-cat`}
            value={draft.categoryId}
            onChange={(v) => change({ categoryId: v }, { now: true })}
          />
        </div>
      </div>
      <div className="field">
        <label htmlFor={`${ids}-tags`}>Tags</label>
        <TagInput
          id={`${ids}-tags`}
          value={draft.tagIds}
          onChange={(v) => change({ tagIds: v }, { now: true })}
        />
      </div>

      {saved && (
        <div className="row">
          <button type="button" className="secondary" onClick={() => setConfirmDelete(true)}>
            Delete
          </button>
        </div>
      )}

      {confirmDelete && (
        <ConfirmDialog
          title="Delete this entry?"
          confirmLabel="Delete entry"
          danger
          busy={remove.isPending}
          onCancel={() => setConfirmDelete(false)}
          onConfirm={() => void deleteEntry()}
        >
          <p>The entry will be removed from the journal and the daily view.</p>
        </ConfirmDialog>
      )}
    </section>
  );
}
