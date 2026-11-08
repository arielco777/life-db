import { useState, type CSSProperties, type FormEvent } from 'react';
import { activeCategories, archivedCategories, useCategories, useCategoryActions } from './hooks';
import type { Category } from '@/domain/types';
import { ColorPicker, PALETTE } from '@/ui/ColorPicker';

/** Settings → Categories (tasks 3.1): create, rename, recolor, archive, reorder (CAT-2, CAT-4). */
export function CategoriesPage() {
  const { data = [], isPending, error } = useCategories();
  const actions = useCategoryActions();
  const active = activeCategories(data);
  const archived = archivedCategories(data);

  const move = (index: number, delta: -1 | 1) => {
    const ids = active.map((c) => c.id);
    const [moved] = ids.splice(index, 1);
    ids.splice(index + delta, 0, moved!);
    actions.reorder.mutate([...ids, ...archived.map((c) => c.id)]);
  };

  return (
    <section className="stack">
      <header>
        <h2>Categories</h2>
        <p className="muted">
          Every habit, journal entry, goal and event can have one category. Archived categories stay on
          existing records but aren't offered for new ones.
        </p>
      </header>

      <NewCategoryForm usedColors={active.map((c) => c.color)} />

      {isPending && <p className="muted">Loading…</p>}
      {error && <p className="error">Couldn't load categories.</p>}

      <ul className="plain list" aria-label="Categories">
        {active.map((c, i) => (
          <CategoryRow
            key={c.id}
            category={c}
            canMoveUp={i > 0}
            canMoveDown={i < active.length - 1}
            onMove={(d) => move(i, d)}
          />
        ))}
      </ul>

      {archived.length > 0 && (
        <details className="archived">
          <summary>Archived ({archived.length})</summary>
          <ul className="plain list" aria-label="Archived categories">
            {archived.map((c) => (
              <li key={c.id} className="list-row">
                <Dot color={c.color} />
                <span className="grow muted">{c.name}</span>
                <button
                  type="button"
                  className="secondary"
                  onClick={() => actions.archive.mutate({ id: c.id, archived: false })}
                  aria-label={`Restore ${c.name}`}
                >
                  Restore
                </button>
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}

function Dot({ color }: { color?: string }) {
  return <span className="dot" style={{ '--dot': color ?? 'var(--border)' } as CSSProperties} aria-hidden />;
}

function NewCategoryForm({ usedColors }: { usedColors: (string | undefined)[] }) {
  const { create } = useCategoryActions();
  const [name, setName] = useState('');
  const [color, setColor] = useState<string | undefined>();
  const suggested = PALETTE.find((p) => !usedColors.includes(p.color))?.color ?? PALETTE[0]!.color;
  const effectiveColor = color ?? suggested;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    create.mutate(
      { name, color: effectiveColor },
      {
        onSuccess: () => {
          setName('');
          setColor(undefined);
        },
      },
    );
  };

  return (
    <form onSubmit={submit} className="card stack-sm" aria-label="New category">
      <div className="row">
        <input
          aria-label="New category name"
          placeholder="New category"
          value={name}
          maxLength={80}
          onChange={(e) => setName(e.target.value)}
        />
        <button type="submit" disabled={!name.trim() || create.isPending}>
          Add
        </button>
      </div>
      <ColorPicker label="New category color" value={effectiveColor} onChange={setColor} />
    </form>
  );
}

interface CategoryRowProps {
  category: Category;
  canMoveUp: boolean;
  canMoveDown: boolean;
  onMove(delta: -1 | 1): void;
}

function CategoryRow({ category: c, canMoveUp, canMoveDown, onMove }: CategoryRowProps) {
  const { update, archive } = useCategoryActions();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(c.name);
  const [color, setColor] = useState(c.color);

  const startEdit = () => {
    setName(c.name);
    setColor(c.color);
    setEditing(true);
  };
  const save = (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    update.mutate({ id: c.id, patch: { name, color } }, { onSuccess: () => setEditing(false) });
  };

  if (editing) {
    return (
      <li className="list-row editing">
        <form
          onSubmit={save}
          className="stack-sm grow"
          aria-label={`Edit ${c.name}`}
          onKeyDown={(e) => e.key === 'Escape' && setEditing(false)}
        >
          <div className="row">
            <input
              aria-label="Category name"
              value={name}
              maxLength={80}
              autoFocus
              onChange={(e) => setName(e.target.value)}
            />
            <button type="submit" disabled={!name.trim() || update.isPending}>
              Save
            </button>
            <button type="button" className="secondary" onClick={() => setEditing(false)}>
              Cancel
            </button>
          </div>
          <ColorPicker label="Category color" value={color} onChange={setColor} />
        </form>
      </li>
    );
  }

  return (
    <li className="list-row">
      <Dot color={c.color} />
      <span className="grow">{c.name}</span>
      <span className="row-actions">
        <button
          type="button"
          className="icon"
          disabled={!canMoveUp}
          onClick={() => onMove(-1)}
          aria-label={`Move ${c.name} up`}
        >
          ↑
        </button>
        <button
          type="button"
          className="icon"
          disabled={!canMoveDown}
          onClick={() => onMove(1)}
          aria-label={`Move ${c.name} down`}
        >
          ↓
        </button>
        <button type="button" className="secondary" onClick={startEdit} aria-label={`Edit ${c.name}`}>
          Edit
        </button>
        <button
          type="button"
          className="secondary"
          onClick={() => archive.mutate({ id: c.id, archived: true })}
          aria-label={`Archive ${c.name}`}
        >
          Archive
        </button>
      </span>
    </li>
  );
}
