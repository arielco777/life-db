import { useDraft } from './useDraft';
import type { ValueInputProps } from './types';
import { formatDuration, parseDuration } from '@/domain/services/format';

const parse = (text: string): number | undefined | null => (text.trim() ? parseDuration(text) : undefined);

/** Whole minutes; types `45`, `0:45`, `1h30`, `1.5h` (HAB-2). Shows "1h 30m". */
export function DurationInput({ value, onChange, label, disabled }: ValueInputProps) {
  const { inputProps, invalid } = useDraft({
    value,
    format: (m) => formatDuration(m),
    parse,
    onCommit: onChange,
  });
  return (
    <span className="value-input">
      <input
        type="text"
        aria-label={label}
        className="num duration"
        placeholder="0:00"
        title="Minutes, h:mm or 1h30"
        disabled={disabled}
        {...inputProps}
      />
      {invalid && (
        <span className="field-error" role="alert">
          Try 45, 0:45 or 1h30
        </span>
      )}
    </span>
  );
}
