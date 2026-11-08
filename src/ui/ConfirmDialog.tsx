import { useEffect, useId, useRef, type ReactNode } from 'react';

interface ConfirmDialogProps {
  title: string;
  children?: ReactNode;
  confirmLabel: string;
  /** Styles the confirm button as destructive. */
  danger?: boolean;
  busy?: boolean;
  onConfirm(): void;
  onCancel(): void;
}

/**
 * Confirmation for destructive actions only: deletes, restore, merging tags (design §7).
 * Rendered while open; Escape or the backdrop cancels; focus starts on Cancel so Enter
 * never destroys data by accident.
 */
export function ConfirmDialog({
  title,
  children,
  confirmLabel,
  danger,
  busy,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const titleId = useId();
  const cancelRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    cancelRef.current?.focus();
    return () => previous?.focus?.();
  }, []);

  return (
    <div className="backdrop" onMouseDown={(e) => e.target === e.currentTarget && onCancel()}>
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="dialog"
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.stopPropagation();
            onCancel();
          } else if (e.key === 'Tab') {
            // Keep focus inside the modal.
            const focusable = [
              ...e.currentTarget.querySelectorAll<HTMLElement>('button, select, input, textarea, a[href]'),
            ].filter((el) => !(el as HTMLButtonElement).disabled);
            const first = focusable[0];
            const last = focusable.at(-1);
            if (e.shiftKey && document.activeElement === first) {
              e.preventDefault();
              last?.focus();
            } else if (!e.shiftKey && document.activeElement === last) {
              e.preventDefault();
              first?.focus();
            }
          }
        }}
      >
        <h2 id={titleId}>{title}</h2>
        {children && <div className="dialog-body">{children}</div>}
        <div className="dialog-actions">
          <button ref={cancelRef} type="button" className="secondary" onClick={onCancel}>
            Cancel
          </button>
          <button type="button" className={danger ? 'danger' : undefined} disabled={busy} onClick={onConfirm}>
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
