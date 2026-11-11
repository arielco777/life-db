import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { journalSaved } from './hooks';
import { onAppClose } from '@/app/closeGuard';
import { useRepositories } from '@/app/RepositoryProvider';
import type { ISODate, JournalEntry, UUID } from '@/domain/types';
import { useToast } from '@/ui/Toast';

/** What the editor edits. Title is '' rather than undefined so inputs stay controlled. */
export interface JournalDraft {
  entryDate: ISODate;
  title: string;
  body: string;
  categoryId?: UUID;
  tagIds: UUID[];
}

/**
 * idle: nothing to say (a new, still-empty entry, or untouched) · dirty: changes waiting
 * for the debounce · saving · saved · error: the last save failed; the next change or a
 * retry tries again.
 */
export type SaveStatus = 'idle' | 'dirty' | 'saving' | 'saved' | 'error';

/** Typing pauses this long before a save (JRN-4, design §6.5). */
export const AUTOSAVE_MS = 800;

export const draftOf = (e: JournalEntry): JournalDraft => ({
  entryDate: e.entryDate,
  title: e.title ?? '',
  body: e.body,
  categoryId: e.categoryId,
  tagIds: e.tagIds,
});

const isBlank = (d: JournalDraft) => !d.title.trim() && !d.body.trim();
const sameTags = (a: UUID[], b: UUID[]) => a.length === b.length && a.every((t, i) => t === b[i]);
const same = (a: JournalDraft, b: JournalDraft) =>
  a.entryDate === b.entryDate &&
  a.title === b.title &&
  a.body === b.body &&
  a.categoryId === b.categoryId &&
  sameTags(a.tagIds, b.tagIds);

interface Options {
  /** The entry being edited; undefined for a new one. Read once, on mount. */
  entry?: JournalEntry;
  /** Entry date of a new entry. */
  defaultDate: ISODate;
  /** Called once, after a new entry's first save creates it. */
  onCreated?(entry: JournalEntry): void;
}

/**
 * Local draft of a journal entry with autosave (JRN-4): text changes save after
 * `AUTOSAVE_MS` of quiet, other changes (date, category, tags) save at once, and
 * `flush()` saves now: on blur, when the editor unmounts, and before the app closes.
 * Saves run one at a time, each sending the latest draft. A new entry is created by its
 * first save that has a title or some text, so opening "New entry" and leaving leaves
 * nothing behind.
 */
export function useJournalDraft({ entry, defaultDate, onCreated }: Options) {
  const { journal } = useRepositories();
  const qc = useQueryClient();
  const toast = useToast();
  const initial = (): JournalDraft =>
    entry ? draftOf(entry) : { entryDate: defaultDate, title: '', body: '', tagIds: [] };
  const [draft, setDraft] = useState(initial);
  const [saved, setSaved] = useState(entry);
  const [status, setStatus] = useState<SaveStatus>('idle');

  const latest = useRef(draft);
  const lastSaved = useRef(draft);
  const id = useRef(entry?.id);
  const stopped = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  /** Saves run in order, one at a time. */
  const chain = useRef<Promise<void>>(Promise.resolve());
  const onCreatedRef = useRef(onCreated);
  useLayoutEffect(() => {
    onCreatedRef.current = onCreated;
  });

  const engine = useMemo(() => {
    const save = async () => {
      const d = latest.current;
      if (stopped.current || same(d, lastSaved.current) || (!id.current && isBlank(d))) return;
      setStatus('saving');
      try {
        const tagsChanged = !sameTags(d.tagIds, lastSaved.current.tagIds);
        const fields = { entryDate: d.entryDate, body: d.body, tagIds: d.tagIds };
        const created = !id.current;
        const e = id.current
          ? await journal.update(id.current, {
              ...fields,
              title: d.title.trim() || null,
              categoryId: d.categoryId ?? null,
            })
          : await journal.create({ ...fields, title: d.title.trim() || undefined, categoryId: d.categoryId });
        id.current = e.id;
        lastSaved.current = d;
        setSaved(e);
        setStatus(same(latest.current, d) ? 'saved' : 'dirty');
        void journalSaved(qc, e, tagsChanged);
        if (created) onCreatedRef.current?.(e);
      } catch (err) {
        setStatus('error');
        toast.error(err);
      }
    };

    return {
      /** Saves pending changes now; resolves when this and earlier saves are done. */
      flush(): Promise<void> {
        clearTimeout(timer.current);
        chain.current = chain.current.then(save);
        return chain.current;
      },
      /** Stops all saving (before a delete); resolves once an in-flight save is done. */
      stop(): Promise<void> {
        stopped.current = true;
        clearTimeout(timer.current);
        return chain.current;
      },
    };
  }, [journal, qc, toast]);

  /** Applies a change. Text waits for a pause in typing; anything else saves at once. */
  const change = (patch: Partial<JournalDraft>, { now = false } = {}) => {
    const next = { ...latest.current, ...patch };
    latest.current = next;
    setDraft(next);
    setStatus(!id.current && isBlank(next) ? 'idle' : 'dirty');
    clearTimeout(timer.current);
    if (now) void engine.flush();
    else timer.current = setTimeout(() => void engine.flush(), AUTOSAVE_MS);
  };

  // Nothing typed is lost: save when the editor goes away and before the app closes.
  useEffect(() => {
    const off = onAppClose(engine.flush);
    return () => {
      off();
      void engine.flush();
    };
  }, [engine]);

  return { draft, change, saved, status, flush: engine.flush, stop: engine.stop };
}
