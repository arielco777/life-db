import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { useTagActions, useTags, useTagUsage } from './hooks';
import type { Tag } from '@/domain/types';
import { ConfirmDialog } from '@/ui/ConfirmDialog';

const records = (n: number) => (n === 1 ? '1 record' : `${n} records`);

type Pending = { kind: 'merge'; tag: Tag } | { kind: 'delete'; tag: Tag } | null;

/** Settings → Tags (tasks 3.4): rename, merge and delete tags (TAG-4); each links to its view (TAG-5). */
export function TagsPage() {
  const { data: tags = [], isPending, error } = useTags();
  const { data: usage } = useTagUsage();
  const [pending, setPending] = useState<Pending>(null);
  const count = (t: Tag) => usage?.get(t.id) ?? 0;

  return (
    <section className="stack">
      <header>
        <h2>Tags</h2>
        <p className="muted">
          Tags are shared by habits, journal entries, goals and events. New tags are created by typing them
          into any tag field.
        </p>
      </header>

      {isPending && <p className="muted">Loading…</p>}
      {error && <p className="error">Couldn't load tags.</p>}
      {!isPending && tags.length === 0 && (
        <p className="muted card">
          No tags yet. Add one from a habit or journal entry and it will show up here.
        </p>
      )}

      <ul className="plain list" aria-label="Tags">
        {tags.map((t) => (
          <TagRow
            key={t.id}
            tag={t}
            count={count(t)}
            canMerge={tags.length > 1}
            onMerge={() => setPending({ kind: 'merge', tag: t })}
            onDelete={() => setPending({ kind: 'delete', tag: t })}
          />
        ))}
      </ul>

      {pending?.kind === 'merge' && (
        <MergeDialog
          source={pending.tag}
          others={tags.filter((t) => t.id !== pending.tag.id)}
          count={count(pending.tag)}
          onDone={() => setPending(null)}
        />
      )}
      {pending?.kind === 'delete' && (
        <DeleteDialog tag={pending.tag} count={count(pending.tag)} onDone={() => setPending(null)} />
      )}
    </section>
  );
}

interface TagRowProps {
  tag: Tag;
  count: number;
  canMerge: boolean;
  onMerge(): void;
  onDelete(): void;
}

function TagRow({ tag, count, canMerge, onMerge, onDelete }: TagRowProps) {
  const { rename } = useTagActions();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(tag.name);

  const save = (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    if (name.trim().toLowerCase() === tag.name) return setEditing(false);
    rename.mutate({ id: tag.id, name }, { onSuccess: () => setEditing(false) });
  };

  if (editing) {
    return (
      <li className="list-row editing">
        <form
          onSubmit={save}
          className="row grow"
          aria-label={`Rename ${tag.name}`}
          onKeyDown={(e) => e.key === 'Escape' && setEditing(false)}
        >
          <input
            aria-label="Tag name"
            value={name}
            maxLength={60}
            autoFocus
            onChange={(e) => setName(e.target.value)}
          />
          <button type="submit" disabled={!name.trim() || rename.isPending}>
            Save
          </button>
          <button type="button" className="secondary" onClick={() => setEditing(false)}>
            Cancel
          </button>
        </form>
      </li>
    );
  }

  return (
    <li className="list-row">
      <Link to={tag.id} className="grow tag-link">
        #{tag.name}
      </Link>
      <span className="muted small">{records(count)}</span>
      <span className="row-actions">
        <button
          type="button"
          className="secondary"
          aria-label={`Rename ${tag.name}`}
          onClick={() => {
            setName(tag.name);
            setEditing(true);
          }}
        >
          Rename
        </button>
        <button
          type="button"
          className="secondary"
          aria-label={`Merge ${tag.name}`}
          disabled={!canMerge}
          onClick={onMerge}
        >
          Merge
        </button>
        <button type="button" className="secondary" aria-label={`Delete ${tag.name}`} onClick={onDelete}>
          Delete
        </button>
      </span>
    </li>
  );
}

function MergeDialog({
  source,
  others,
  count,
  onDone,
}: {
  source: Tag;
  others: Tag[];
  count: number;
  onDone(): void;
}) {
  const { merge } = useTagActions();
  const [targetId, setTargetId] = useState(others[0]?.id ?? '');
  const target = others.find((t) => t.id === targetId);

  return (
    <ConfirmDialog
      title={`Merge #${source.name}`}
      confirmLabel="Merge"
      danger
      busy={merge.isPending || !target}
      onCancel={onDone}
      onConfirm={() => merge.mutate({ sourceId: source.id, targetId }, { onSuccess: onDone })}
    >
      <label className="stack-sm">
        <span>Merge into</span>
        <select value={targetId} onChange={(e) => setTargetId(e.target.value)}>
          {others.map((t) => (
            <option key={t.id} value={t.id}>
              #{t.name}
            </option>
          ))}
        </select>
      </label>
      {target && (
        <p>
          {count
            ? `${records(count)} tagged #${source.name} will be tagged #${target.name} instead, and #${source.name} will be deleted.`
            : `#${source.name} isn't used anywhere and will be deleted.`}{' '}
          This can't be undone.
        </p>
      )}
    </ConfirmDialog>
  );
}

function DeleteDialog({ tag, count, onDone }: { tag: Tag; count: number; onDone(): void }) {
  const { remove } = useTagActions();
  return (
    <ConfirmDialog
      title={`Delete #${tag.name}`}
      confirmLabel="Delete"
      danger
      busy={remove.isPending}
      onCancel={onDone}
      onConfirm={() => remove.mutate(tag.id, { onSuccess: onDone })}
    >
      <p>
        {count
          ? `The tag is removed from ${records(count)}. The records themselves are kept.`
          : 'The tag isn’t used anywhere.'}
      </p>
    </ConfirmDialog>
  );
}
