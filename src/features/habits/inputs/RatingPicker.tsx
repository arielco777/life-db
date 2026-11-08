import { useRef, type KeyboardEvent } from 'react';
import { NumberInput } from './NumberInput';
import type { ValueInputProps } from './types';

/** Scales wider than this fall back to a numeric field. */
const MAX_BUTTONS = 11;

/**
 * Segmented 1–N picker (HAB-2), an ARIA radio group with a roving tab stop. Arrow keys
 * move, digit keys pick (0 means 10 on a 1–10 scale), clicking the chosen value clears it.
 */
export function RatingPicker(props: ValueInputProps) {
  const { habit, value, onChange, label, disabled } = props;
  const { min, max } = habit.ratingScale ?? { min: 1, max: 10 };
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  if (max - min + 1 > MAX_BUTTONS) return <IntegerFallback {...props} min={min} max={max} />;

  const values = Array.from({ length: max - min + 1 }, (_, i) => min + i);
  const focusValue = value ?? min;
  const pick = (v: number) => {
    onChange(v);
    refs.current[v - min]?.focus();
  };

  const onKeyDown = (e: KeyboardEvent) => {
    const current = value ?? min - 1;
    if (e.key === 'ArrowRight' || e.key === 'ArrowUp') {
      e.preventDefault();
      pick(Math.min(max, Math.max(min, current + 1)));
    } else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') {
      e.preventDefault();
      pick(Math.max(min, current - 1));
    } else if (e.key === 'Home') {
      e.preventDefault();
      pick(min);
    } else if (e.key === 'End') {
      e.preventDefault();
      pick(max);
    } else if (/^\d$/.test(e.key)) {
      const d = Number(e.key);
      const v = d === 0 && max >= 10 && min <= 10 ? 10 : d;
      if (v >= min && v <= max) {
        e.preventDefault();
        pick(v);
      }
    } else if (e.key === 'Delete' || e.key === 'Backspace') {
      if (value !== undefined) {
        e.preventDefault();
        onChange(undefined);
      }
    }
  };

  return (
    <span role="radiogroup" aria-label={label} className="rating" onKeyDown={onKeyDown}>
      {values.map((v, i) => (
        <button
          key={v}
          ref={(el) => {
            refs.current[i] = el;
          }}
          type="button"
          role="radio"
          aria-checked={value === v}
          aria-label={String(v)}
          tabIndex={v === focusValue ? 0 : -1}
          className={value === v ? 'on' : undefined}
          disabled={disabled}
          onClick={() => onChange(value === v ? undefined : v)}
        >
          {v}
        </button>
      ))}
    </span>
  );
}

function IntegerFallback({ min, max, ...props }: ValueInputProps & { min: number; max: number }) {
  return (
    <NumberInput
      {...props}
      habit={{ ...props.habit, unit: `/ ${max}` }}
      onChange={(v) =>
        props.onChange(v === undefined ? undefined : Math.min(max, Math.max(min, Math.round(v))))
      }
    />
  );
}
