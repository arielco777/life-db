import { useId, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { suggestTags, useTagActions, useTags } from './hooks';
import { normalizeTagName } from '@/domain/schemas';
import type { Tag, UUID } from '@/domain/types';

interface TagInputProps {
  value: UUID[];
  onChange(ids: UUID[]): void;
  id?: string;
  /** Accessible name for the text field when there is no visible <label htmlFor>. */
  'aria-label'?: string;
  placeholder?: string;
  disabled?: boolean;
}

type Option = { kind: 'tag'; tag: Tag } | { kind: 'create'; name: string };

/**
 * Tag field shared by every editor (tasks 3.3). Typing offers existing tags (TAG-2); Enter
 * or comma picks the highlighted one or creates the typed tag, stored normalized (TAG-3).
 * Backspace in an empty field removes the last tag; ArrowDown in an empty field lists all tags.
 * Implements the ARIA combobox pattern.
 */
export function TagInput({
  value,
  onChange,
  id,
  placeholder = 'Add tag…',
  disabled,
  ...rest
}: TagInputProps) {
  const { data: all = [] } = useTags();
  const { getOrCreate } = useTagActions();
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listId = useId();

  const byId = useMemo(() => new Map(all.map((t) => [t.id, t])), [all]);
  const normalized = normalizeTagName(query);
  const options: Option[] = useMemo(() => {
    const tags: Option[] = suggestTags(all, query, value).map((tag) => ({ kind: 'tag', tag }));
    const exists = all.some((t) => t.name === normalized);
    return normalized && !exists ? [...tags, { kind: 'create', name: normalized }] : tags;
  }, [all, query, value, normalized]);
  const showList = open && options.length > 0;
  const activeIndex = Math.min(active, options.length - 1);

  const add = (tagId: UUID) => {
    if (!value.includes(tagId)) onChange([...value, tagId]);
    setQuery('');
    setActive(0);
    setOpen(false);
  };

  const commit = (opt: Option | undefined) => {
    if (opt?.kind === 'tag') return add(opt.tag.id);
    const name = opt?.kind === 'create' ? opt.name : normalized;
    if (!name) return;
    const existing = all.find((t) => t.name === name);
    if (existing) return add(existing.id);
    getOrCreate.mutate(name, { onSuccess: (tag) => add(tag.id) });
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        if (!showList) {
          setActive(0); // first press opens on the first option
          return setOpen(true);
        }
        setActive((i) => (Math.min(i, options.length - 1) + 1) % options.length);
        return;
      case 'ArrowUp':
        e.preventDefault();
        if (!showList) return;
        setActive((i) => (Math.min(i, options.length - 1) - 1 + options.length) % options.length);
        return;
      case 'Enter':
      case ',':
        if (!normalized && !(showList && e.key === 'Enter')) return;
        e.preventDefault();
        commit(showList ? options[activeIndex] : undefined);
        return;
      case 'Escape':
        if (showList) {
          e.preventDefault();
          e.stopPropagation(); // don't also cancel a surrounding editor
          setOpen(false);
        }
        return;
      case 'Backspace':
        if (!query && value.length) onChange(value.slice(0, -1));
        return;
    }
  };

  const optionId = (i: number) => `${listId}-${i}`;

  return (
    <div className="tag-input" onClick={() => inputRef.current?.focus()}>
      <ul className="chips" aria-label="Selected tags">
        {value.map((tagId) => {
          const name = byId.get(tagId)?.name ?? '…';
          return (
            <li key={tagId} className="chip">
              <span>{name}</span>
              <button
                type="button"
                className="ghost"
                aria-label={`Remove tag ${name}`}
                disabled={disabled}
                onClick={(e) => {
                  e.stopPropagation();
                  onChange(value.filter((x) => x !== tagId));
                  inputRef.current?.focus();
                }}
              >
                ×
              </button>
            </li>
          );
        })}
      </ul>
      <div className="tag-input-field">
        <input
          ref={inputRef}
          id={id}
          role="combobox"
          aria-label={rest['aria-label']}
          aria-autocomplete="list"
          aria-expanded={showList}
          aria-controls={listId}
          aria-activedescendant={showList ? optionId(activeIndex) : undefined}
          autoComplete="off"
          placeholder={placeholder}
          disabled={disabled}
          value={query}
          maxLength={60}
          onChange={(e) => {
            setQuery(e.target.value.replace(/,/g, ''));
            setActive(0);
            setOpen(true);
          }}
          onBlur={() => setOpen(false)}
          onKeyDown={onKeyDown}
        />
        <ul
          id={listId}
          role="listbox"
          className="suggestions"
          hidden={!showList}
          aria-label="Tag suggestions"
        >
          {showList &&
            options.map((opt, i) => (
              <li
                key={opt.kind === 'tag' ? opt.tag.id : 'create'}
                id={optionId(i)}
                role="option"
                aria-selected={i === activeIndex}
                className={i === activeIndex ? 'active' : undefined}
                // mousedown, not click: keeps focus in the input
                onMouseDown={(e) => {
                  e.preventDefault();
                  commit(opt);
                }}
                onMouseEnter={() => setActive(i)}
              >
                {opt.kind === 'tag' ? opt.tag.name : <>Create “{opt.name}”</>}
              </li>
            ))}
        </ul>
      </div>
    </div>
  );
}
