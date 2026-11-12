import { useDraft } from './useDraft';
import type { ValueInputProps } from './types';
import { formatNumber } from '@/domain/services/format';

/** Accepts "2.5" and "2,5"; empty clears. */
export function parseNumber(text: string): number | undefined | null {
  const s = text.trim().replace(',', '.');
  if (!s) return undefined;
  if (!/^\d*\.?\d+$|^\d+\.$/.test(s)) return null;
  const n = Number(s);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

const plain = (n: number) => formatNumber(n, 6, 'en-US').replace(/,/g, '');

/** Decimal ≥ 0 with a −/+ stepper (HAB-2, ENT-4). */
export function NumberInput({ habit, value, onChange, label, disabled }: ValueInputProps) {
  const { inputProps, invalid } = useDraft({ value, format: plain, parse: parseNumber, onCommit: onChange });
  const step = (d: 1 | -1) => onChange(Math.max(0, Math.round(((value ?? 0) + d) * 1e6) / 1e6));
  return (
    <span className="value-input">
      <button
        type="button"
        className="step"
        aria-label={`Decrease ${label}`}
        disabled={disabled || !value}
        onClick={() => step(-1)}
      >
        −
      </button>
      <input
        type="text"
        inputMode="decimal"
        aria-label={label}
        className="num"
        placeholder="–"
        disabled={disabled}
        {...inputProps}
      />
      <button
        type="button"
        className="step"
        aria-label={`Increase ${label}`}
        disabled={disabled}
        onClick={() => step(1)}
      >
        +
      </button>
      {habit.unit && <span className="unit">{habit.unit}</span>}
      {invalid && (
        <span className="field-error" role="alert">
          Enter a number ≥ 0
        </span>
      )}
    </span>
  );
}
