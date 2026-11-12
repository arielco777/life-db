import { useEffect, useEffectEvent, useId, useRef, useState } from 'react';
import type { HabitEntry } from '@/domain/types';

interface EntryMenuProps {
  /** Used in accessible names, e.g. "Sleep, August 14". */
  label: string;
  isBoolean: boolean;
  disabled?: boolean;
  entry: HabitEntry | undefined;
  onSaveNote(note: string | null): void;
  onMarkNotDone(): void;
  onClear(): void;
}

/**
 * The "⋯" popover next to an input: the entry's note (ENT-3), "not done" for checkboxes
 * and "Clear" (ENT-2). Non-modal (NFR-6): Escape or clicking outside closes it, and the
 * note saves when the popover closes.
 */
export function EntryMenu({
  label,
  isBoolean,
  disabled,
  entry,
  onSaveNote,
  onMarkNotDone,
  onClear,
}: EntryMenuProps) {
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState('');
  const rootRef = useRef<HTMLSpanElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelId = useId();
  const hasNote = !!entry?.note;

  const close = (save: boolean) => {
    if (save && entry && note.trim() !== (entry.note ?? '')) onSaveNote(note.trim() || null);
    setOpen(false);
    buttonRef.current?.focus();
  };
  const onOutside = useEffectEvent(() => close(true));

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) onOutside();
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  return (
    <span className="entry-menu" ref={rootRef}>
      <button
        ref={buttonRef}
        disabled={disabled}
        type="button"
        className={`icon${hasNote ? ' has-note' : ''}`}
        aria-label={hasNote ? `${label}: note and options (has note)` : `${label}: note and options`}
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        onClick={() => {
          if (open) return close(true);
          setNote(entry?.note ?? '');
          setOpen(true);
        }}
      >
        {hasNote ? '✎' : '⋯'}
      </button>
      {open && (
        <div
          id={panelId}
          role="group"
          aria-label={`${label} options`}
          className="popover"
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              e.stopPropagation();
              close(true);
            }
          }}
        >
          <label className="stack-sm">
            <span className="small muted">Note</span>
            <textarea
              rows={3}
              maxLength={1000}
              autoFocus
              value={note}
              disabled={!entry}
              placeholder={entry ? 'Add a note…' : 'Log a value first'}
              onChange={(e) => setNote(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                  e.preventDefault();
                  close(true);
                }
              }}
            />
          </label>
          <div className="row">
            {isBoolean && entry?.value !== 0 && (
              <button
                type="button"
                className="secondary"
                onClick={() => {
                  onMarkNotDone();
                  setOpen(false);
                }}
              >
                Mark not done
              </button>
            )}
            <button
              type="button"
              className="secondary"
              disabled={!entry}
              onClick={() => {
                onClear();
                setOpen(false);
                buttonRef.current?.focus();
              }}
            >
              Clear entry
            </button>
          </div>
        </div>
      )}
    </span>
  );
}
