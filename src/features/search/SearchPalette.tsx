import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useSearch } from './hooks';
import { GROUPS, hitPath, Snippet, tagPath, useHitTitle } from './SearchResults';

/** Results shown in the palette; the search page has the rest. */
const PALETTE_LIMIT = 8;

const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);
export const PALETTE_SHORTCUT = isMac ? '⌘K' : 'Ctrl+K';

/** Opens the palette on Ctrl+K (⌘K on macOS), from anywhere, even while typing (SRCH-1). */
export function useSearchShortcut(open: () => void) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() === 'k' && (e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey) {
        e.preventDefault();
        open();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);
}

interface Option {
  key: string;
  path: string;
  group: string;
  title: string;
  snippet?: string;
}

/**
 * The Ctrl/Cmd+K search palette (tasks 14.4): type, move with ↑/↓, Enter opens the result.
 * With nothing highlighted, Enter opens the full search page. Escape or the backdrop closes it.
 */
export function SearchPalette({ onClose }: { onClose(): void }) {
  const ids = useId();
  const navigate = useNavigate();
  const title = useHitTitle();
  const [q, setQ] = useState('');
  const [active, setActive] = useState(-1);
  const inputRef = useRef<HTMLInputElement>(null);
  const { data, searchable } = useSearch(q, {}, PALETTE_LIMIT);

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    inputRef.current?.focus();
    return () => previous?.focus?.();
  }, []);

  // Flattened in display order, so ↑/↓ walk the groups top to bottom.
  const options: Option[] =
    !searchable || !data
      ? []
      : [
          ...GROUPS.flatMap(({ type, label }) =>
            data.hits
              .filter((h) => h.type === type)
              .map((h) => ({
                key: `${type}:${h.id}`,
                path: hitPath(h),
                group: label,
                title: title(h),
                snippet: h.snippet,
              })),
          ),
          ...data.tags.map((t) => ({
            key: `tag:${t.id}`,
            path: tagPath(t),
            group: 'Tags',
            title: `#${t.name}`,
          })),
        ].slice(0, PALETTE_LIMIT);
  const all = `/search?q=${encodeURIComponent(q.trim())}`;

  const go = (path: string) => {
    onClose();
    navigate(path);
  };

  return (
    <div className="backdrop palette-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div role="dialog" aria-modal="true" aria-label="Search" className="dialog palette">
        <input
          ref={inputRef}
          type="search"
          role="combobox"
          aria-label="Search"
          aria-expanded={options.length > 0}
          aria-controls={`${ids}-list`}
          aria-activedescendant={active >= 0 && options[active] ? `${ids}-${active}` : undefined}
          aria-autocomplete="list"
          placeholder="Search journal, habits, goals, events and tags"
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setActive(-1);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              e.preventDefault();
              e.stopPropagation();
              onClose();
            } else if (e.key === 'ArrowDown') {
              e.preventDefault();
              setActive((a) => Math.min(options.length - 1, a + 1));
            } else if (e.key === 'ArrowUp') {
              e.preventDefault();
              setActive((a) => Math.max(-1, a - 1));
            } else if (e.key === 'Enter') {
              e.preventDefault();
              const o = options[active];
              if (o) go(o.path);
              else if (searchable) go(all);
            } else if (e.key === 'Tab') {
              // The input is the only stop; keep focus in the dialog.
              e.preventDefault();
            }
          }}
        />
        <ul id={`${ids}-list`} role="listbox" aria-label="Results" className="plain palette-list">
          {options.map((o, i) => (
            <li
              key={o.key}
              id={`${ids}-${i}`}
              role="option"
              aria-selected={i === active}
              className={`palette-option${i === active ? ' active' : ''}`}
              onMouseMove={() => setActive(i)}
              onClick={() => go(o.path)}
            >
              <span className="small muted palette-group">{o.group}</span>
              <span className="palette-title">{o.title}</span>
              {o.snippet && (
                <span className="small muted palette-snippet">
                  <Snippet text={o.snippet} />
                </span>
              )}
            </li>
          ))}
        </ul>
        <p className="small muted palette-foot">
          {!searchable
            ? 'Type to search everything.'
            : options.length === 0 && data
              ? 'No matches.'
              : '↑ ↓ to choose, Enter to open.'}{' '}
          {searchable && (
            <a
              href={all}
              onClick={(e) => {
                e.preventDefault();
                go(all);
              }}
            >
              All results and filters
            </a>
          )}
        </p>
      </div>
    </div>
  );
}

/** Mounted once in the app shell: listens for the shortcut and shows the palette. */
export function SearchPaletteHost() {
  const [open, setOpen] = useState(false);
  const show = useCallback(() => setOpen(true), []);
  useSearchShortcut(show);
  return open ? <SearchPalette onClose={() => setOpen(false)} /> : null;
}
