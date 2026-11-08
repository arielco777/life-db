import { useState, type ChangeEvent, type FocusEvent, type KeyboardEvent } from 'react';

/**
 * Text-field editing for number-like values. While focused the field holds the user's
 * text; on Enter or blur it is parsed and committed once (ENT-5); Escape reverts.
 * No effects: when not editing, the field simply shows the formatted prop value.
 */
export function useDraft<T>({
  value,
  format,
  parse,
  onCommit,
}: {
  value: T | undefined;
  format(v: T): string;
  /** `undefined` = empty (clear), `null` = invalid. */
  parse(text: string): T | undefined | null;
  onCommit(v: T | undefined): void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const [invalid, setInvalid] = useState(false);
  const shown = value === undefined ? '' : format(value);

  const commit = () => {
    if (draft === null) return true;
    const parsed = parse(draft);
    if (parsed === null) {
      setInvalid(true);
      return false;
    }
    setInvalid(false);
    setDraft(null);
    if (parsed !== value) onCommit(parsed);
    return true;
  };

  return {
    invalid,
    inputProps: {
      value: draft ?? shown,
      'aria-invalid': invalid || undefined,
      onFocus: (e: FocusEvent<HTMLInputElement>) => {
        setDraft(shown);
        e.currentTarget.select();
      },
      onChange: (e: ChangeEvent<HTMLInputElement>) => {
        setDraft(e.target.value);
        setInvalid(false);
      },
      onBlur: () => {
        if (!commit()) {
          // Leaving with garbage: keep the last good value.
          setDraft(null);
          setInvalid(false);
        }
      },
      onKeyDown: (e: KeyboardEvent<HTMLInputElement>) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          commit();
        } else if (e.key === 'Escape' && draft !== null) {
          e.preventDefault();
          e.stopPropagation();
          setDraft(shown);
          setInvalid(false);
        }
      },
    },
  };
}
